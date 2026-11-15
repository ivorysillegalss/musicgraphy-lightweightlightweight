// Topster 策展域冒烟（W10-12-1 W10 批；评审案 docs/topster-review.md §5，用户 2026-11-14 AskUserQuestion 批准实现）：
// topster_views = Collection 一种 View（item_order 只存 collection_record.id 引用，禁第二套数据）·
// 策展仅顺序+副标题（禁自由画布）· 容量 ≤60（内存纪律①对齐）· 无 JS 页面通道（POST+303；校验失败 303+flash=error
// 数据不变——views 页面通道静默先例 + flashBanner 语义）· 失效引用诚实计数（Q7）。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Hono } from 'hono';
import { createApp } from '../src/server/app';
import { ensureDirs, loadConfig, type Config } from '../src/server/config';
import { DAO, NotFoundError } from '../src/server/db/dao';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { parseItemOrder, TOPSTER_CAPACITY } from '../src/server/db/topster';
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
  dir = mkdtempSync(join(tmpdir(), 'mg-topster-'));
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
const post = (path: string, body: string) =>
  app.request(path, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://localhost:3000', Host: 'localhost:3000' }, body, redirect: 'manual' });

/** 种子成员记录（user-provided 直建，零上游）：返回 record id */
let seq = 0;
const seedRecord = (title: string): string => {
  seq++;
  const { id } = dao.upsertAlbum({
    source: 'user-provided',
    source_id: `topster-fixture-${String(seq)}`,
    title,
    artist: `艺术家 ${String(seq % 3)}`,
    genres: []
  });
  const rec = dao.createRecord({ album_id: id });
  return rec.id;
};

describe('Topster DAO 层（topster_views · 02 §6 原形 5 字段）', () => {
  test('创建/读/改名/删除全链路；item_order 只存 record id 引用（View 语义）', () => {
    const r1 = seedRecord('青旅的天台');
    const r2 = seedRecord('夏夜公路');
    const { id } = dao.createTopster('2026 年度 Top', '那些在夏天循环的');
    const t = dao.getTopster(id);
    assert.ok(t !== undefined);
    assert.equal(t.title, '2026 年度 Top');
    assert.equal(t.subtitle, '那些在夏天循环的');
    assert.equal(t.item_order, '[]'); // 空策展开始（02 §6 原形 DEFAULT '[]'）

    assert.equal(dao.addTopsterMember(id, r1), 'added');
    assert.equal(dao.addTopsterMember(id, r2), 'added');
    assert.equal(dao.getTopster(id)?.item_order, JSON.stringify([r1, r2])); // 顺序即叙事（案 2 底线）

    dao.updateTopsterMeta(id, '改后标题', null);
    assert.equal(dao.getTopster(id)?.title, '改后标题');
    assert.equal(dao.getTopster(id)?.subtitle, null);

    dao.deleteTopster(id);
    assert.equal(dao.getTopster(id), undefined);
    assert.throws(() => dao.deleteTopster(id), NotFoundError);
  });

  test('成员操作语义：重复加入/容量 60/越权 record 拒绝；move up·down 交换；remove', () => {
    const ids = Array.from({ length: 3 }, (_, i) => seedRecord(`容量序 ${String(i)}`));
    const { id } = dao.createTopster('成员语义', null);
    for (const rid of ids) assert.equal(dao.addTopsterMember(id, rid), 'added');
    assert.equal(dao.addTopsterMember(id, ids[0] as string), 'duplicate'); // 重复拒绝
    assert.equal(dao.addTopsterMember(id, 'no-such-record'), 'invalid_record'); // 越权/悬空引用拒绝
    assert.equal(dao.addTopsterMember('no-such-topster', ids[0] as string), 'not_found');

    assert.equal(dao.moveTopsterMember(id, ids[2] as string, 'up'), 'moved');
    assert.deepEqual(parseItemOrder(dao.getTopster(id)?.item_order ?? '[]'), [ids[0], ids[2], ids[1]]);
    assert.equal(dao.moveTopsterMember(id, ids[0] as string, 'up'), 'no_change'); // 越界 = 不变（幂等）
    assert.equal(dao.moveTopsterMember(id, 'not-in-list', 'down'), 'no_change');
    assert.equal(dao.removeTopsterMember(id, ids[1] as string), 'removed');
    assert.deepEqual(parseItemOrder(dao.getTopster(id)?.item_order ?? '[]'), [ids[0], ids[2]]);
    assert.equal(dao.removeTopsterMember(id, 'not-in-list'), 'no_change');
    dao.deleteTopster(id);
  });

  test('容量 ≤60（内存纪律① LIMIT≤60 对齐，零豁免）', () => {
    const { id } = dao.createTopster('满员', null);
    const filler = Array.from({ length: TOPSTER_CAPACITY }, (_, i) => seedRecord(`满员 ${String(i)}`));
    for (const rid of filler) assert.equal(dao.addTopsterMember(id, rid), 'added');
    const extra = seedRecord('第 61 张');
    assert.equal(dao.addTopsterMember(id, extra), 'full'); // 超容量拒绝
    assert.equal((parseItemOrder(dao.getTopster(id)?.item_order ?? '[]') ?? []).length, TOPSTER_CAPACITY);
    dao.deleteTopster(id);
  });

  test('parseItemOrder 容错：坏 JSON / 非字符串元素 / 超容量 → null', () => {
    assert.deepEqual(parseItemOrder('["a","b"]'), ['a', 'b']);
    assert.equal(parseItemOrder('not-json'), null);
    assert.equal(parseItemOrder('[1,2]'), null);
    assert.equal(parseItemOrder(JSON.stringify(Array.from({ length: TOPSTER_CAPACITY + 1 }, (_, i) => String(i)))), null);
  });

  test('View 语义：成员渲染实时取自档案；记录删除后引用失效如实计数（Q7 诚实占位）', () => {
    const r1 = seedRecord('会失效的');
    const r2 = seedRecord('会留下的');
    const { id } = dao.createTopster('失效计数', null);
    dao.addTopsterMember(id, r1);
    dao.addTopsterMember(id, r2);
    // 用户数据面改 tag → View 实时反映（不复制数据的证明）：略——覆盖渲染断言已足够
    db.exec(`DELETE FROM collection_record WHERE id = '${r1}'`); // 档案内删除成员记录
    const loaded = dao.topsterItems(parseItemOrder(dao.getTopster(id)?.item_order ?? '[]') ?? []);
    assert.equal(loaded.items.length, 1);
    assert.equal(loaded.items[0]?.id, r2);
    assert.equal(loaded.missing, 1); // 失效引用如实计数（渲染层显示「N 处引用已失效」）
    dao.deleteTopster(id);
  });

  test('memberCandidates：本地档案检索（不调上游）+ 排除已在列', () => {
    const a = seedRecord('青旅的天台 重访');
    const b = seedRecord('青旅的天台 二〇二六');
    const { id } = dao.createTopster('候选', null);
    dao.addTopsterMember(id, a);
    const cands = dao.memberCandidates(id, '青旅的天台');
    assert.ok(cands.some((it) => it.id === b)); // 未在列的命中
    assert.ok(!cands.some((it) => it.id === a)); // 已在列的排除
    dao.deleteTopster(id);
  });
});

describe('Topster 页面通道（无 JS 基线 · POST+303）', () => {
  let topsterId = '';
  let memberA = '';

  before(() => {
    memberA = seedRecord('页面通道 A');
    topsterId = dao.createTopster('页面策展', '一句副标题').id;
    dao.addTopsterMember(topsterId, memberA);
    dao.addTopsterMember(topsterId, seedRecord('页面通道 第二张')); // ≥2 成员：↑↓ form 在场断言
  });

  test('列表页渲染：新建 form + 每项 查看/删除 + 张数', async () => {
    const html = await (await get('/topsters')).text();
    assert.ok(html.includes('action="/topsters"'));
    assert.ok(html.includes(`href="/topsters/${topsterId}"`));
    assert.ok(html.includes('action="/topsters/delete"'));
    assert.ok(html.includes('顺序即叙事'));
  });

  test('策展页渲染：按 item_order 序网格 + 副标题 + 成员编辑行（↑↓/移除）+ 搜索加入区', async () => {
    const html = await (await get(`/topsters/${topsterId}`)).text();
    assert.ok(html.includes('页面策展'));
    assert.ok(html.includes('一句副标题'));
    assert.ok(html.includes('2/60'));
    assert.ok(html.includes(`action="/topsters/${topsterId}/move"`)); // ↑↓ form（无 JS 顺序编辑）
    assert.ok(html.includes('name="add_q"')); // 搜索加入区
    assert.ok(html.includes(`action="/topsters/${topsterId}/remove"`));
  });

  test('创建：POST 303 → 详情；空标题 303+flash=error 数据不变', async () => {
    const ok = await post('/topsters', 'title=测试创建&subtitle=');
    assert.equal(ok.status, 303);
    const loc = ok.headers.get('location') ?? '';
    assert.match(loc, /^\/topsters\/[0-9a-f-]{36}$/);
    dao.deleteTopster(loc.split('/topsters/')[1] ?? '');

    const bad = await post('/topsters', 'title=&subtitle=');
    assert.equal(bad.status, 303);
    assert.match(bad.headers.get('location') ?? '', /flash=error/);
    assert.ok(!dao.listTopsters().some((t) => t.title === ''));
  });

  test('成员加入：重复/越权 → 303+flash=error 数据不变（诚实红条，不静默伪造成功）', async () => {
    const before1 = dao.getTopster(topsterId)?.item_order;
    const dup = await post(`/topsters/${topsterId}/members`, `record_id=${encodeURIComponent(memberA)}`);
    assert.equal(dup.status, 303);
    assert.match(dup.headers.get('location') ?? '', /flash=error/);
    assert.equal(dao.getTopster(topsterId)?.item_order, before1);
    const invalid = await post(`/topsters/${topsterId}/members`, 'record_id=ghost-record');
    assert.match(invalid.headers.get('location') ?? '', /flash=error/);
    assert.equal(dao.getTopster(topsterId)?.item_order, before1);
    // flash=error 渲染红条
    const html = await (await get(`/topsters/${topsterId}?flash=error`)).text();
    assert.ok(html.includes('操作未生效'));
  });

  test('move/remove/update/delete 全通道 303 + 数据驱动断言', async () => {
    const tid = dao.createTopster('全通道', null).id;
    const a = seedRecord('全通道 A');
    const b = seedRecord('全通道 B');
    const c2 = seedRecord('全通道 C');
    await post(`/topsters/${tid}/members`, `record_id=${encodeURIComponent(a)}`);
    await post(`/topsters/${tid}/members`, `record_id=${encodeURIComponent(b)}`);
    await post(`/topsters/${tid}/members`, `record_id=${encodeURIComponent(c2)}`);
    assert.deepEqual(parseItemOrder(dao.getTopster(tid)?.item_order ?? '[]'), [a, b, c2]);

    await post(`/topsters/${tid}/move`, `record_id=${encodeURIComponent(c2)}&dir=up`);
    assert.deepEqual(parseItemOrder(dao.getTopster(tid)?.item_order ?? '[]'), [a, c2, b]);

    await post(`/topsters/${tid}/remove`, `record_id=${encodeURIComponent(c2)}`);
    assert.deepEqual(parseItemOrder(dao.getTopster(tid)?.item_order ?? '[]'), [a, b]);

    await post(`/topsters/${tid}/update`, 'title=改后&subtitle=改后副标');
    assert.equal(dao.getTopster(tid)?.title, '改后');
    assert.equal(dao.getTopster(tid)?.subtitle, '改后副标');

    const del = await post('/topsters/delete', `topster_id=${tid}`);
    assert.equal(del.status, 303);
    assert.match(del.headers.get('location') ?? '', /^\/topsters$/);
    assert.equal(dao.getTopster(tid), undefined);
    const delAgain = await post('/topsters/delete', `topster_id=${tid}`); // 幂等静默
    assert.equal(delAgain.status, 303);
  });

  test('守卫（D1 修复后口径）：匿名页面 302 /login + 带会话跨站 Origin（CSRF）403 + 匿名 POST 302（守卫先于 CSRF）', async () => {
    // D1 修复（用户 2026-11-15 裁决令）：installAuth use('/*') 全路径拦截，匿名页面一律 302 /login——
    // 原「与 /metrics 同口径匿名可达」固化现状口径随修复作废（12-技术债与依赖复盘 §2.1 D1）
    for (const p of ['/topsters', '/metrics']) {
      const anon = await app.request(p, { redirect: 'manual' });
      assert.equal(anon.status, 302);
      assert.match(anon.headers.get('location') ?? '', /^\/login/);
    }
    // V10 sameOrigin：Origin/Sec-Fetch-Site 双缺 = 非浏览器放行（密钥即凭据）；带会话跨站 Origin 必须 403
    const csrf = await app.request(`/topsters/${topsterId}/move`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://evil.example' }, body: 'record_id=x&dir=up', redirect: 'manual' });
    assert.equal(csrf.status, 403);
    // 匿名 POST：页面守卫先于路由/CSRF 执行 → 302 /login（无凭据谈不上 CSRF，CSRF 语义由上行带会话断言）
    const anonCsrf = await app.request('/topsters/delete', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://evil.example' }, body: 'topster_id=x', redirect: 'manual' });
    assert.equal(anonCsrf.status, 302);
    assert.match(anonCsrf.headers.get('location') ?? '', /^\/login/);
  });

  test('失效引用渲染：成员记录删除后策展页如实显示「N 处引用已失效」', async () => {
    const ghost = seedRecord('将被删除的成员');
    const tid = dao.createTopster('失效渲染', null).id;
    dao.addTopsterMember(tid, ghost);
    db.exec(`DELETE FROM collection_record WHERE id = '${ghost}'`);
    const html = await (await get(`/topsters/${tid}`)).text();
    assert.ok(html.includes('已不在档案')); // 诚实占位（Q7）
    assert.ok(html.includes('此记录已不在档案'));
    dao.deleteTopster(tid);
  });

  test('策展页导出入口：SVG 附件链接 + 海报页链接在场（有成员才显示）', async () => {
    const html = await (await get(`/topsters/${topsterId}`)).text();
    assert.ok(html.includes('export.svg')); // 案 A 入口
    assert.ok(html.includes('/poster')); // 案 C 入口
    const empty = dao.createTopster('空策展导出隐藏', null);
    const emptyHtml = await (await get(`/topsters/${empty.id}`)).text();
    assert.ok(!emptyHtml.includes('export.svg')); // 空策展无导出入口
    dao.deleteTopster(empty.id);
  });

  test('W11 案 A：export.svg 零依赖纯文本——XML 声明 + 署名内嵌 + attachment + 用户输入 XML 转义 + 封面 URL 引用（origin 拼接）', async () => {
    const evil = seedRecord('<恶意&标题>');
    // 带 cover_local 的成员：验证本地缓存封面拼 origin（脱离服务器后按部署地址加载，评审案 §3）
    seq++;
    const { id: covAlbum } = dao.upsertAlbum({ source: 'user-provided', source_id: `topster-cov-${String(seq)}`, title: '有封面的', artist: '艺术家', genres: [] });
    const covRec = dao.createRecord({ album_id: covAlbum });
    dao.setAlbumCoverLocal(covAlbum, 'abc123.jpg');
    const tid = dao.createTopster('转义<title>&测试', '副标题 "引号"').id;
    dao.addTopsterMember(tid, evil);
    dao.addTopsterMember(tid, covRec.id);
    const res = await get(`/topsters/${tid}/export.svg`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /image\/svg\+xml/);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment/); // 导出语义
    const svg = await res.text();
    assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(svg.includes('made with Musicgraphy')); // 署名内嵌（04B 引擎一）
    assert.ok(svg.includes('ORDER IS THE STORY'));
    assert.ok(!svg.includes('<恶意&标题>')); // 用户输入零 raw 插入（hono/html 同款纪律的 SVG 等价）
    assert.ok(svg.includes('&lt;恶意&amp;标题&gt;')); // escapeXml 落实
    assert.ok(!svg.includes('副标题 "引号"')); // 副标题引号同样转义
    assert.ok(svg.includes('&quot;引号&quot;'));
    assert.equal((svg.match(/<image /g) ?? []).length, 1); // 2 成员中 1 个有 cover_local → 1 个 image
    assert.ok(svg.includes('href="http://localhost/covers/abc123.jpg"')); // 本地封面 origin 拼接
    assert.ok(!svg.includes('data:image')); // 禁 base64 纪律②③（URL 引用不内嵌像素）
    assert.equal((svg.match(/<rect[^>]*fill="#8a8580"/g) ?? []).length, 2); // fallback 色块分层每成员一块（封面加载失败/无封面兜底）
    dao.deleteTopster(tid);
  });

  test('W11 案 C：海报页渲染——署名页脚 + 网格 + 无编辑区（截图即成图）', async () => {
    const res = await get(`/topsters/${topsterId}/poster`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('页面策展')); // 标题
    assert.ok(html.includes('made with Musicgraphy')); // 署名页脚
    assert.ok(html.includes('cover-wall')); // 大网格
    assert.ok(!html.includes('name="add_q"')); // 无搜索加入区
    assert.ok(!html.includes(`action="/topsters/${topsterId}/move"`)); // 无编辑区（↑↓）
  });

  test('W11 导出 404：不存在的策展 → 404 页面语义（同 /album/:id 先例）', async () => {
    const svg = await get('/topsters/no-such-id/export.svg');
    assert.equal(svg.status, 404);
    const poster = await get('/topsters/no-such-id/poster');
    assert.equal(poster.status, 404);
  });

  test('R-101 内容说明页：/topsters/about 200 + 三段口径 + 不被 :id 动态段捕获（注册序护栏）', async () => {
    const res = await get('/topsters/about');
    assert.equal(res.status, 200); // "about" 未被 /topsters/:id 捕获渲染 404（路由注册在 :id 之前）
    const html = await res.text();
    assert.ok(html.includes('把你的 Collection 排成一张图')); // 是什么（View 语义）
    assert.ok(html.includes('三步建一张')); // 怎么建
    assert.ok(html.includes('分享的是作品图，不是产品')); // 分享口径（04B 引擎一）
    assert.ok(html.includes('made with Musicgraphy')); // 署名链路衔接
    assert.ok(html.includes('诚实边界'), 'SVG 上传限制如实披露（海报页补位）');
    assert.ok(html.includes('href="/topsters"'), '入口链接（说明页 → 策展列表）');
    assert.ok(html.includes('实时取自 Collection'), 'Topster=View 禁第二套数据口径（乙-7）');
  });

  test('R-101 全站页脚入口行（闭环「四页 0 处入口」缺口）+ R-102 登录态行/退出动作在档', async () => {
    const html = await (await get('/topsters')).text();
    assert.ok(html.includes('把品味排成一张图'));
    assert.ok(html.includes('href="/topsters/about"'), '说明页入口');
    assert.ok(html.includes('已解锁 · Musicgraphy'), 'R-102 登录态行（V10 守卫保证 layout 页必然已登录）');
    assert.ok(html.includes('action="/logout"'), 'R-102 退出动作');
  });
});
