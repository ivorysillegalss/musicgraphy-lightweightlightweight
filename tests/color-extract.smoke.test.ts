// D3 主色提取管线冒烟（W4-6-3，独立文件）：fixture 提取值 / 色板吸附（含保留槽 16→NULL）/ 回填 dry-run / --limit / 全量回填与幂等
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { extractCoverColor, PALETTE, runBackfill, snapToPalette } from '../scripts/color-extract';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'color-extract');
const load = (name: string): Buffer => readFileSync(join(FIXTURES, name));

// 候选集：r1 red / r2 blue / r3 mixed / r4 cyan(保留槽→NULL) / r5 white / r6 缺文件 / r9 坏字节；
// r7 已有 color=4（非候选）；r8 无封面（非候选）。added_at 递增保证 ORDER BY 确定性。
const ROWS: { key: string; cover: string | null; color: number | null }[] = [
  { key: 'r1', cover: 'red.jpg', color: null },
  { key: 'r2', cover: 'blue.jpg', color: null },
  { key: 'r3', cover: 'mixed.jpg', color: null },
  { key: 'r4', cover: 'cyan.jpg', color: null },
  { key: 'r5', cover: 'white.jpg', color: null },
  { key: 'r6', cover: 'missing.jpg', color: null },
  { key: 'r9', cover: 'garbage.jpg', color: null },
  { key: 'r7', cover: 'red.jpg', color: 4 },
  { key: 'r8', cover: null, color: null }
];

describe('D3 主色提取管线（W4-6-3 冒烟，PM W5 提前）', () => {
  let dir: string;
  let db: Db;
  let coversDir: string;
  const ids = new Map<string, string>();

  const colorOf = (key: string): number | null =>
    (db.prepare('SELECT cover_color FROM collection_record WHERE id = ?').get(ids.get(key) as string) as {
      cover_color: number | null;
    }).cover_color;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-color-'));
    db = openDatabase(join(dir, 't.db'));
    runMigrations(db, 'db/migrations');
    coversDir = join(dir, 'covers');
    mkdirSync(coversDir, { recursive: true });
    cpSync(FIXTURES, coversDir, { recursive: true });
    writeFileSync(join(coversDir, 'garbage.jpg'), Buffer.alloc(64, 0x00)); // 非 JPEG → decode_error

    const insA = db.prepare(
      'INSERT INTO album_metadata (id, source, source_id, title, artist, release_year, genres, cover_local, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
    );
    const insR = db.prepare(
      'INSERT INTO collection_record (id, user_id, album_id, added_at, listened_at, listened_precision, note, is_favorite, cover_color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    );
    ROWS.forEach((row, i) => {
      const albumId = randomUUID();
      const recordId = randomUUID();
      const ts = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
      insA.run(albumId, 'musicbrainz', `dev-${i}`, `专辑 ${row.key}`, '艺术家', 2020, null, row.cover, ts, ts);
      insR.run(recordId, 'local', albumId, ts, null, null, null, 0, row.color, ts, ts);
      ids.set(row.key, recordId);
    });
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('单张提取：fixture → 期望色板值（含保留槽 16 → null）', () => {
    assert.deepEqual(extractCoverColor(load('red.jpg')), { ok: true, color: 1 });
    assert.deepEqual(extractCoverColor(load('blue.jpg')), { ok: true, color: 8 });
    assert.deepEqual(extractCoverColor(load('mixed.jpg')), { ok: true, color: 1 }); // 2:1 红 > 蓝
    assert.deepEqual(extractCoverColor(load('cyan.jpg')), { ok: true, color: null }); // 色板外 → 保留槽
    assert.deepEqual(extractCoverColor(load('white.jpg')), { ok: true, color: 15 });
    assert.equal(extractCoverColor(Buffer.alloc(16, 0x00)).ok, false); // 非 JPEG → 失败不抛
  });

  test('色板吸附纯函数：15 定义色自映射；#00FFFF 命中保留槽 16 → null', () => {
    for (const p of PALETTE) assert.equal(snapToPalette(p.rgb), p.id, `${p.id} ${p.hex} 应自映射`);
    assert.equal(snapToPalette([0, 255, 255]), null);
  });

  test('dry-run：候选 7、将写 4、保留槽 1、失败 2，且不落库', async () => {
    const stats = await runBackfill(db, coversDir, { dryRun: true });
    assert.equal(stats.total_records, 9);
    assert.equal(stats.with_cover, 8);
    assert.equal(stats.already_colored, 1);
    assert.equal(stats.candidates, 7);
    assert.equal(stats.processed, 6); // 7 候选 - 1 缺文件（读失败不计 processed）
    assert.equal(stats.written_color, 4);
    assert.equal(stats.written_reserved16_null, 1);
    assert.deepEqual(stats.failed, { missing_file: 1, 'decode_error: SOI not found': 1 });
    assert.equal(stats.written_color > 0 && stats.backfill_rate > 0, true);
    for (const key of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r9']) assert.equal(colorOf(key), null, `${key} dry-run 不落库`);
  });

  test('--limit=2：只处理 added_at 最前的 2 条', async () => {
    const stats = await runBackfill(db, coversDir, { limit: 2 });
    assert.equal(stats.candidates, 2);
    assert.equal(stats.written_color, 2);
    assert.equal(colorOf('r1'), 1);
    assert.equal(colorOf('r2'), 8);
    assert.equal(colorOf('r3'), null); // 未轮到
  });

  test('全量回填：r1=1 r2=8 r3=1 r5=15；r4/r6/r9 保持 NULL；回填率 = 5/8', async () => {
    const stats = await runBackfill(db, coversDir, {});
    assert.equal(stats.candidates, 5);
    assert.equal(stats.written_color, 2); // r3/r5（r1/r2 已被 limit 批写掉；r4=保留槽、r6/r9=失败）
    assert.equal(colorOf('r3'), 1);
    assert.equal(colorOf('r5'), 15);
    assert.equal(colorOf('r4'), null); // 保留槽 16：不 UPDATE，NULL 即语义
    assert.equal(colorOf('r6'), null);
    assert.equal(colorOf('r9'), null);
    assert.equal(colorOf('r7'), 4); // 已有值不回填
    assert.equal(colorOf('r8'), null); // 无封面
    assert.equal(stats.already_colored, 3); // 本库时点：r1/r2 + r7
    assert.ok(Math.abs(stats.backfill_rate - 5 / 8) < 1e-9);
  });

  test('幂等：重跑不再写任何色值，回填率不变（保留槽/失败行按设计留作重试候选）', async () => {
    const again = await runBackfill(db, coversDir, {});
    assert.equal(again.candidates, 3); // r4（保留槽→NULL，无 UPDATE）/r6/r9（失败重试）
    assert.equal(again.processed, 2); // r6 缺文件不计
    assert.equal(again.written_color, 0);
    assert.equal(again.written_reserved16_null, 1);
    assert.ok(Math.abs(again.backfill_rate - 5 / 8) < 1e-9);
  });
});
