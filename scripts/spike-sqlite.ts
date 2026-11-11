// D2 spike（五维复审报告 §8 清单）：node:sqlite 特性实测
// 验证项：1 backup() vs VACUUM INTO（WAL 活动期）2 per-connection PRAGMA 3 json_each
// 4 迁移执行器 5 Statement/Database 类名（DEP0210/0211）6 row-value cursor 7 参数绑定 8 RSS
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import * as sqlite from 'node:sqlite';
import { openDatabase } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
  ms?: number;
}

const out: Check[] = [];
const dir = mkdtempSync(join(tmpdir(), 'mg-spike-'));
const db = openDatabase(join(dir, 'spike.db'));
const N = 5000;

out.push({ name: 'migrations_runner', pass: runMigrations(db, 'db/migrations') === 1, detail: '0001 applied' });

const out1 = db.prepare('SELECT 1 AS x').constructor.name;
out.push({ name: 'statement_class_name', pass: ['Statement', 'StatementSync'].includes(out1), detail: out1 });

// 5000 行种子（bulk + 单事务），覆盖 LIKE / json_each / cursor 实测
db.exec('BEGIN IMMEDIATE');
const insA = db.prepare(
  'INSERT INTO album_metadata (id, source, source_id, title, artist, release_year, genres, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
);
const insR = db.prepare(
  'INSERT INTO collection_record (id, user_id, album_id, added_at, listened_at, listened_precision, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
);
const t0 = performance.now();
const base = Date.UTC(2022, 0, 1);
for (let i = 0; i < N; i++) {
  const albumId = randomUUID();
  const added = new Date(base + i * 36_000_000).toISOString();
  insA.run(
    albumId,
    'musicbrainz',
    `spike-${i}`,
    `Spike Album ${i}`,
    `Artist ${i % 500}`,
    1950 + (i % 76),
    JSON.stringify(i % 7 === 0 ? ['爵士', 'Electronic'] : ['Electronic', 'Jazz', 'Ambient']),
    added,
    added
  );
  insR.run(
    randomUUID(),
    'local',
    albumId,
    added,
    `${1950 + (i % 76)}-01-01T00:00:00Z`,
    'year',
    i % 5 < 2 ? `Spike note ${i}: ambient 循环 深夜 drives me home` : null,
    added,
    added
  );
}
db.exec('COMMIT');
out.push({ name: 'bulk_insert_5000', pass: true, detail: `${N} albums+records, 1 tx`, ms: Math.round(performance.now() - t0) });

const pragma = (name: string): unknown => (db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined)?.[name];
const pragmas = {
  journal_mode: pragma('journal_mode'),
  synchronous: pragma('synchronous'),
  cache_size: pragma('cache_size'),
  foreign_keys: pragma('foreign_keys'),
  // 注：PRAGMA busy_timeout 的返回列名为 timeout（SQLite 规范）
  busy_timeout: (db.prepare('PRAGMA busy_timeout').get() as Record<string, unknown> | undefined)?.['timeout']
};
out.push({
  name: 'per_connection_pragmas',
  pass: pragmas.journal_mode === 'wal' && pragmas.foreign_keys === 1 && pragmas.busy_timeout === 5000 && pragmas.cache_size === -8000,
  detail: JSON.stringify(pragmas)
});

const timeMin = (fn: () => void, runs = 3): number => {
  let min = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    min = Math.min(min, performance.now() - t);
  }
  return Math.round(min);
};

const likeMs = timeMin(() => {
  db.prepare("SELECT COUNT(*) AS n FROM collection_record WHERE note LIKE '%zzz-no-such-token%'").get();
});
out.push({ name: 'like_fullscan', pass: likeMs < 5, detail: `LIKE 全扫 ${N} 行`, ms: likeMs });

const genreMs = timeMin(() => {
  db.prepare(
    'SELECT je.value AS value, COUNT(*) AS count FROM collection_record r JOIN album_metadata m ON m.id = r.album_id, json_each(m.genres) je GROUP BY je.value ORDER BY count DESC'
  ).all();
});
out.push({ name: 'json_each_genre_count', pass: genreMs < 10, detail: 'genre 轴 facet 计数（复审口径 <10ms）', ms: genreMs });

// row-value 复合 cursor（复审 V11）
const page1 = db
  .prepare('SELECT r.added_at, r.id FROM collection_record r ORDER BY r.added_at DESC, r.id DESC LIMIT 10')
  .all() as Array<{ added_at: string; id: string }>;
const last1 = page1.at(-1);
if (last1 === undefined) throw new Error('spike: empty page1');
const page2 = db
  .prepare('SELECT r.id FROM collection_record r WHERE (r.added_at, r.id) < (?, ?) ORDER BY r.added_at DESC, r.id DESC LIMIT 10')
  .all(last1.added_at, last1.id) as Array<{ id: string }>;
out.push({
  name: 'row_value_cursor',
  pass: page2.length === 10 && page1.every((p1) => page2.every((p2) => p2.id !== p1.id)),
  detail: '第二页与第一页无重叠'
});

// backup() API（FC1：v22.16/v23.8 起模块级函数，复审核实 + 运行时已确认导出）——在 WAL 活动期执行
const backupPath = join(dir, 'spike-backup.db');
db.prepare('INSERT INTO album_metadata (id, source, source_id, title, artist, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
  randomUUID(),
  'musicbrainz',
  'spike-dirty',
  'WAL Dirty Album',
  'Artist X',
  new Date().toISOString(),
  new Date().toISOString()
);
const tBk = performance.now();
await backup(db, backupPath, { rate: 512 });
const bkMs = Math.round(performance.now() - tBk);
const verify = new sqlite.DatabaseSync(backupPath, { readOnly: true });
const n = (verify.prepare('SELECT COUNT(*) AS n FROM album_metadata').get() as { n: number }).n;
verify.close();
out.push({ name: 'backup_api_wal_active', pass: n === N + 1, detail: `WAL 未 checkpoint 时快照含最新提交（${n} 行）`, ms: bkMs });

// VACUUM INTO（SQLite 3.27+，同步紧凑快照）
const vacPath = join(dir, 'spike-vacuum.db');
const tVac = performance.now();
db.exec(`VACUUM INTO '${vacPath.replace(/'/g, "''")}'`);
const vacMs = Math.round(performance.now() - tVac);
const vacDb = new sqlite.DatabaseSync(vacPath, { readOnly: true });
const vacN = (vacDb.prepare('SELECT COUNT(*) AS n FROM album_metadata').get() as { n: number }).n;
vacDb.close();
out.push({ name: 'vacuum_into_wal_active', pass: vacN === N + 1, detail: `快照 ${vacN} 行（应为 ${N + 1}）`, ms: vacMs });

// DDL 事务性（迁移执行器依据）
db.exec('BEGIN');
db.exec('CREATE TABLE spike_tmp (x INTEGER)');
db.exec('ROLLBACK');
const tmpExists = db.prepare("SELECT name FROM sqlite_master WHERE name = 'spike_tmp'").get();
out.push({ name: 'ddl_transactional', pass: tmpExists === undefined, detail: 'DDL 随事务回滚' });

// 参数绑定 roundtrip
const bind = db.prepare('SELECT ? AS a, ? AS b, ? AS c').get(42, '文本', null) as Record<string, unknown>;
out.push({ name: 'param_binding', pass: bind['a'] === 42 && bind['b'] === '文本' && bind['c'] === null, detail: JSON.stringify(bind) });

out.push({
  name: 'rss_after_load',
  pass: true,
  detail: `${Math.round(process.memoryUsage().rss / 1048576)}MB（目标 <100MB 参考）`
});

db.close();
console.log(
  JSON.stringify(
    {
      node: process.version,
      spike_dir: dir,
      results: out,
      summary: { passed: out.filter((c) => c.pass).length, total: out.length }
    },
    null,
    2
  )
);
