/**
 * genre-map-layout.ts —— 流派星图布局 CLI（R-109 · S2-24，评审案 docs/design-refs-review.md Q2；
 * color-extract CLI 先例同款）。读取档案库 → Genre×Tag 共现 + 确定性力导向布局 →
 * 写 JSON 产物（离线检视 / 备份）。SSR 页面（/genres）直算同函数不依赖本脚本——
 * 产物仅是离线检视与可复算证据（同库同坐标，mulberry32 固定种子）。
 *
 * 用法：tsx scripts/genre-map-layout.ts [--db <path>] [--out <path>]
 *   默认 --db data/db/musicgraphy.db，--out data/genre-map.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDatabase } from '../src/server/db/connection';
import { StmtCache } from '../src/server/db/sql';
import { genreMap } from '../src/server/db/genremap';

const arg = (name: string, def: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return typeof v === 'string' && v !== '' ? v : def;
};

const dbPath = resolve(arg('db', 'data/db/musicgraphy.db'));
const outPath = resolve(arg('out', 'data/genre-map.json'));

const db = openDatabase(dbPath);
try {
  const map = genreMap(new StmtCache(db));
  mkdirSync(dirname(outPath), { recursive: true });
  const payload = JSON.stringify({ version: 1, generated_at: new Date().toISOString(), ...map }, null, 2);
  writeFileSync(outPath, payload);
  console.log(
    `[genre-map-layout] nodes=${String(map.stats.nodes)} (genres=${String(map.stats.genres)} tags=${String(map.stats.tags)}) ` +
      `edges=${String(map.stats.edges)} maxCount=${String(map.stats.maxCount)} bytes=${String(payload.length)} -> ${outPath}`
  );
} finally {
  db.close();
}
