/**
 * scripts/netease-import.ts —— 网易云专辑导入器 CLI（B5 / IM-23，评审案
 * 05-系统架构设计/评审案-网易云专辑导入器.md Q4：CLI 起步，SSR 两段式页后置）。
 *
 * 用法（建议先停服——与重建脚本同纪律；WAL+busy_timeout 下与运行中服务并存可控）：
 *   node --import tsx scripts/netease-import.ts --mode saved --auth cookie "<MUSIC_U=...>" [--preview|--dry-run]
 *   node --import tsx scripts/netease-import.ts --mode playlist --id <歌单ID|URL> --auth qr [--selected k1,k2,…]
 *
 * 环境：NETEASE_API_BASE_URL（api-enhanced 容器地址；**未配置 = 导入功能整体停用**，Q2 fail-soft，
 * Discogs 无 token 先例。需自部署 NeteaseCloudMusicApi 增强版容器，第三方逆向实现、用户知情自担）。
 *
 * 行为（两段式，v1 口径）：
 * 1. --preview：拉全列表标 isNew（v1 去重键 artist|title 小写 vs 已有 records + netease source_id），
 *    只打印不落库；--selected <dedupKey,…> 过滤（缺省 = 全部新专辑，上限 200，limit ∈ [1,200]）；
 * 2. 正式导入：逐张复用 upsertAlbum（身份解析 + alias_sources）同构建 Record——
 *    added_at=now、listened_at=网易云 savedAt（day 精度）、tag netease；重复记录（D2 UNIQUE）→ exists；
 * 3. summary {fetched/new/exists/imported/failed} + failures 前 20 条（不阻塞整批）；
 * 4. 封面交既有 onAlbumAdded 钩子形态（covers.ts downloadCover 懒落盘，失败仅日志不阻塞；禁改 covers.ts）。
 *
 * 红线（Q3）：cookie 即用即弃——内存持有、不落库不写日志；进度打印只出现脱敏形态。
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { loadConfig } from '../src/server/config';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { DAO, DuplicateRecordError } from '../src/server/db/dao';
import { downloadCover } from '../src/server/metadata/covers';
import {
  NETEASE_SOURCE,
  dedupKey,
  fetchPlaylistAlbums,
  filterSelected,
  iterSavedAlbums,
  neteaseBaseUrl,
  parsePlaylistId,
  qrLogin,
  redactCookie,
  sanitizeCookie,
  type NeteaseAlbumItem,
  type PreviewItem
} from '../src/server/metadata/netease';

const FAILURE_CAP = 20;

export interface ImportSummary {
  /** 从网易云拉取的总数（全量口径，与 v1 一致；selected 子集结果见 imported/failed） */
  fetched: number;
  new: number;
  exists: number;
  imported: number;
  failed: number;
  /** selected 过滤 + [1,200] 截断后的实际导入候选数（dry-run 的「将导入 N 张」口径） */
  chosen: number;
  failures: string[];
  dryRun: boolean;
}

/** 已有专辑键收集：listPage 全量走查（60/页，5000 行毫秒级，rebuild.ts 同款先例）→ dedupKey 集合 */
export function collectExistingKeys(dao: DAO, userId = 'local'): Set<string> {
  const keys = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page = dao.listPage({ userId, cursor, limit: 60 });
    for (const it of page.items) keys.add(dedupKey({ artist: it.album.artist, title: it.album.title }));
    if (!page.meta.has_next || page.meta.next_cursor === null) break;
    cursor = page.meta.next_cursor;
  }
  return keys;
}

/** 两段式第一段：拉全列表标 isNew（用户已有 = dedupKey 命中 或 netease source_id 命中） */
export function markPreview(albums: NeteaseAlbumItem[], dao: DAO, userId = 'local'): PreviewItem[] {
  const keys = collectExistingKeys(dao, userId);
  const knownIds = dao.existingSourceIds(NETEASE_SOURCE, albums.map((a) => a.sourceId));
  return albums.map((a) => {
    const key = dedupKey(a);
    return { ...a, key, isNew: !keys.has(key) && !knownIds.has(a.sourceId) };
  });
}

/** 两段式第二段：selected 过滤后逐张落库（upsertAlbum 身份解析 + createRecord + tag netease）。dry-run 零写入。 */
export function importSelected(
  dao: DAO,
  preview: PreviewItem[],
  opts: {
    selected?: string[] | null;
    dryRun?: boolean;
    userId?: string;
    onAlbumAdded?: (albumId: string, sourceId: string, coverUrl: string | null) => void;
  } = {}
): ImportSummary {
  const userId = opts.userId ?? 'local';
  const chosen = filterSelected(preview, opts.selected ?? null);
  const summary: ImportSummary = {
    fetched: preview.length,
    new: preview.filter((it) => it.isNew).length,
    exists: 0,
    imported: 0,
    failed: 0,
    chosen: chosen.length,
    failures: [],
    dryRun: opts.dryRun === true
  };
  summary.exists = preview.length - summary.new;
  for (const it of chosen) {
    if (!it.isNew) continue;
    if (summary.dryRun) continue; // 预演：只统计，不落库
    try {
      const { id: albumId } = dao.upsertAlbum({
        source: NETEASE_SOURCE,
        source_id: it.sourceId,
        title: it.title,
        artist: it.artist,
        release_year: it.releaseYear,
        cover_url: it.coverUrl
      });
      let recordId: string;
      try {
        recordId = dao.createRecord({
          album_id: albumId,
          userId,
          listened_at: it.savedAt,
          listened_precision: it.savedAt === null ? null : 'day'
        }).id;
      } catch (err) {
        if (err instanceof DuplicateRecordError) {
          summary.exists++; // 身份归并后撞已有记录（D2）：不产生第二条，计入 exists
          continue;
        }
        throw err;
      }
      dao.setTags(recordId, ['netease'], userId);
      summary.imported++;
      opts.onAlbumAdded?.(albumId, it.sourceId, it.coverUrl);
    } catch (err) {
      summary.failed++;
      if (summary.failures.length < FAILURE_CAP) summary.failures.push(`${it.artist} - ${it.title}: ${String(err)}`);
    }
  }
  return summary;
}

// ---------------------------------------------------------------- CLI

function usage(): never {
  console.error(
    '用法：node --import tsx scripts/netease-import.ts --mode saved|playlist [--id <歌单ID|URL>]\n' +
      '      --auth cookie "<MUSIC_U=...>" | --auth qr [--captcha <验证码>]\n' +
      '      [--preview] [--selected <dedupKey,…>（可多次传参）] [--dry-run]\n' +
      '环境：NETEASE_API_BASE_URL=<api-enhanced 容器地址>（未配置 = 停用，Q2 fail-soft）'
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preview') out['preview'] = true;
    else if (a === '--dry-run') out['dry-run'] = true;
    else if (a === '--mode' || a === '--id' || a === '--captcha' || a === '--selected') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) usage();
      if (a === '--selected') out['selected'] = `${out['selected'] === undefined ? '' : out['selected'] + ','}${v}`;
      else out[a.slice(2)] = v;
      i++;
    } else if (a === '--auth') {
      const kind = argv[i + 1];
      if (kind !== 'cookie' && kind !== 'qr') usage();
      out['auth'] = kind;
      if (kind === 'cookie') {
        out['cookie'] = argv[i + 2] ?? '';
        i += 2;
      } else {
        i++;
      }
    }
    // 其余 token（粘性粘贴带空白拆散等）忽略
  }
  return out;
}

/** QR data URL → 本地临时 png 并唤起默认看图程序（零依赖；登录完成后清理临时件） */
function openQrImage(dataUrl: string): string {
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  if (m === null || m[2] === undefined) throw new Error('QR data URL 形状异常');
  const file = join(tmpdir(), `netease-qr-${process.pid}.png`);
  rmSync(file, { force: true });
  writeFileSync(file, Buffer.from(m[2], 'base64'));
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const openerArgs = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  execFile(opener, openerArgs, { windowsHide: true }, () => {}); // 打开失败不阻塞：路径已打印
  console.log(`QR 图片已写入：${file}（请用网易云 App 扫码；登录完成后自动清理）`);
  return file;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const mode = a['mode'] === 'saved' || a['mode'] === 'playlist' ? a['mode'] : undefined;
  if (mode === undefined || (a['auth'] !== 'cookie' && a['auth'] !== 'qr')) usage();
  if (mode === 'playlist' && typeof a['id'] !== 'string') usage();

  const baseUrl = neteaseBaseUrl();
  if (baseUrl === null) {
    console.error('[netease] NETEASE_API_BASE_URL 未配置——导入功能整体停用（Q2 fail-soft，Discogs 无 token 先例）。');
    console.error('[netease] 部署登记：需自部署 api-enhanced 容器（NeteaseCloudMusicApi 增强版，第三方逆向实现，知情自担）；');
    console.error('[netease] 参见 评审案 05-系统架构设计/评审案-网易云专辑导入器.md §3 Q2。');
    process.exit(2);
  }

  // —— 认证（cookie 即用即弃：内存持有，不落库不写日志；打印仅脱敏形态）——
  let cookie = '';
  let qrTmp: string | null = null;
  try {
    if (a['auth'] === 'cookie') {
      cookie = sanitizeCookie(typeof a['cookie'] === 'string' ? a['cookie'] : '');
      if (cookie === '') usage();
      console.log(`[netease] 认证：cookie 粘贴（${redactCookie(cookie)}，即用即弃不落库）`);
    } else {
      const r = await qrLogin({
        baseUrl,
        onQrImage: (dataUrl) => {
          qrTmp = openQrImage(dataUrl);
        },
        onState: (s) => console.log(`[netease] QR：${s === 'waiting' ? '等待扫码…' : s === 'scanned' ? '已扫码，请在手机上确认…' : '已授权'}`)
      });
      cookie = r.cookie;
      if (qrTmp !== null && existsSync(qrTmp)) rmSync(qrTmp, { force: true });
    }

    // —— 拉取（客户端流式分页，页间 ≥1s 纪律在 netease.ts 内部）——
    const albums: NeteaseAlbumItem[] = [];
    if (mode === 'saved') {
      for await (const it of iterSavedAlbums({ baseUrl, cookie })) {
        albums.push(it);
        if (albums.length % 100 === 0) console.log(`[netease] 已拉取 ${albums.length} 张…`);
      }
    } else {
      const pid = parsePlaylistId(a['id'] as string);
      if (pid === null) {
        console.error('[netease] 歌单 ID 解析失败（支持裸数字与 URL ?id=）');
        process.exit(2);
      }
      albums.push(...(await fetchPlaylistAlbums({ baseUrl, cookie, playlistId: pid })));
    }
    console.log(`[netease] 拉取完成：${albums.length} 张专辑`);

    // —— 落库编排 ——
    const cfg = loadConfig();
    const db: Db = openDatabase(cfg.dbPath);
    try {
      runMigrations(db, resolve(dirname(fileURLToPath(import.meta.url)), '../db/migrations'));
      const dao = new DAO(db);
      const preview = markPreview(albums, dao);
      const selected = typeof a['selected'] === 'string'
        ? (a['selected'] as string)
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s !== '')
        : null;
      if (selected !== null && selected.length > 0) {
        const keySet = new Set(preview.map((p) => p.key));
        const missed = selected.filter((k) => !keySet.has(k));
        if (missed.length > 0) console.log(`[netease] selected 未命中 ${missed.length} 个 key（如 ${missed[0]}…）；key 以 --preview 输出为准`);
      }

      // 封面交既有 onAlbumAdded 钩子形态（covers.ts 懒落盘；失败仅日志不阻塞，禁改 covers.ts）
      const pending: Promise<unknown>[] = [];
      const onAlbumAdded = (albumId: string, _sourceId: string, coverUrl: string | null): void => {
        if (coverUrl === null) return;
        pending.push(
          downloadCover({ coverUrl, coversDir: cfg.coversDir, userAgent: cfg.userAgent })
            .then((filename) => dao.setAlbumCoverLocal(albumId, filename))
            .catch((err) => console.error(`[covers] ${albumId} 封面下载失败（不阻塞导入）：${String(err)}`))
        );
      };

      if (a['preview'] === true) {
        console.log(`[preview] 共 ${preview.length} 张：新 ${preview.filter((p) => p.isNew).length} / 已有 ${preview.filter((p) => !p.isNew).length}`);
        for (const p of preview.filter((x) => x.isNew)) console.log(`  [新] ${p.artist} - ${p.title}  key=${p.key}`);
        console.log('[preview] 未落库（preview 模式；正式导入省略 --preview，--selected 传 key 过滤）');
        return;
      }

      const summary = importSelected(dao, preview, { selected, dryRun: a['dry-run'] === true, onAlbumAdded });
      await Promise.allSettled(pending); // 封面异步钩子收尾（CLI 退出前不丢下载）
      if (summary.dryRun) {
        console.log(`[dry-run] 将导入 ${summary.chosen} 张（新 ${summary.new} / 已有 ${summary.exists} / 拉取 ${summary.fetched}），零写入`);
      } else {
        console.log(
          `[summary] fetched=${summary.fetched} new=${summary.new} exists=${summary.exists} imported=${summary.imported} failed=${summary.failed}`
        );
        for (const f of summary.failures) console.error(`  [failed] ${f}`);
      }
    } finally {
      db.close();
    }
  } finally {
    // cookie 生命周期终点：内存引用置空随进程退出即弃（不落库不写日志）；QR 临时件清理
    cookie = '';
    if (qrTmp !== null && existsSync(qrTmp)) rmSync(qrTmp, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
