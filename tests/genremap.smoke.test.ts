// 流派星图域冒烟（R-109 · S2-24/25/26；评审案 docs/design-refs-review.md Q2/Q3/Q4）：
// 共现口径（同记录 Genre×Tag 两两组合）/ overlap 相似度 / 布局确定性（同库同坐标，mulberry32
// 固定种子）/ 纯 SSR 页面（everynoise 机制同款：绝对定位标签 + chips 同语义链接）/ 守卫语义。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Hono } from 'hono';
import { createApp } from '../src/server/app';
import { ensureDirs, loadConfig, type Config } from '../src/server/config';
import { DAO } from '../src/server/db/dao';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { MusicBrainzClient } from '../src/server/metadata/musicbrainz';
import { MusicBrainzSource } from '../src/server/metadata/sources';
import { MetadataRateLimiter } from '../src/server/metadata/queue';

const stubFetch = (async () =>
  new Response(JSON.stringify({ releases: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

let dir: string;
let db: Db;
let dao: DAO;
let app: Hono;
let cookie = '';

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mg-genremap-'));
  db = openDatabase(join(dir, 't.db'));
  runMigrations(db, 'db/migrations');
  dao = new DAO(db);
  const cfg: Config = loadConfig();
  ensureDirs(cfg);
  app = createApp(dao, cfg, [new MusicBrainzSource(new MusicBrainzClient(new MetadataRateLimiter({ minIntervalMs: 0 }), cfg.userAgent, stubFetch))]);
  const ok = await app.request('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `access_key=${encodeURIComponent(cfg.accessKey)}` });
  cookie = (ok.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (path: string) => app.request(path, { headers: { cookie }, redirect: 'manual' });

/** 种子：A1 = Jazz+Fusion ×（夜晚,开车）/ A2 = Jazz ×（夜晚）/ A3 = Electronic ×（开车） */
const seed = (): void => {
  const a1 = dao.upsertAlbum({ source: 'user-provided', source_id: 'gm-1', title: '夜间爵士', artist: '三重奏', genres: ['Jazz', 'Fusion'] });
  const r1 = dao.createRecord({ album_id: a1.id });
  dao.setTags(r1.id, ['夜晚', '开车']);
  const a2 = dao.upsertAlbum({ source: 'user-provided', source_id: 'gm-2', title: '清晨爵士', artist: '四重奏', genres: ['Jazz'] });
  const r2 = dao.createRecord({ album_id: a2.id });
  dao.setTags(r2.id, ['夜晚']);
  const a3 = dao.upsertAlbum({ source: 'user-provided', source_id: 'gm-3', title: '公路电子', artist: 'DJ', genres: ['Electronic'] });
  const r3 = dao.createRecord({ album_id: a3.id });
  dao.setTags(r3.id, ['开车']);
  void r3;
};
seed();

describe('genreMap 域（R-109 · S2-24 共现 + 确定性布局）', () => {
  test('节点覆盖 Genre+Tag、覆盖数正确', () => {
    const map = dao.genreMap();
    const byName = new Map(map.nodes.map((n) => [`${n.kind}:${n.name}`, n]));
    assert.equal(byName.get('genre:Jazz')?.count, 2);
    assert.equal(byName.get('genre:Fusion')?.count, 1);
    assert.equal(byName.get('genre:Electronic')?.count, 1);
    assert.equal(byName.get('tag:夜晚')?.count, 2);
    assert.equal(byName.get('tag:开车')?.count, 2);
    assert.equal(map.stats.genres, 3);
    assert.equal(map.stats.tags, 2);
    assert.equal(map.stats.maxCount, 2);
  });

  test('共现边数 = 去重后的同记录对（实测对账 7：gg 1 + tt 1 + gt 5——Jazz×夜晚 跨记录同对已 GROUP）', () => {
    // 手工对账（与 SQL 实测一致）：gg = Fusion-Jazz；tt = 夜晚-开车；
    // gt = Electronic-开车 / Fusion-夜晚 / Fusion-开车 / Jazz-夜晚(w2) / Jazz-开车 = 5 → 合计 7
    const map = dao.genreMap();
    assert.equal(map.stats.edges, 7);
  });

  test('布局确定性：两次调用同坐标，且坐标在 0..100', () => {
    const a = JSON.stringify(dao.genreMap());
    const b = JSON.stringify(dao.genreMap());
    assert.equal(a, b);
    const map = dao.genreMap();
    for (const n of map.nodes) {
      assert.ok(n.x >= 0 && n.x <= 100, `x 越界: ${String(n.x)}`);
      assert.ok(n.y >= 0 && n.y <= 100, `y 越界: ${String(n.y)}`);
    }
  });

  test('空档案：零节点诚实（0/0 无定义不伪造）', () => {
    const fresh = new DAO(db); // 同库新 DAO 实例不改变数据——用独立空库验证
    const dir2 = mkdtempSync(join(tmpdir(), 'mg-genremap-empty-'));
    const db2 = openDatabase(join(dir2, 'e.db'));
    try {
      runMigrations(db2, 'db/migrations');
      const emptyDao = new DAO(db2);
      const map = emptyDao.genreMap();
      assert.equal(map.nodes.length, 0);
      assert.equal(map.stats.edges, 0);
    } finally {
      db2.close();
      rmSync(dir2, { recursive: true, force: true });
    }
    void fresh;
  });
});

describe('/genres 页面（R-109 · S2-25/26 纯 SSR 星图）', () => {
  test('200：绝对定位节点 + chips 同语义链接 + 统计行', async () => {
    const res = await get('/genres');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('class="gmap"'), '星图容器在档');
    assert.ok(html.includes('href="/?genre=Jazz"'), 'Genre 节点 → 筛选 URL（chips 同语义）');
    assert.ok(html.includes('href="/?tag='), 'Tag 节点 → 筛选 URL');
    assert.ok(html.includes('gnode-genre') && html.includes('gnode-tag'), '双形态区分');
    assert.ok(html.includes('2 个流派') === false && html.includes('个流派'), '统计行在档');
  });

  test('匿名 302（页面守卫，D1 拓扑）', async () => {
    const res = await app.request('/genres', { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.ok((res.headers.get('Location') ?? '').startsWith('/login'));
  });
});
