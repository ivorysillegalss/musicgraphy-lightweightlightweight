// W8 批留存冒烟（P1-7 重听动作 + P1-3 导出 UI 入口 + 六仪表页；PM §4 W8 表）：
// relisten = C-DUP 双出口的显式动作（D1/D2 落地界面）：更新 listenedAt 永不产生第二条记录；
//   验收 = 更新后「听的时期」轴与「那年今日」数据一致（echo 锚 = added_at 不受影响）。
// metrics 页 = 观察池仪表呈现（B3 {data} 形状）+ 匿名化可关闭口径（PRD §5 + 04B §3）。
// 页脚 = P1-3 导出 UI 入口（JSON/CSV/含封面 zip，永久免费红线）。
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
const recordId = 'r-11111111-1111-4111-8111-111111111111';

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mg-w8-'));
  db = openDatabase(join(dir, 't.db'));
  runMigrations(db, 'db/migrations');
  const now = new Date();
  const y = now.getFullYear();
  const added = new Date(y - 1, now.getMonth(), now.getDate(), 12).toISOString(); // 恰满 1 周年的 added_at（echo 锚）
  db.prepare('INSERT INTO album_metadata (id, source, source_id, title, artist, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
    'a-22222222-2222-4222-8222-222222222222',
    'musicbrainz',
    'w8-1',
    'Relisten Target',
    'Artist',
    added,
    added
  );
  db.prepare('INSERT INTO collection_record (id, user_id, album_id, added_at, listened_at, listened_precision, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(
    recordId,
    'local',
    'a-22222222-2222-4222-8222-222222222222',
    added,
    `${y - 1}-01-01T00:00:00Z`,
    'year',
    added,
    added
  );
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

const get = (path: string, extra: Record<string, string> = {}) => app.request(path, { headers: { cookie, ...extra } });
const post = (path: string, body: string, extra: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://localhost:3000', Host: 'localhost:3000', ...extra }, body });

describe('P1-7 重听动作（POST /album/:id/relisten）', () => {
  test('显式动作更新 listenedAt（D1）→ precision=day、added_at 不变（记录事实不可编辑）', async () => {
    const beforeRec = dao.getRecord(recordId);
    const res = await post(`/album/${recordId}/relisten`, '');
    assert.equal(res.status, 303);
    const afterRec = dao.getRecord(recordId);
    assert.equal(afterRec.added_at, beforeRec.added_at); // added_at = 事实，永不因重听改变
    assert.equal(afterRec.listened_precision, 'day');
    const todayIso = new Date().toISOString().slice(0, 10); // listened_at 写 nowIso()（UTC 瞬时），比对同口径
    assert.equal((afterRec.listened_at ?? '').slice(0, 10), todayIso); // listened_at = 最近一次听
    // 永不产生第二条记录（D2）：重听前后集合基数不变
    const total = dao.countAxes('local', {}, ['favorite']);
    assert.equal(total.favorite?.reduce((s, x) => s + x.count, 0), 1);
  });

  test('验收一致性：更新后「听的时期」轴反映新年份、那年今日（echo 锚 added_at）不受影响', async () => {
    const y = new Date().getFullYear();
    const listened = dao.countAxes('local', {}, ['listened']).listened ?? [];
    assert.ok(listened.some((f) => f.value === String(y) && f.count === 1)); // 听的时期轴 = substr(listened_at,1,4) → 当年
    assert.deepEqual(dao.echoToday('local', 10).map((x) => x.id), [recordId]); // echo 锚 = added_at（去年今天）仍在
  });

  test('CSRF：跨站 Origin 被拒（403）；无 JS 基线表单同源放行', async () => {
    const res = await app.request(`/album/${recordId}/relisten`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example', Host: 'localhost:3000' },
      body: ''
    });
    assert.equal(res.status, 403);
  });
});

describe('P1-3 导出 UI 入口（页脚，永久免费红线）', () => {
  test('全站页脚含 JSON / CSV / 含封面 zip 三通道 + 观察池仪表入口', async () => {
    const html = await (await get('/')).text();
    assert.ok(html.includes('href="/api/v1/export?format=json"'));
    assert.ok(html.includes('href="/api/v1/export?format=csv"'));
    assert.ok(html.includes('href="/api/v1/export?with_covers=1"'));
    assert.ok(html.includes('href="/metrics"'));
    assert.ok(html.includes('永久免费'));
  });

  test('导出三通道真实可达（鉴权内）：JSON 形状 version 字段在场', async () => {
    const res = await get('/api/v1/export?format=json');
    assert.equal(res.status, 200);
    const payload = (await res.json()) as { version: string; records: unknown[] };
    assert.equal(payload.version, '2.0');
    assert.equal(payload.records.length, 1);
  });
});

describe('六仪表页（GET /metrics · 匿名化可关闭）', () => {
  test('open 态：六仪表全渲染（coverage 实数 + 五项待埋点 + 逐项 note）+ 匿名化口径声明', async () => {
    const html = await (await get('/metrics')).text();
    assert.ok(html.includes('线索覆盖率'));
    assert.ok(html.includes('北极星'));
    for (const label of ['搜索失败率', '命名视图创建密度', '回响卡片点击率', '「为什么」回访率', '导出使用率']) {
      assert.ok(html.includes(label));
    }
    assert.ok(html.includes('待埋点')); // 五项 null → 如实呈现，勿伪造数字（B3 口径）
    assert.ok(html.includes('无搜索会话日志表')); // notes 数据源缺失说明在场
    assert.ok(html.includes('自托管匿名计数')); // 04B §3 口径
    assert.ok(html.includes('无个人标识符')); // 02 §4 匿名化口径
    assert.ok(html.includes('GENERATED AT')); // generated_at
  });

  test('可关闭：toggle close → Set-Cookie 季度级 → closed 态隐藏数字呈现；toggle open 恢复', async () => {
    const closeRes = await post('/metrics/toggle', 'action=close');
    assert.equal(closeRes.status, 303);
    const setCookie = closeRes.headers.get('Set-Cookie') ?? '';
    assert.match(setCookie, /mg_metrics=closed/);
    assert.match(setCookie, /Max-Age=7948800/); // 92 天 = 季度级节律
    const metricsCookie = /mg_metrics=[^;]*/.exec(setCookie)?.[0] ?? '';
    // D1 修复（use('/*')）后页面需有效会话：closed 态 = 会话 + mg_metrics 双 cookie 并带
    // （原写法整体替换掉会话 cookie，依赖「页面匿名可达」的 D1 缺口才通过——随修复纠正）
    const closedHtml = await (await get('/metrics', { cookie: `${cookie}; ${metricsCookie}` })).text();
    assert.ok(closedHtml.includes('观察池仪表已关闭'));
    assert.ok(!closedHtml.includes('线索覆盖率')); // 关闭 = 隐藏数字呈现
    assert.ok(closedHtml.includes('重新打开'));

    const openRes = await post('/metrics/toggle', 'action=open');
    assert.equal(openRes.status, 303);
    const openHtml = await (await get('/metrics')).text(); // cookie 已删（deleteCookie），原会话 cookie 即 open 态
    assert.ok(openHtml.includes('线索覆盖率')); // 恢复呈现
  });

  test('toggle CSRF：跨站 Origin 被拒', async () => {
    const res = await app.request('/metrics/toggle', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example', Host: 'localhost:3000' },
      body: 'action=close'
    });
    assert.equal(res.status, 403);
  });
});
