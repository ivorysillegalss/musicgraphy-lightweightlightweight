// 鉴权冒烟（V10）：页面 302 守卫 / 登录流程 / API Bearer / CSRF 同源校验
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

describe('鉴权（V10）', () => {
  let dir: string;
  let db: Db;
  let dao: DAO;
  let cfg: Config;
  let app: Hono;
  let cookie = '';

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-auth-'));
    db = openDatabase(join(dir, 't.db'));
    runMigrations(db, 'db/migrations');
    dao = new DAO(db);
    cfg = loadConfig();
    ensureDirs(cfg);
    app = createApp(dao, cfg, [new MusicBrainzSource(new MusicBrainzClient(new MetadataRateLimiter({ minIntervalMs: 0 }), cfg.userAgent, stubFetch))]);
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('未登录访问页面 → 302 /login；health 保持公开（IM-11）', async () => {
    const res = await app.request('/');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('Location'), '/login');
    const health = await app.request('/api/v1/health');
    assert.equal(health.status, 200);
  });

  test('登录：错误密钥 401；正确密钥 303 + HttpOnly/SameSite=Lax cookie；带 cookie 访问页面 200', async () => {
    const page = await app.request('/login');
    assert.equal(page.status, 200);
    const bad = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'access_key=wrong'
    });
    assert.equal(bad.status, 401);
    const ok = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `access_key=${encodeURIComponent(cfg.accessKey)}`
    });
    assert.equal(ok.status, 303);
    const set = ok.headers.get('Set-Cookie') ?? '';
    assert.match(set, /mg_session=/);
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Lax/);
    cookie = set.split(';')[0] ?? '';
    const home = await app.request('/', { headers: { Cookie: cookie } });
    assert.equal(home.status, 200);
  });

  test('API：无凭据 401 unauthorized；Bearer 正确 200；Bearer 错误 401', async () => {
    const no = await app.request('/api/v1/collection');
    assert.equal(no.status, 401);
    assert.equal(((await no.json()) as { error: { code: string } }).error.code, 'unauthorized');
    const ok = await app.request('/api/v1/collection', { headers: { Authorization: `Bearer ${cfg.accessKey}` } });
    assert.equal(ok.status, 200);
    const bad = await app.request('/api/v1/collection', { headers: { Authorization: 'Bearer wrong' } });
    assert.equal(bad.status, 401);
  });

  test('CSRF：cookie 通道 POST 跨站 Origin → 403 csrf_rejected；同源 Origin 放行 201', async () => {
    const evil = await app.request('/api/v1/records', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'musicbrainz', source_id: 'x', title: 'T', artist: 'A' })
    });
    assert.equal(evil.status, 403);
    assert.equal(((await evil.json()) as { error: { code: string } }).error.code, 'csrf_rejected');
    const same = await app.request('/api/v1/records', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'musicbrainz', source_id: 'x1', title: 'T', artist: 'A' })
    });
    assert.equal(same.status, 201);
  });
});
