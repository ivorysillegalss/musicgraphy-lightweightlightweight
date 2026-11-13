// W9 批留存冒烟（P1-6 Tag 轻治理 + P1-8 键盘流；PM §4 W9 表）：
// P1-6：候选发现（近形对 + 孤 tag）/ 合并（旧 tag 消失、引用保留，D2 幂等去重）/ 季度级 cookie 不打扰 / 一行式渲染 / CSRF。
// P1-8：三键流核对（`/` 聚焦搜索 keyboard-flow 岛屿；Enter 添加首候选 + F 快速 Favorite add-dialog 岛屿）——
//   岛屿按键处理为源码不变量断言（假 DOM 行为测试先例 = wall-scroll；键盘流挂载形态简单，呈现面 + 源码面双证）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
import { tagGovHint } from '../src/server/pages/collection';
import { renderAlbumDetail } from '../src/server/pages/album';

const stubFetch = (async () =>
  new Response(JSON.stringify({ releases: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

let dir: string;
let db: Db;
let dao: DAO;
let app: Hono;
let cookie = '';

const addTagged = (title: string, tags: string[]): void => {
  const { id: albumId } = dao.upsertAlbum({ source: 'musicbrainz', source_id: `w9-${title}`, title, artist: `A of ${title}`, release_year: 2020, genres: [] });
  const { id } = dao.createRecord({ album_id: albumId });
  if (tags.length > 0) dao.setTags(id, tags);
};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mg-w9-'));
  db = openDatabase(join(dir, 't.db'));
  runMigrations(db, 'db/migrations');
  dao = new DAO(db);
  addTagged('Night One', ['夜晚', '海边']);
  addTagged('Night Two', ['夜晚', '旅行']);
  addTagged('Night Three', ['夜晚', '夜间']); // 同挂两 tag：合并时 PK 冲突去重（D2 幂等）
  addTagged('Night Four', ['夜间']);
  addTagged('Solo One', ['电脑']); // 孤 tag（refs=1）；海边/旅行 各 refs=1 同为孤
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

describe('P1-6 Tag 轻治理（候选 + 合并）', () => {
  test('候选发现：近形对识别（夜晚/夜间）+ 推荐方向 refs 大者为目标；无 2 字符全异词误报（旅行/海边）', () => {
    const g = dao.tagCandidates();
    const pairTitles = g.pairs.map((p) => `${p.source.name}→${p.target.name}`);
    assert.deepEqual(pairTitles, ['夜间→夜晚']); // 夜间(2) 并入 夜晚(3)——refs 大者为目标（Q7）
    assert.deepEqual(new Set(g.orphans.map((t) => t.name)), new Set(['海边', '电脑', '旅行'])); // refs≤1 且不在近形对
  });

  test('合并语义：旧 tag 消失、引用全部重定向保留（PRD 验收）；同挂两 tag 的记录去重不多不少', () => {
    const { moved, deleted } = dao.mergeTags('夜间', '夜晚');
    assert.equal(moved, 1); // Night Four 重定向；Night Three 已同挂夜晚 → PK 排除（去重）
    assert.equal(deleted, true);
    const all = dao.listPage({ limit: 60 }).items.flatMap((r) => dao.getRecord(r.id).tags);
    assert.ok(!all.includes('夜间')); // 旧 tag 消失
    assert.equal(all.filter((t) => t === '夜晚').length, 4); // 四条记录全部挂夜晚，Night Three 不产生第二个
    assert.deepEqual(dao.tagCandidates().pairs, []); // 治理完成后近形对清空
  });

  test('moved=0 且 deleted=true 边缘：唯一引用记录已同挂目标 tag（全去重）→ 旧 tag 仍消失', () => {
    addTagged('Dedup Edge', ['雨天', '雨季']); // 距离 1
    const { moved, deleted } = dao.mergeTags('雨季', '雨天'); // 唯一引用 = 同一记录，已同挂雨天
    assert.equal(moved, 0);
    assert.equal(deleted, true); // 合并发生：旧 tag 消失（moved ≠ 合并发生与否，Q5 补记）
    const all = dao.listPage({ limit: 60 }).items.flatMap((r) => dao.getRecord(r.id).tags);
    assert.ok(!all.includes('雨季'));
    assert.equal(all.filter((t) => t === '雨天').length, 1); // 不产生第二个
  });

  test('无操作防御：同名/缺目标/空串 → moved=0、deleted=false 且库不变', () => {
    const before = dao.stats().tags;
    assert.deepEqual(dao.mergeTags('夜晚', '夜晚'), { moved: 0, deleted: false });
    assert.deepEqual(dao.mergeTags('不存在', '夜晚'), { moved: 0, deleted: false });
    assert.deepEqual(dao.mergeTags('', '夜晚'), { moved: 0, deleted: false });
    assert.equal(dao.stats().tags, before);
  });

  test('一行式渲染：近形对双按钮（点击选目标）+ 孤 tag「只挂 1 张」文案 + 季度 dismiss 按钮', () => {
    const html = String(
      tagGovHint({
        pairs: [{ source: { id: 'b', name: '夜间', refs: 2 }, target: { id: 'a', name: '夜晚', refs: 3 } }],
        orphans: [{ id: 'c', name: '旅行', refs: 1 }]
      })
    );
    assert.ok(html.includes('TAG GOVERNANCE · 季度治理'));
    assert.ok(html.includes('action="/tags/merge"'));
    assert.ok(html.includes('并入 夜晚')); // 推荐方向
    assert.ok(html.includes('并入 夜间')); // 反向可选（点击选目标）
    assert.ok(html.includes('只挂 1 张'));
    assert.ok(html.includes('本季度不再提示'));
    assert.match(html, /name="source" value="夜间"/);
    assert.match(html, /name="target" value="夜晚"/);
  });

  test('e2e：合并 → 303 flash=merged + 季度 cookie → 提示不再渲染（≤1 次/季度）；CSRF 403', async () => {
    addTagged('Merge E2E', ['通勤', '通琴']); // 距离 1 → 近形对
    const res = await post('/tags/merge', `source=${encodeURIComponent('通琴')}&target=${encodeURIComponent('通勤')}`);
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location') ?? '', /flash=merged/);
    const hintCookie = /mg_tag_hint=[^;]*/.exec(res.headers.get('Set-Cookie') ?? '')?.[0] ?? '';
    assert.match(hintCookie, /mg_tag_hint=/);
    const page = await (await get('/?flash=merged', { cookie: `${cookie}; ${hintCookie}` })).text(); // 跟随 303 Location（session + 提示 cookie 并带）
    assert.ok(page.includes('TAGS MERGED')); // flash 反馈（旧 Tag 消失、引用保留）
    assert.ok(!page.includes('TAG GOVERNANCE')); // 当季已处理 → 提示不再打扰
    const csrf = await app.request('/tags/merge', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example', Host: 'localhost:3000' },
      body: 'source=x&target=y'
    });
    assert.equal(csrf.status, 403);
  });

  test('e2e：本季度不再提示 → cookie 写入 → 提示不渲染（候选仍在）', async () => {
    const res = await post('/tags/hint-dismiss', '');
    assert.equal(res.status, 303);
    const hintCookie = /mg_tag_hint=[^;]*/.exec(res.headers.get('Set-Cookie') ?? '')?.[0] ?? '';
    const page = await (await get('/', { cookie: `${cookie}; ${hintCookie}` })).text();
    assert.ok(!page.includes('TAG GOVERNANCE'));
    // 候选仍在（含 e2e/边缘测试合并残留的 通勤/雨天 refs=1），只是当季不打扰
    assert.deepEqual(new Set(dao.tagCandidates().orphans.map((t) => t.name)), new Set(['海边', '电脑', '旅行', '通勤', '雨天']));
  });
});

describe('P1-8 键盘流（/ · Enter · F）', () => {
  const src = (p: string): string => readFileSync(join(process.cwd(), 'src/client/islands', p), 'utf8');

  test('`/` 全局聚焦搜索（keyboard-flow 岛屿：非输入态、弹层打开不抢键）', () => {
    const s = src('keyboard-flow.ts');
    assert.match(s, /e\.key !== '\/'/); // '/' 触发
    assert.match(s, /isTypingTarget/); // 输入态不劫持
    assert.match(s, /dialog\[open\]/); // 弹层打开时让位
    assert.match(s, /input\.focus\(\)/); // 聚焦搜索框
  });

  test('Enter 添加首候选 + F 快速 Favorite（add-dialog 岛屿；Esc 原生）', () => {
    const s = src('add-dialog.ts');
    assert.match(s, /e\.key === 'Enter' && e\.target === find/); // Enter = 首候选
    assert.match(s, /data-mg-add/); // 首候选点击
    assert.match(s, /e\.key === 'f' \|\| e\.key === 'F'/); // F = Favorite
    assert.match(s, /favBtn\.click\(\)/);
  });

  test('呈现面：页头 `/` 键位提示在场；详情页 Favorite 表单（F 提交落点）在场', async () => {
    const home = await (await get('/')).text();
    assert.match(home, /kbd kbd-hint/);
    const detail = dao.getRecord(dao.listPage({ limit: 1 }).items[0]?.id ?? '');
    const detailHtml = String(renderAlbumDetail(detail, null, { title: 't' }));
    assert.match(detailHtml, /action="\/album\/[0-9a-f-]+\/favorite"/);
  });
});
