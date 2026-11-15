// 性能验收（W4-6-2 · PM W4 门禁）：5000 种子上四字段 LIKE（标题/艺术家/Tag/Note 片段）单次查询 <200ms。
// 口径说明：派工（07-前端设计包/02 §7 P2）原文「复用 DAO searchRecords」——主线 DAO 无此方法，
// 对应能力 = listPage({ filters: { q } })（buildWhere 的 q 分支：title/artist/note/tag.name 四字段
// LIKE，见 src/server/db/sql.ts）。此处按主线契约走 listPage，语义与派工口径一致（披露登记）。
// 独立文件名防冲突（与其他 smoke 套件零交集）；数据 = 测试内确定性直插（同 scripts/seed-dev.ts 形态）。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { DAO } from '../src/server/db/dao';

const N = 5000;
const BUDGET_MS = 200;

let dir: string;
let db: Db;
let dao: DAO;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'mg-perf-like-'));
  db = openDatabase(join(dir, 'perf.db'));
  runMigrations(db, 'db/migrations');

  const artists = ['John Coltrane', 'Miles Davis', 'Radiohead', 'Daft Punk', 'Aphex Twin', 'Björk', 'Nirvana', '坂本龙一', '王菲', '万能青年旅店'];
  const t0 = performance.now();
  db.exec('BEGIN IMMEDIATE');
  const insA = db.prepare('INSERT INTO album_metadata (id, source, source_id, title, artist, release_year, genres, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const insR = db.prepare('INSERT INTO collection_record (id, user_id, album_id, added_at, listened_at, listened_precision, note, is_favorite, cover_color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const insT = db.prepare('INSERT INTO tags (id, user_id, name, normalized_name, created_at) VALUES (?,?,?,?,?)');
  const insRT = db.prepare('INSERT INTO record_tag (record_id, tag_id, created_at) VALUES (?,?,?)');
  const tagId = randomUUID();
  const now = new Date('2026-11-13T00:00:00Z').toISOString();
  insT.run(tagId, 'local', '夜晚', '夜晚', now);
  for (let i = 0; i < N; i++) {
    const albumId = randomUUID();
    const recordId = randomUUID();
    // 四字段命中面：title 1/5 含 'Blue'；artist 轮换（'Coltrane' 1/10）；note 1/4 含 '深夜'；tag 挂 1/2 '夜晚'
    const title = i % 5 === 0 ? `Blue Notes Vol.${i}` : `Silent Waves Vol.${i}`;
    const artist = artists[i % artists.length] as string; // 最小修复 2026-11-13：noUncheckedIndexedAccess 挡 typecheck（并行 W3-1 会话门禁）
    const added = new Date(Date.UTC(2025, i % 12, (i % 28) + 1)).toISOString();
    insA.run(albumId, 'musicbrainz', `perf-${i}`, title, artist, 1950 + (i % 76), i % 10 === 0 ? '["Electronic"]' : null, now, now);
    insR.run(recordId, 'local', albumId, added, i % 3 === 0 ? added : null, i % 3 === 0 ? 'day' : null, i % 4 === 0 ? `深夜循环的记录 ${i}` : null, 0, null, now, now);
    if (i % 2 === 0) insRT.run(recordId, tagId, now);
  }
  db.exec('COMMIT');
  dao = new DAO(db);
  console.log(`seed ${N} rows in ${Math.round(performance.now() - t0)}ms`);
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 单次 q 检索计时断言（DAO 层完整调用，含首次 prepare——StmtCache 冷启动真实口径） */
function assertLikeWithinBudget(field: string, q: string, minExpected: number): void {
  const t = performance.now();
  const { items, meta } = dao.listPage({ filters: { q }, limit: 60 });
  const ms = Math.round(performance.now() - t);
  assert.ok(items.length > 0, `${field} 片段「${q}」应非空命中`);
  assert.ok(meta.has_next, `${field} 片段「${q}」命中应超单页（≥${minExpected}）`);
  assert.ok(ms < BUDGET_MS, `${field} LIKE 用时 ${ms}ms ≥ 预算 ${BUDGET_MS}ms`);
  console.log(`LIKE ${field.padEnd(8)} q="${q}" → ${ms}ms (page 60, has_next=${meta.has_next})`);
}

test('title 片段 LIKE <200ms', () => assertLikeWithinBudget('title', 'Blue', N / 5));
test('artist 片段 LIKE <200ms', () => assertLikeWithinBudget('artist', 'Coltrane', N / 10));
test('tag 片段 LIKE <200ms', () => assertLikeWithinBudget('tag', '夜晚', N / 2));
test('note 片段 LIKE <200ms', () => assertLikeWithinBudget('note', '深夜', N / 4));
test('转义字符 q 不抛错（R10 语义回归）', () => {
  const { items } = dao.listPage({ filters: { q: '%' }, limit: 10 });
  assert.equal(items.length, 0); // % 已转义为字面量 → 零命中而非全表
});
