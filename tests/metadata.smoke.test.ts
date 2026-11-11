// 数据源模块 Step 0 冒烟（零网络）：限流队列语义 + /api/v1/search/albums 路由
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/server/app';
import { loadConfig, type Config } from '../src/server/config';
import { DAO } from '../src/server/db/dao';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { MusicBrainzClient } from '../src/server/metadata/musicbrainz';
import { LocalRateLimitError, MetadataRateLimiter } from '../src/server/metadata/queue';

describe('MetadataRateLimiter（复审 V2）', () => {
  test('全局串行：相邻请求间隔 ≥ minIntervalMs', async () => {
    const limiter = new MetadataRateLimiter({ minIntervalMs: 60 });
    const times: number[] = [];
    await Promise.all([
      limiter.run(async () => {
        times.push(Date.now());
      }),
      limiter.run(async () => {
        times.push(Date.now());
      }),
      limiter.run(async () => {
        times.push(Date.now());
      })
    ]);
    times.sort((a, b) => a - b);
    assert.ok((times[1] ?? 0) - (times[0] ?? 0) >= 55, '第 2 次应等 ≥55ms');
    assert.ok((times[2] ?? 0) - (times[1] ?? 0) >= 55, '第 3 次应等 ≥55ms');
  });

  test('窗口满 → LocalRateLimitError 携带 Retry-After（不打上游，本地 429）', async () => {
    const limiter = new MetadataRateLimiter({ minIntervalMs: 1, maxPerMinute: 2, localRejectAfterMs: 1000 });
    await limiter.run(async () => 1);
    await limiter.run(async () => 2);
    await assert.rejects(
      () =>
        limiter.run(async () => 3),
      (e: unknown) => e instanceof LocalRateLimitError && e.retryAfterMs > 50_000
    );
  });
});

describe('GET /api/v1/search/albums（FR-1 输入端）', () => {
  let dir: string;
  let db: Db;
  let dao: DAO;
  let cfg: Config;

  const FIXTURE = {
    count: 2,
    releases: [
      {
        id: 'rel-1',
        title: 'OK Computer',
        date: '1997-05-21',
        country: 'GB',
        'artist-credit': [{ name: 'Radiohead', joinphrase: '' }],
        'cover-art-archive': { front: true, artwork: true }
      },
      {
        id: 'rel-2',
        title: 'Split EP',
        date: '1998',
        'artist-credit': [{ name: 'A', joinphrase: ' & ' }, { name: 'B' }]
      }
    ]
  };

  const makeApp = (fetchRes?: { status: number; retryAfter?: string }) => {
    const calls: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      calls.push(String(url));
      if (fetchRes !== undefined) {
        return new Response('upstream said no', { status: fetchRes.status, headers: fetchRes.retryAfter ? { 'Retry-After': fetchRes.retryAfter } : {} });
      }
      return new Response(JSON.stringify(FIXTURE), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const mb = new MusicBrainzClient(new MetadataRateLimiter({ minIntervalMs: 0 }), cfg.userAgent, fetchFn);
    return { app: createApp(dao, cfg, mb), calls };
  };

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-meta-'));
    db = openDatabase(join(dir, 'test.db'));
    runMigrations(db, 'db/migrations');
    dao = new DAO(db);
    cfg = loadConfig();
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('200：字段规范化（年份/artist-credit join/CAA front-250）', async () => {
    const { app, calls } = makeApp();
    const res = await app.request(`/api/v1/search/albums?q=${encodeURIComponent('ok computer radiohead')}`);
    assert.equal(res.status, 200);
    assert.match(calls[0] ?? '', /musicbrainz\.org\/ws\/2\/release\?query=ok%20computer%20radiohead&fmt=json&limit=12/);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    const first = json.data[0] as Record<string, unknown>;
    assert.equal(first['source'], 'musicbrainz');
    assert.equal(first['source_id'], 'rel-1');
    assert.equal(first['title'], 'OK Computer');
    assert.equal(first['artist'], 'Radiohead');
    assert.equal(first['release_year'], 1997);
    assert.equal(first['cover_url'], 'https://coverartarchive.org/release/rel-1/front-250');
    assert.equal(first['in_collection'], false);
    const second = json.data[1] as Record<string, unknown>;
    assert.equal(second['artist'], 'A & B');
    assert.equal(second['release_year'], 1998);
    assert.equal(second['cover_url'], null);
  });

  test('已入库候选 → in_collection=true（FR-1 捷径③"已收藏前置标记"）', async () => {
    dao.upsertAlbum({ source: 'musicbrainz', source_id: 'rel-1', title: 'OK Computer', artist: 'Radiohead', release_year: 1997 });
    const { app } = makeApp();
    const res = await app.request('/api/v1/search/albums?q=ok');
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    assert.equal(json.data[0]?.['in_collection'], true);
    assert.equal(json.data[1]?.['in_collection'], false);
  });

  test('q 过短 → 422 invalid_query；limit 钳制 1–25', async () => {
    const { app } = makeApp();
    const short = await app.request('/api/v1/search/albums?q=a');
    assert.equal(short.status, 422);
    assert.equal(((await short.json()) as { error: { code: string } }).error.code, 'invalid_query');
    const { app: app2, calls } = makeApp();
    await app2.request('/api/v1/search/albums?q=ok+computer&limit=999');
    assert.match(calls[0] ?? '', /limit=25/);
  });

  test('上游 503 → 502 upstream_unavailable + Retry-After 透传（R2 风险路径）', async () => {
    const { app } = makeApp({ status: 503, retryAfter: '7' });
    const res = await app.request('/api/v1/search/albums?q=anything');
    assert.equal(res.status, 502);
    assert.equal(res.headers.get('Retry-After'), '7');
    const json = (await res.json()) as { error: { code: string; details: Record<string, unknown> } };
    assert.equal(json.error.code, 'upstream_unavailable');
    assert.equal(json.error.details['upstream_status'], 503);
  });
});
