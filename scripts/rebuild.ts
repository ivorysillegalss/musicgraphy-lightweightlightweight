/**
 * scripts/rebuild.ts —— 档案重建验证（P1-3 阶段 DoD「导出可重建档案」；02 §5.4：导出即完整备份，数据主权验收）。
 *
 * 用法（**先停服**——重建目标是离线库文件）：
 *   node --import tsx scripts/rebuild.ts <导出.json> --target <db路径> [--force]
 *
 * 行为：
 * 1. 读导出 JSON：校验 version 字段（02 §5.4 拓展点 #11，格式演进向后兼容的锚）与 records 数组；
 * 2. 目标库：不存在则新建并跑迁移（0001_init.sql）；已存在须 --force（先删再建，防手滑混入现库）；
 * 3. 重建 = 逐条走 DAO 正常记录路径（upsertAlbum → createRecord → setTags → updateRecord）——
 *    重建产物与"重新手工记录一遍"完全同构；导出形状无 source/source_id（§5.4），
 *    album 以 user-provided + 确定性 source_id（restore:归一化标题|艺术家）落位，重复导入经 title+artist 归并幂等；
 *    重复记录（UNIQUE(user_id,album_id)）跳过并计数（引用保留、不产生第二条记录，D2）；
 * 4. 重建后复核：导出条数 vs 库内条数比对 + 逐条字段抽样（note/tags/listened/favorite 保真即数据主权验收）。
 *
 * 边界（评审 R6）：本脚本验证**数据面**重建；封面文件恢复 = 含封面 zip（with_covers=1）解包至 data/covers/
 * （文件名即 album.cover_local 命名键，懒下载路由 /covers 原样服务）——文件面属运维操作，不进本脚本。
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { DAO, DuplicateRecordError } from '../src/server/db/dao';
import type { ExportItem, ExportPayload } from '../src/server/db/types';
import { normalizeTag } from '../src/server/db/sql';

export interface RebuildSummary {
  exported: number;
  rebuilt: number;
  skippedDuplicates: number;
  /** 逐条字段保真抽样：true = 全对齐 */
  verified: boolean;
  dbPath: string;
}

/** 校验导出 JSON 是 §5.4 形状（version 字段 = 拓展点 #11）。不合法一律抛错拒绝重建。 */
export function parseExportPayload(raw: string): ExportPayload {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('导出文件不是 JSON 对象');
  const p = parsed as { version?: unknown; records?: unknown };
  if (typeof p.version !== 'string' || p.version === '') throw new Error('导出文件缺 version 字段（02 §5.4 形状）');
  if (!Array.isArray(p.records)) throw new Error('导出文件缺 records 数组');
  return parsed as ExportPayload;
}

/**
 * 把导出 payload 重建进目标库（走 DAO 正常记录路径——重建产物与手工重新记录同构）。
 * 传 openDatabase + runMigrations 后的 Db；重复记录跳过（D2：永不产生第二条记录）。
 */
export function rebuildArchive(db: Db, payload: ExportPayload, userId = 'local'): RebuildSummary {
  const dao = new DAO(db);
  let rebuilt = 0;
  let skipped = 0;
  for (const item of payload.records) {
    assertItem(item);
    const { id: albumId } = dao.upsertAlbum({
      source: 'user-provided',
      source_id: `restore:${normalizeTag(item.album.title)}|${normalizeTag(item.album.artist)}`,
      title: item.album.title,
      artist: item.album.artist,
      release_year: item.album.release_year,
      cover_url: item.album.cover_url,
      genres: item.album.genres
    });
    let recordId: string;
    try {
      recordId = dao.createRecord({
        album_id: albumId,
        userId,
        added_at: item.record.added_at,
        listened_at: item.record.listened_at,
        listened_precision: item.record.listened_precision,
        note: item.record.note
      }).id;
    } catch (err) {
      if (err instanceof DuplicateRecordError) {
        skipped++; // 重复导入幂等：引用保留（D2），不产生第二条记录
        continue;
      }
      throw err;
    }
    if (item.tags.length > 0) dao.setTags(recordId, item.tags, userId);
    if (item.record.is_favorite) dao.updateRecord(recordId, { is_favorite: true }, userId);
    rebuilt++;
  }

  // —— 保真抽样：条数 + 逐条（title/artist/note/tags/listened/favorite）对齐 ——
  // 走查全量分页（limit=60/页，内存纪律①）构建 归一化 title|artist → 记录 索引
  const byKey = new Map<string, ReturnType<DAO['listPage']>['items'][number]>();
  let total = 0;
  let cursor: string | null = null;
  for (;;) {
    const page = dao.listPage({ userId, cursor, limit: 60 });
    total += page.items.length;
    for (const r of page.items) byKey.set(`${normalizeTag(r.album.title)}|${normalizeTag(r.album.artist)}`, r);
    if (!page.meta.has_next || page.meta.next_cursor === null) break;
    cursor = page.meta.next_cursor;
  }
  let verified = total === payload.records.length;
  const tagNames = (rid: string): string[] => dao.getRecord(rid).tags;
  for (const item of payload.records) {
    const r = byKey.get(`${normalizeTag(item.album.title)}|${normalizeTag(item.album.artist)}`);
    if (r === undefined || r.note !== item.record.note || r.is_favorite !== item.record.is_favorite || r.listened_at !== item.record.listened_at) {
      verified = false;
      break;
    }
    if (item.tags.length > 0 && tagNames(r.id).slice().sort().join('|') !== item.tags.slice().sort().join('|')) {
      verified = false;
      break;
    }
  }
  return { exported: payload.records.length, rebuilt, skippedDuplicates: skipped, verified, dbPath: '' };
}

function assertItem(item: ExportItem): void {
  if (typeof item.album?.title !== 'string' || typeof item.album?.artist !== 'string') {
    throw new Error('导出条目缺 album.title/artist（02 §5.4 形状）');
  }
  if (typeof item.record?.added_at !== 'string') throw new Error('导出条目缺 record.added_at');
}

// ---------------------------------------------------------------- CLI

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const src = args[0];
  const targetIdx = args.indexOf('--target');
  const target = targetIdx >= 0 ? args[targetIdx + 1] : undefined;
  const force = args.includes('--force');
  if (src === undefined || target === undefined) {
    console.error('用法：node --import tsx scripts/rebuild.ts <导出.json> --target <db路径> [--force]');
    process.exit(2);
  }
  if (existsSync(target)) {
    if (!force) {
      console.error(`目标库已存在：${target}（--force 才允许覆盖，防手滑混入现库）`);
      process.exit(2);
    }
    rmSync(target);
    for (const side of ['-wal', '-shm']) if (existsSync(target + side)) rmSync(target + side);
  }
  const payload = parseExportPayload(readFileSync(src, 'utf8'));
  const db = openDatabase(target);
  runMigrations(db, resolve(dirname(fileURLToPath(import.meta.url)), '../db/migrations'));
  const summary = rebuildArchive(db, payload);
  db.close();
  console.log(
    `[rebuild] 导出 ${summary.exported} 条 → 重建 ${summary.rebuilt} 条（跳过重复 ${summary.skippedDuplicates}）；` +
      `字段保真抽样：${summary.verified ? 'PASS' : 'FAIL'}；目标 = ${target}（${statSync(target).size}B）`
  );
  if (!summary.verified) process.exit(1);
}
