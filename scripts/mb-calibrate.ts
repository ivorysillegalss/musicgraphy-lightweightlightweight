/**
 * scripts/mb-calibrate.ts —— MB 按需权威化 CLI（B7；IM-23 Q1 路线 B 的后置半截，
 * 评审案 05-系统架构设计/评审案-网易云专辑导入器.md §3 Q1「MB 权威化可后置为按需同步，不丢能力」）。
 *
 * 用法（建议停服运行——与重建/导入脚本同纪律；WAL+busy_timeout 下与运行中服务并存可控）：
 *   node --import tsx scripts/mb-calibrate.ts [--limit <n>] [--id <album_metadata.id>] [--dry-run]
 *
 * 行为（对 source='netease' 的 album_metadata 行逐张权威化；B5 直建行的后置补全）：
 * 1. 枚举 netease 行（直接 db.prepare 只读，color-extract.ts 先例；ORDER BY created_at,id）；
 *    --id 单张（行不存在或非 netease → exit 2）；--limit 截断「需 resolve」的行数
 *    （已权威化行不占额度——续跑语义：重复执行逐批推进）。
 * 2. 行 alias_sources 已含 musicbrainz → 幂等跳过（零上游零写入），计入 checked/calibrated。
 * 3. resolve MB：MusicBrainzClient.resolveReleaseByArtistAndTitle（artist:"…" AND release:"…"，
 *    top-1 = MB 相关度最高；复用既有全局限流纪律 ≥1s + 30/min；CLI 独立 limiter 实例）：
 *    - 命中 → upsertAlbum({source:'musicbrainz', source_id:MBID, title/artist=行现值,
 *      release_year/country=MB, cover_url=行现值 ?? MB CAA})：三级落点（album-merge.ts）
 *      identity/alias 归并回 netease 行——用户数据（collection_record/tags）不动，alias_sources
 *      记 musicbrainz→MBID 关联，非空字段保守更新（IM-12）。title/artist 传行现值（不传 MB
 *      规范名：中文名差异会使 identity 落空 → 分裂新行）；封面不降级（netease picUrl 优先，
 *      仅缺档填 CAA front-250）；cover_local 缺档时交既有 onAlbumAdded 钩子形态懒落盘
 *      （covers.ts 零改动）。upsert 返回 id ≠ netease 行 id（同键冲突等边角）→ failed 如实报告。
 *    - 未命中 → missed（netease 行不动，fail-soft）；
 *    - 上游异常（超时/429/网络） → failed 进 failures 清单（不阻塞整批）。
 * 4. summary {checked/calibrated/missed/failed} + failures/missedKeys 前 20 条（B5 口径）。
 *    --dry-run：resolve 照常打上游（命中分类可见），零 DB 写、零封面落盘。
 *
 * 红线：DAO 零新增方法（枚举走直接只读 SQL；落库走既有 upsertAlbum 语义）；运行时依赖 = 2；
 * 无 JS 基线不动。
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/server/config';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { DAO } from '../src/server/db/dao';
import type { Row } from '../src/server/db/sql';
import { mapAlbum, type AlbumRow } from '../src/server/db/types';
import { downloadCover } from '../src/server/metadata/covers';
import { MusicBrainzClient, UpstreamError, type AlbumCandidate } from '../src/server/metadata/musicbrainz';
import { MetadataRateLimiter } from '../src/server/metadata/queue';

const FAILURE_CAP = 20;

export interface CalibrateSummary {
  /** 范围内检视的行数（= calibrated + missed + failed；被 --limit 截断的不计入） */
  checked: number;
  /** 已权威化（含幂等跳过的已关联行 / dry-run 的「将权威化」） */
  calibrated: number;
  /** MB 未命中（netease 行保留不动） */
  missed: number;
  /** 上游异常 / 落库异常 / 归并未落原行 */
  failed: number;
  failures: string[];
  /** missed 清单前 20 条（artist - title，便于人工到 MB 手查） */
  missedKeys: string[];
  dryRun: boolean;
  genresFilled: number;
}

/** MB resolve 客户端最小面（测试可注入桩；MusicBrainzClient 天然满足） */
export interface ResolveClient {
  resolveReleaseByArtistAndTitle(artist: string, title: string): Promise<AlbumCandidate | null>;
  lookupReleaseGenres(mbid: string): Promise<string[]>;
}

/** MB genres 归一（R-110）：查重既有 chips（casefold 命中沿用既有写法防碎片）→ 未命中首字母大写 → 去重 + cap */
export function normalizeGenres(raw: string[], existing: Map<string, string>, cap = 6): string[] {
  const out: string[] = [];
  for (const g of raw) {
    const t = g.trim();
    if (t === '') continue;
    const key = t.toLowerCase();
    if (out.some((x) => x.toLowerCase() === key)) continue;
    out.push(existing.get(key) ?? t.charAt(0).toUpperCase() + t.slice(1));
    if (out.length >= cap) break;
  }
  return out;
}

/** 枚举 source='netease' 行（直接只读 SQL，DAO 零新增方法；color-extract.ts 直接 prepare 先例） */
export function listNeteaseRows(db: Db): AlbumRow[] {
  const rows = db.prepare('SELECT * FROM album_metadata WHERE source = ? ORDER BY created_at, id').all('netease') as Row[];
  return rows.map(mapAlbum);
}

/** 单张 netease 行（--id 路径）；null = 不存在或非 netease */
export function getNeteaseRow(db: Db, id: string): AlbumRow | null {
  const row = db.prepare('SELECT * FROM album_metadata WHERE id = ?').get(id) as Row | undefined;
  if (row === undefined) return null;
  const album = mapAlbum(row);
  return album.source === 'netease' ? album : null;
}

/**
 * 逐张权威化（串行循环；resolve 经客户端内限流队列天然 ≥1s + 30/min）。dry-run 零写入。
 * --limit 只对「需 resolve」的行计数（已权威化行不占额度，续跑语义）。
 */
export async function calibrateRows(
  dao: DAO,
  rows: AlbumRow[],
  client: ResolveClient,
  opts: {
    dryRun?: boolean;
    limit?: number | null;
    /** 既有 onAlbumAdded 钩子形态（B5 同款）：封面缺档回填；dry-run 不触发 */
    onAlbumAdded?: (albumId: string, coverUrl: string | null) => void;
    /** 既有 genre chips 词汇（lower → canonical）：MB genres 归一查重沿用，防 chip 碎片 */
    existingGenres?: Map<string, string>;
    /** 503 退避睡眠注入（测试快进；缺省真实 setTimeout） */
    sleepFn?: (ms: number) => Promise<void>;
  } = {}
): Promise<CalibrateSummary> {
  const dryRun = opts.dryRun === true;
  const existingGenres = opts.existingGenres ?? new Map<string, string>();
  const summary: CalibrateSummary = { checked: 0, calibrated: 0, missed: 0, failed: 0, genresFilled: 0, failures: [], missedKeys: [], dryRun };
  let attempts = 0;
  const maxAttempts = opts.limit ?? Number.POSITIVE_INFINITY;
  const pushFailure = (msg: string): void => {
    if (summary.failures.length < FAILURE_CAP) summary.failures.push(msg);
  };
  for (const row of rows) {
    const already = row.alias_sources.some((a) => a.source === 'musicbrainz');
    if (!already && attempts >= maxAttempts) break; // 额度只管需 resolve 的行；余下不计入 checked
    summary.checked++;
    if (already) {
      summary.calibrated++; // 已权威化：幂等跳过（零上游零写入）
      continue;
    }
    if (row.title === '' || row.artist === '') {
      attempts++;
      summary.failed++;
      pushFailure(`${row.id}: title/artist 为空，无法 resolve`);
      continue;
    }
    attempts++;
    let cand: AlbumCandidate | null;
    try {
      cand = await client.resolveReleaseByArtistAndTitle(row.artist, row.title);
    } catch (err) {
      // 503 退避重试一次（R-110 补记，2026-11-15 dry-run 实测 152 张级联 503 教训）：
      // 尊重 Retry-After（缺省 60s、上限 120s）后原行重试一发；二次 503 才计 failed 移动
      if (err instanceof UpstreamError && err.status === 503) {
        const waitMs = Math.min((err.retryAfterS ?? 60) * 1000, 120_000);
        await (opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(waitMs);
        try {
          cand = await client.resolveReleaseByArtistAndTitle(row.artist, row.title);
        } catch (err2) {
          summary.failed++;
          pushFailure(`${row.artist} - ${row.title}: ${String(err2)}（503 退避重试后仍失败）`);
          continue;
        }
      } else {
        summary.failed++;
        pushFailure(`${row.artist} - ${row.title}: ${String(err)}`);
        continue;
      }
    }
    if (cand === null || cand.source_id === '') {
      summary.missed++;
      if (summary.missedKeys.length < FAILURE_CAP) summary.missedKeys.push(`${row.artist} - ${row.title}`);
      continue; // 未命中：netease 行保留不动（fail-soft）
    }
    if (dryRun) {
      summary.calibrated++; // 预演：只分类计数，不落库
      continue;
    }
    try {
      // genres 只补空（行现值优先，IM-12 保守更新语义）：MB lookup inc=genres（失败不阻塞 year/country 合并）
      let genresValue: string[] | undefined;
      if (row.genres.length === 0) {
        try {
          const normalized = normalizeGenres(await client.lookupReleaseGenres(cand.source_id), existingGenres);
          if (normalized.length > 0) genresValue = normalized;
        } catch {
          // genre lookup 失败 → 本轮跳过 genres，year/country 照常合并（次轮重试）
        }
      }
      const { id } = dao.upsertAlbum({
        source: 'musicbrainz',
        source_id: cand.source_id,
        title: row.title, // 行现值 → identity 落点必归并回本行（MB 规范名会因名字差异分裂新行）
        artist: row.artist,
        release_year: cand.release_year,
        cover_url: row.cover_url ?? cand.cover_url, // 封面不降级：netease 现值优先，缺档填 CAA
        country: cand.country,
        genres: genresValue
      });
      if (id !== row.id) {
        summary.failed++;
        pushFailure(`${row.artist} - ${row.title}: 归并未落在原行（upsert→${id}；title/artist 与他行冲突？）`);
        continue;
      }
      summary.calibrated++;
      if (genresValue !== undefined) summary.genresFilled++;
      if (row.cover_local === null) {
        const coverUrl = row.cover_url ?? cand.cover_url;
        if (coverUrl !== null) opts.onAlbumAdded?.(row.id, coverUrl); // 封面缺档回填（既有钩子形态）
      }
    } catch (err) {
      summary.failed++;
      pushFailure(`${row.artist} - ${row.title}: ${String(err)}`);
    }
  }
  return summary;
}

// ---------------------------------------------------------------- CLI

function usage(): never {
  console.error(
    '用法：node --import tsx scripts/mb-calibrate.ts [--limit <n>] [--id <album_metadata.id>] [--dry-run]\n' +
      '行为：对 source=netease 行逐张 resolve MusicBrainz（artist+title；≥1s + 30/min 限流纪律），\n' +
      '      命中即 upsertAlbum 归并权威化（alias_sources 记 MBID，用户数据不动）；未命中保留不动。\n' +
      '      --limit 截断需 resolve 的行数（已权威化行不占额度，可续跑）；--dry-run 零写入。'
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out['dry-run'] = true;
    else if (a === '--id' || a === '--limit') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) usage();
      out[a.slice(2)] = v;
      i++;
    }
    // 其余 token 忽略
  }
  return out;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const singleId = typeof a['id'] === 'string' ? (a['id'] as string).trim() : null;
  const limitArg = typeof a['limit'] === 'string' ? (a['limit'] as string) : null;
  if (limitArg !== null && !/^\d+$/.test(limitArg)) usage();
  const limit = limitArg === null ? null : Number(limitArg);
  const dryRun = a['dry-run'] === true;

  const cfg = loadConfig();
  const db: Db = openDatabase(cfg.dbPath);
  try {
    runMigrations(db, resolve(dirname(fileURLToPath(import.meta.url)), '../db/migrations'));
    const dao = new DAO(db);
    const rows = singleId !== null ? (() => {
      const row = getNeteaseRow(db, singleId);
      if (row === null) {
        console.error(`[mb-calibrate] --id ${singleId} 不存在或非 netease 行`);
        process.exit(2);
      }
      return [row];
    })() : listNeteaseRows(db);

    const client = new MusicBrainzClient(new MetadataRateLimiter(), cfg.userAgent);
    // 封面缺档回填走既有 onAlbumAdded 钩子形态（covers.ts 懒落盘；失败仅日志不阻塞，禁改 covers.ts）
    const pending: Promise<unknown>[] = [];
    const onAlbumAdded = (albumId: string, coverUrl: string | null): void => {
      if (coverUrl === null) return;
      pending.push(
        downloadCover({ coverUrl, coversDir: cfg.coversDir, userAgent: cfg.userAgent })
          .then((filename) => dao.setAlbumCoverLocal(albumId, filename))
          .catch((err) => console.error(`[covers] ${albumId} 封面下载失败（不阻塞权威化）：${String(err)}`))
      );
    };

    console.log(
      `[mb-calibrate] netease 行 ${rows.length} 张（${dryRun ? 'dry-run 零写入' : '正式'}${limit !== null ? `，--limit ${limit}` : ''}）`
    );
    // 既有 genre chips 词汇（lower → canonical 首现写法）：MB genres 归一查重沿用，防 rock/Rock 碎片
    const existingGenres = new Map<string, string>();
    for (const r of db.prepare('SELECT genres FROM album_metadata WHERE genres IS NOT NULL').all() as Array<{ genres: string }>) {
      try {
        const list = JSON.parse(r.genres) as unknown;
        if (!Array.isArray(list)) continue;
        for (const g of list) {
          if (typeof g !== 'string') continue;
          const t = g.trim();
          if (t !== '' && !existingGenres.has(t.toLowerCase())) existingGenres.set(t.toLowerCase(), t);
        }
      } catch {
        // 坏 JSON 行跳过（不影响词汇）
      }
    }
    const summary = await calibrateRows(dao, rows, client, { dryRun, limit, onAlbumAdded, existingGenres });
    await Promise.allSettled(pending); // 封面异步钩子收尾（CLI 退出前不丢下载）

    if (summary.dryRun) {
      console.log(`[dry-run] 检视 ${summary.checked} 张：将权威化 ${summary.calibrated} / 未命中 ${summary.missed} / 失败 ${summary.failed}，零写入`);
    } else {
      console.log(`[summary] checked=${summary.checked} calibrated=${summary.calibrated} missed=${summary.missed} failed=${summary.failed} genresFilled=${summary.genresFilled}`);
    }
    for (const k of summary.missedKeys) console.log(`  [missed] ${k}（MB 未命中，netease 行保留）`);
    for (const f of summary.failures) console.error(`  [failed] ${f}`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
