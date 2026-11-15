// 翻箱 / 收藏全景 / 随机一张 / 感官层开关冒烟（R-106/R-107/R-108 · S2-12~S2-23；
// 评审案 docs/design-refs-review.md Q5/Q6/Q7/Q8）：SSR 首箱 + 续箱 cursor 顺链 + 随机 302 +
// panorama 数据 envelope + 全表读豁免实测 + sensory cookie 语义 + 守卫拓扑。
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
const recordIds: string[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mg-views2-'));
  db = openDatabase(join(dir, 't.db'));
  runMigrations(db, 'db/migrations');
  dao = new DAO(db);
  const cfg: Config = loadConfig();
  ensureDirs(cfg);
  app = createApp(dao, cfg, [new MusicBrainzSource(new MusicBrainzClient(new MetadataRateLimiter({ minIntervalMs: 0 }), cfg.userAgent, stubFetch))]);
  const ok = await app.request('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `access_key=${encodeURIComponent(cfg.accessKey)}` });
  cookie = (ok.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  for (let i = 1; i <= 3; i++) {
    const a = dao.upsertAlbum({ source: 'user-provided', source_id: `v2-${String(i)}`, title: `箱子里的第 ${String(i)} 张`, artist: `艺术家 ${String(i)}`, genres: ['Jazz'] });
    const r = dao.createRecord({ album_id: a.id, note: i === 1 ? '第一张' : null });
    recordIds.push(r.id);
  }
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (path: string) => app.request(path, { headers: { cookie }, redirect: 'manual' });
const post = (path: string, body: string, withOrigin = true) =>
  app.request(path, {
    method: 'POST',
    headers: {
      cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(withOrigin ? { Origin: 'http://localhost:3000', Host: 'localhost:3000' } : {})
    },
    body,
    redirect: 'manual'
  });

describe('/crate 翻箱（R-108 · S2-20/21/22）', () => {
  test('200：侧脊陈列 + 岛屿根 + 随机入口 + 感官层开关', async () => {
    const res = await get('/crate');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('data-island="crate-flip"'), '岛屿根在档');
    assert.ok(html.includes('class="spine"'), '侧脊卡片在档');
    assert.ok(html.includes('href="/album/'), '侧脊 = 原生链接（无 JS 可用）');
    assert.ok(html.includes('href="/random"'), '随机一张入口（档案非空才渲染）');
    assert.ok(html.includes('感官层 关·点此开启缓动'), '感官层缺省 = 安静（S2-17）');
    assert.ok(html.includes('data-next-cursor='), 'cursor 顺链透传');
  });

  test('续箱 fragment：data-next 透传 + 侧脊片段（wall-scroll 同族）', async () => {
    const res = await get('/fragment/crate');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('crate-more'), '片段根在档');
    assert.ok(html.includes('data-next='), 'next cursor 属性在档');
  });
});

describe('/random 随机一张（S2-23）', () => {
  test('302 → /album/:id（本地 ORDER BY RANDOM，零上游）', async () => {
    const res = await get('/random');
    assert.equal(res.status, 302);
    const loc = res.headers.get('Location') ?? '';
    assert.ok(loc.startsWith('/album/'), `Location=${loc}`);
    assert.ok(recordIds.some((id) => loc === `/album/${id}`), '随机结果 ∈ 档案');
  });
});

describe('/panorama 收藏全景（R-106 · S2-13/14）', () => {
  test('200：Canvas 岛屿宿主 + noscript 诚实降级', async () => {
    const res = await get('/panorama');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('data-island="panorama-view"'), '岛屿根在档');
    assert.ok(html.includes('<canvas'), 'canvas 在档');
    assert.ok(html.includes('<noscript>'), 'noscript 降级在档');
  });

  test('数据端点：envelope {data} + 全量节点 + 坐标 0..1000（S2-12 布局）', async () => {
    const res = await get('/fragment/panorama-data');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { w: number; h: number; nodes: Array<{ i: string; x: number; y: number; c: number | null; u: string | null; t: string; a: string }>; stats: { records: number; clusters: number } } };
    assert.equal(body.data.stats.records, 3);
    assert.equal(body.data.nodes.length, 3);
    assert.equal(body.data.w, 1000);
    for (const n of body.data.nodes) {
      assert.ok(n.x >= 0 && n.x <= 1000 && n.y >= 0 && n.y <= 1000, `坐标越界: ${String(n.x)},${String(n.y)}`);
      assert.equal(typeof n.t, 'string');
    }
    // 确定性（同库同坐标）
    const res2 = await get('/fragment/panorama-data');
    assert.equal(JSON.stringify((await res2.json()).data.nodes), JSON.stringify(body.data.nodes));
  });
});

describe('POST /settings/sensory 感官层开关（S2-17）', () => {
  test('on → Set-Cookie mg_sensory=on + 303 回 to 路径', async () => {
    const res = await post('/settings/sensory', 'action=on&to=%2Fcrate');
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('Location'), '/crate');
    const set = res.headers.get('Set-Cookie') ?? '';
    assert.ok(set.includes('mg_sensory=on'), `Set-Cookie=${set}`);
    assert.ok(set.includes('HttpOnly'), 'HttpOnly（V10 纪律）');
  });

  test('off → 清 cookie 回缺省安静态', async () => {
    const res = await post('/settings/sensory', 'action=off&to=%2Fgenres');
    assert.equal(res.status, 303);
    const set = res.headers.get('Set-Cookie') ?? '';
    assert.ok(set.includes('mg_sensory=') && (set.includes('Expires=Thu, 01 Jan 1970') || set.includes('Max-Age=0')), `清除语义: ${set}`);
  });

  test('开放重定向防护：to=//evil → 落 /', async () => {
    const res = await post('/settings/sensory', 'action=on&to=%2F%2Fevil.example');
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('Location'), '/');
  });

  test('跨站 Origin → 403（sameOrigin CSRF；无 Origin + 同 Host = W1-1 Host 回退先例不拦）', async () => {
    const res = await app.request('/settings/sensory', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example', Host: 'localhost:3000' },
      body: 'action=on&to=%2F',
      redirect: 'manual'
    });
    assert.equal(res.status, 403);
  });
});

describe('页脚入口 + 守卫拓扑', () => {
  test('主页页脚含三视图入口（S2-16 文案层）', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('href="/crate"') && html.includes('href="/genres"') && html.includes('href="/panorama"'), '页脚三入口在档');
  });

  test('匿名：/crate /panorama /random /fragment/panorama-data 全部 302（页面守卫拓扑）', async () => {
    for (const p of ['/crate', '/panorama', '/random', '/fragment/panorama-data', '/fragment/crate']) {
      const res = await app.request(p, { redirect: 'manual' });
      assert.equal(res.status, 302, `${p} 匿名应 302`);
      assert.ok((res.headers.get('Location') ?? '').startsWith('/login'), `${p} → /login`);
    }
  });
});
