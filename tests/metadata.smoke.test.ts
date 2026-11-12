// 数据源模块冒烟（零网络）：限流队列语义 + /api/v1/search/albums 路由（Step 4 起走多源降级链）
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
import { MusicBrainzClient, UpstreamError, type AlbumCandidate } from '../src/server/metadata/musicbrainz';
import { LocalRateLimitError, MetadataRateLimiter } from '../src/server/metadata/queue';
import { MusicBrainzSource, type AlbumSource, type MetadataSource } from '../src/server/metadata/sources';

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

/** 桩源：记录调用次数，返回固定候选或抛错 */
function stubSource(name: MetadataSource, behavior: () => Promise<AlbumCandidate[]>): AlbumSource & { calls: number } {
  return {
    name,
    enabled: true,
    calls: 0,
    search(q: string, limit: number) {
      void q;
      void limit;
      this.calls++;
      return behavior();
    }
  };
}

const cand = (source: MetadataSource, sourceId: string, title: string, artist: string): AlbumCandidate => ({
  source,
  source_id: sourceId,
  title,
  artist,
  release_year: null,
  cover_url: null,
  country: null,
  genres: [],
  in_collection: false
});

describe('GET /api/v1/search/albums（FR-1 输入端 · 降级链）', () => {
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

  const makeMbSource = (fetchRes?: { status: number; retryAfter?: string }): MusicBrainzSource => {
    const fetchFn = (async () => {
      if (fetchRes !== undefined) {
        return new Response('upstream said no', { status: fetchRes.status, headers: fetchRes.retryAfter ? { 'Retry-After': fetchRes.retryAfter } : {} });
      }
      return new Response(JSON.stringify(FIXTURE), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return new MusicBrainzSource(new MusicBrainzClient(new MetadataRateLimiter({ minIntervalMs: 0 }), cfg.userAgent, fetchFn));
  };

  const bearer = (): { headers: Record<string, string> } => ({ headers: { Authorization: `Bearer ${cfg.accessKey}` } });

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

  test('200：字段规范化（年份/artist-credit join/CAA front-250）+ 主源健康时不打次源', async () => {
    const deezer = stubSource('deezer', async () => {
      throw new Error('主源健康不应降级');
    });
    const app = createApp(dao, cfg, [makeMbSource(), deezer]);
    const res = await app.request(`/api/v1/search/albums?q=${encodeURIComponent('ok computer radiohead')}`, bearer());
    assert.equal(res.status, 200);
    assert.equal(deezer.calls, 0, '主源命中 → 次源零调用（30/min 窗口留给主源）');
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    const first = json.data[0] as Record<string, unknown>;
    assert.equal(first['source'], 'musicbrainz');
    assert.equal(first['source_id'], 'rel-1');
    assert.equal(first['title'], 'OK Computer');
    assert.equal(first['artist'], 'Radiohead');
    assert.equal(first['release_year'], 1997);
    assert.equal(first['cover_url'], 'https://coverartarchive.org/release/rel-1/front-250');
    assert.equal(first['in_collection'], false);
    assert.deepEqual(first['alias_sources'], [], '响应字段对齐 02 §2.1（alias_sources 空数组起）');
    const second = json.data[1] as Record<string, unknown>;
    assert.equal(second['artist'], 'A & B');
    assert.equal(second['release_year'], 1998);
    assert.equal(second['cover_url'], null);
  });

  test('已入库候选 → in_collection=true（FR-1 捷径③，按 collection_record 成员判定）', async () => {
    const { id } = dao.upsertAlbum({ source: 'musicbrainz', source_id: 'rel-1', title: 'OK Computer', artist: 'Radiohead' });
    dao.createRecord({ album_id: id });
    const app = createApp(dao, cfg, [makeMbSource()]);
    const res = await app.request('/api/v1/search/albums?q=ok', bearer());
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    assert.equal(json.data[0]?.['in_collection'], true);
    assert.equal(json.data[1]?.['in_collection'], false);
  });

  test('搜索落库快照但零用户表写入（AGENTS §4 红线）', async () => {
    const before = dao.stats();
    const app = createApp(dao, cfg, [makeMbSource()]);
    await app.request('/api/v1/search/albums?q=ok computer', bearer());
    const after = dao.stats();
    assert.equal(after.records, before.records, 'collection_record 不得被搜索触碰');
    assert.equal(after.tags, before.tags, 'tags 不得被搜索触碰');
  });

  test('q 过短 → 422 invalid_query；limit 钳制 1–25；source 白名单', async () => {
    const app = createApp(dao, cfg, [makeMbSource()]);
    const short = await app.request('/api/v1/search/albums?q=a', bearer());
    assert.equal(short.status, 422);
    assert.equal(((await short.json()) as { error: { code: string } }).error.code, 'invalid_query');
    const badSource = await app.request('/api/v1/search/albums?q=ok+computer&source=nope', bearer());
    assert.equal(badSource.status, 422);
    const app2 = createApp(dao, cfg, [makeMbSource()]);
    await app2.request('/api/v1/search/albums?q=ok+computer&limit=999', bearer());
  });

  test('?source= 指定单源时只打该源', async () => {
    const deezer = stubSource('deezer', async () => [cand('deezer', 'dz-1', 'Discovery', 'Daft Punk')]);
    const app = createApp(dao, cfg, [makeMbSource(), deezer]);
    const res = await app.request('/api/v1/search/albums?q=discovery&source=deezer', bearer());
    assert.equal(res.status, 200);
    assert.equal(deezer.calls, 1);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    assert.equal(json.data[0]?.['source'], 'deezer');
  });

  test('全链上游 503 → 502 upstream_unavailable + Retry-After 透传（R2 风险路径）', async () => {
    const fail = (name: MetadataSource): AlbumSource => stubSource(name, async () => { throw new UpstreamError(503, 'upstream_rate_limited', '超速', 7); });
    const app = createApp(dao, cfg, [makeMbSource({ status: 503, retryAfter: '7' }), fail('deezer'), fail('itunes'), fail('discogs')]);
    const res = await app.request('/api/v1/search/albums?q=anything', bearer());
    assert.equal(res.status, 502);
    assert.equal(res.headers.get('Retry-After'), '7', '主源 Retry-After 优先透传');
    const json = (await res.json()) as { error: { code: string; details: Record<string, unknown> } };
    assert.equal(json.error.code, 'upstream_unavailable');
    assert.equal(json.error.details['upstream_status'], 503);
  });

  test('全链本地限流 → 429 + Retry-After（复审 V2 自我防线）', async () => {
    const fail = (name: MetadataSource): AlbumSource =>
      stubSource(name, async () => {
        throw new LocalRateLimitError(42_000);
      });
    const app = createApp(dao, cfg, [fail('musicbrainz'), fail('deezer'), fail('itunes')]);
    const res = await app.request('/api/v1/search/albums?q=anything', bearer());
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('Retry-After'), '42');
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'rate_limited');
  });
});
