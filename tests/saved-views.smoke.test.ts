// P1-10 命名视图冒烟（saved_views；评审案 docs/saved-views-review.md §3；用户 2026-11-14 批准实现）：
// 只存查询状态（裁决案 4 附条件）· 重名 409（UNIQUE user_id+name）· 恢复 = 303 展开参数（URL 即状态不破坏）
// · named_view_rate 实算（PRD §6 周人均新建数，B3 无表缺口闭环）· 渲染（视图 chips + 保存表单）。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Hono } from 'hono';
import { createApp } from '../src/server/app';
import { ensureDirs, loadConfig, type Config } from '../src/server/config';
import { DAO, DuplicateRecordError, NotFoundError } from '../src/server/db/dao';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { MusicBrainzClient } from '../src/server/metadata/musicbrainz';
import { MusicBrainzSource } from '../src/server/metadata/sources';
import { MetadataRateLimiter } from '../src/server/metadata/queue';
import { EMPTY_FILTER, filterToQueryJson, queryJsonToFilter } from '../src/server/pages/collection';


const stubFetch = (async () =>
  new Response(JSON.stringify({ releases: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

let dir: string;
let db: Db;
let dao: DAO;
let app: Hono;
let cookie = '';

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mg-views-'));
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

const get = (path: string, extra: Record<string, string> = {}) => app.request(path, { headers: { cookie, ...extra }, redirect: 'manual' });
const post = (path: string, body: string, extra: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://localhost:3000', Host: 'localhost:3000', ...extra }, body, redirect: 'manual' });
const api = (path: string, init: RequestInit = {}) =>
  app.request(`/api/v1${path}`, { ...init, headers: { cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Host: 'localhost:3000', ...init.headers } });

describe('P1-10 saved_views（DAO 层）', () => {
  test('create/list/delete 全链路；重名 → DuplicateRecordError（UNIQUE user_id+name）；删除不存在 → NotFoundError', () => {
    const qj = filterToQueryJson({ q: null, genre: 'Electronic', year: null, period: '2025', fav: false, tag: '夜晚', color: 8 });
    const { id } = dao.createSavedView('深夜电子', qj);
    const list = dao.listSavedViews();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.name, '深夜电子');
    assert.equal(list[0]?.query_json, qj); // 只存查询状态（裁决案 4 附条件）
    assert.throws(() => dao.createSavedView('深夜电子', qj), DuplicateRecordError); // 重名防御
    assert.deepEqual(dao.deleteSavedView(id), { id });
    assert.throws(() => dao.deleteSavedView(id), NotFoundError);
    assert.deepEqual(dao.listSavedViews(), []);
  });

  test('query_json roundtrip（02 §2.4 形状 ↔ FilterState）+ 容错（坏 JSON/形状 → null）', () => {
    const f = { q: 'reverb', genre: null, year: 2010, period: null, fav: true, tag: '海边', color: 7 };
    const roundtrip = queryJsonToFilter(filterToQueryJson(f));
    assert.deepEqual(roundtrip, f);
    const raw = JSON.parse(filterToQueryJson(f)) as { axes: Record<string, unknown> };
    assert.equal(raw.axes['listened_period'], null); // 02 §2.4 轴名 listened_period
    assert.equal(raw.axes['release_year'], 2010); // 发行年份轴名 release_year
    assert.equal(queryJsonToFilter('not-json'), null);
    assert.equal(queryJsonToFilter('{"axes":"x"}'), null);
    assert.equal(queryJsonToFilter('{}'), null); // 缺 axes
  });
});

describe('P1-10 API（/api/v1/saved-views · ADR-007 口径）', () => {
  test('POST 201+Location / 重名 409 / 422 字段级 / GET list / DELETE 200 / DELETE 再删 404', async () => {
    const qj = filterToQueryJson({ ...EMPTY_FILTER, genre: 'Jazz' });
    const created = await api('/saved-views', { method: 'POST', body: JSON.stringify({ name: '爵士夜', query_json: qj }) });
    assert.equal(created.status, 201);
    assert.match(created.headers.get('Location') ?? '', /saved-views/);

    const dup = await api('/saved-views', { method: 'POST', body: JSON.stringify({ name: '爵士夜', query_json: qj }) });
    assert.equal(dup.status, 409);
    assert.equal(((await dup.json()) as { error: { code: string } }).error.code, 'duplicate_record');

    const bad = await api('/saved-views', { method: 'POST', body: JSON.stringify({ name: '', query_json: 'x' }) });
    assert.equal(bad.status, 422);
    assert.deepEqual(((await bad.json()) as { error: { details: { fields: Record<string, string> } } }).error.details.fields, { name: '必填', query_json: '必须是可解析的查询状态（{axes:{genre,release_year,listened_period,favorite,tag,color}, q}，02 §2.4）' });

    const list = await api('/saved-views');
    assert.equal(list.status, 200);
    const viewId = ((await list.json()) as { data: Array<{ id: string; name: string }> }).data[0]?.id ?? '';
    assert.ok(viewId !== '');

    const del = await api(`/saved-views/${viewId}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const gone = await api(`/saved-views/${viewId}`, { method: 'DELETE' });
    assert.equal(gone.status, 404);
  });
});

describe('P1-10 页面通道（无 JS 基线）', () => {
  before(() => {
    dao.createSavedView('深夜电子', filterToQueryJson({ ...EMPTY_FILTER, genre: 'Electronic', period: '2025' }));
  });

  test('恢复：GET /?view=深夜电子 → 303 展开成筛选参数 URL（URL 即状态不被破坏）', async () => {
    const res = await get('/?view=' + encodeURIComponent('深夜电子'));
    assert.equal(res.status, 303);
    const loc = res.headers.get('location') ?? '';
    assert.match(loc, /genre=Electronic/);
    assert.match(loc, /period=2025/);
    assert.ok(!loc.includes('view='));
  });

  test('恢复容错：视图不存在 / query_json 损坏 → 静默正常渲染（馈赠语义，不阻塞找回）', async () => {
    const missing = await get('/?view=' + encodeURIComponent('不存在'));
    assert.equal(missing.status, 200);
    const html = await (await get('/')).text();
    assert.ok(html.includes('Collection')); // 正常渲染
  });

  test('渲染：视图 chips（恢复链接 + 删除 form）+ 无激活筛选时不显示保存表单；有筛选时显示', async () => {
    const html = await (await get('/')).text();
    assert.ok(html.includes('SAVED VIEWS · 命名视图'));
    assert.ok(html.includes('href="/?view='));
    assert.ok(html.includes('action="/views/delete"'));
    assert.ok(html.includes('只存查询状态')); // 空筛选引导文案
    assert.ok(!html.includes('保存视图</button>')); // 无激活筛选 → 无保存入口
    const filtered = await (await get('/?genre=Electronic')).text();
    assert.ok(filtered.includes('保存视图</button>')); // 有筛选 → 保存表单在场
    assert.match(filtered, /name="query_json" value="\{&quot;/); // 隐藏域携带当前查询状态（hono/html 转义）
  });

  test('保存 → 303 /；删除 → 303 /（幂等）', async () => {
    const qj = encodeURIComponent(filterToQueryJson({ ...EMPTY_FILTER, tag: '夜晚' }));
    const save = await post('/views', `name=${encodeURIComponent('夜航')}&query_json=${qj}`);
    assert.equal(save.status, 303);
    assert.deepEqual(dao.listSavedViews().map((v) => v.name).sort(), ['夜航', '深夜电子']);
    const vid = dao.listSavedViews().find((v) => v.name === '夜航')?.id ?? '';
    const del = await post('/views/delete', `view_id=${vid}`);
    assert.equal(del.status, 303);
    assert.deepEqual(dao.listSavedViews().map((v) => v.name), ['深夜电子']);
    const delAgain = await post('/views/delete', `view_id=${vid}`); // 幂等静默
    assert.equal(delAgain.status, 303);
  });
});

describe('named_view_rate 实算（PRD §6 周人均新建数；B3 无表缺口闭环）', () => {
  test('有视图 → 数值 = cnt/存活周；无视图 → null；notes 不再含 named_view_rate 项', async () => {
    const withView = dao.metricsCoverage();
    assert.equal(typeof withView.named_view_rate, 'number'); // 深夜电子 在场（≥1 周 → cnt/1）
    assert.ok(!('named_view_rate' in withView.notes)); // 缺口说明移除（已实算）
    const fresh = openDatabase(join(dir, 'empty.db'));
    runMigrations(fresh, 'db/migrations');
    const empty = new DAO(fresh).metricsCoverage();
    assert.equal(empty.named_view_rate, null);
    fresh.close();
    // e2e：/metrics 页六仪表渲染 named_view_rate 数值
    const html = await (await get('/metrics')).text();
    assert.ok(html.includes('命名视图创建密度'));
  });
});
