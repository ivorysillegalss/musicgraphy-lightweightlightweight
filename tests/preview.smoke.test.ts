// 预览域冒烟（第二批音频段 S2-15/18/19/27 · 评审案 docs/design-refs-review.md Q12/Q13）：
// 解析 fail-soft 404（无 iTunes 源/无匹配=诚实无预览不伪造）/ 进程缓存直读流式代理 / 守卫拓扑 /
// 星图代表记录内联（S2-27 扫听取样）/ 详情页试听行 + audio-viz 岛屿根（S2-18/19）。
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
import { primePreview } from '../src/server/metadata/preview';
import { MusicBrainzClient } from '../src/server/metadata/musicbrainz';
import { MusicBrainzSource } from '../src/server/metadata/sources';
import { MetadataRateLimiter } from '../src/server/metadata/queue';

const stubFetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('cdn.test')) {
    return new Response('AUDIOBYTES', { status: 200, headers: { 'Content-Type': 'audio/mp4' } });
  }
  return new Response(JSON.stringify({ results: [], releases: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}) as typeof fetch;

let dir: string;
let db: Db;
let dao: DAO;
let app: Hono;
let cookie = '';
let recordId = '';

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mg-preview-'));
  db = openDatabase(join(dir, 't.db'));
  runMigrations(db, 'db/migrations');
  dao = new DAO(db);
  const cfg: Config = loadConfig();
  ensureDirs(cfg);
  // fetchFn 经 opts.cover 注入口传给 preview 域（app.ts initPreview seam，评审案 Q12）
  app = createApp(
    dao,
    cfg,
    [new MusicBrainzSource(new MusicBrainzClient(new MetadataRateLimiter({ minIntervalMs: 0 }), cfg.userAgent, stubFetch))],
    { cover: { fetchFn: stubFetch } }
  );
  const ok = await app.request('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `access_key=${encodeURIComponent(cfg.accessKey)}` });
  cookie = (ok.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  const a = dao.upsertAlbum({ source: 'user-provided', source_id: 'pv-1', title: '测试专辑', artist: '测试者', genres: ['Jazz'] });
  recordId = dao.createRecord({ album_id: a.id }).id;
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (path: string) => app.request(path, { headers: { cookie }, redirect: 'manual' });

describe('GET /album/:id/preview（S2-15/18 音频源 · Q12/Q13）', () => {
  test('无预览（链上无 iTunes 源且零缓存）→ 404 preview_unavailable（诚实 fail-soft）', async () => {
    const res = await get(`/album/${recordId}/preview`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'preview_unavailable');
  });

  test('缓存直读 → 200 同源流式（Content-Type 透传；同源 = AnalyserNode 无 CORS 污染前提）', async () => {
    primePreview(recordId, 'https://cdn.test/p.m4a');
    const res = await get(`/album/${recordId}/preview`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Type') ?? '', /audio\//);
    assert.equal(await res.text(), 'AUDIOBYTES');
  });

  test('不存在的记录 → 404 record_not_found', async () => {
    const res = await get('/album/nope/preview');
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'record_not_found');
  });

  test('匿名 → 302 /login（页面守卫拓扑）', async () => {
    const res = await app.request(`/album/${recordId}/preview`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.ok((res.headers.get('Location') ?? '').startsWith('/login'));
  });
});

describe('试听面接线（S2-18/19/27）', () => {
  test('详情页：<audio preload=none> + audio-viz 岛屿根（S2-18/19）', async () => {
    const res = await get(`/album/${recordId}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(`src="/album/${recordId}/preview"`), '试听端点在档');
    assert.ok(html.includes('preload="none"'), '零预取（隐私红线：不点不请求）');
    assert.ok(html.includes('data-island="audio-viz"'), '示波器岛屿根在档');
  });

  test('星图节点内联代表记录（S2-27 扫听取样）', async () => {
    const res = await get('/genres');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /data-sample="[0-9a-f-]{10,}"/, 'data-sample 非空在档');
  });
});
