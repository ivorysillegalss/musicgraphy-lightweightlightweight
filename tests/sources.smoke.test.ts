// 数据源模块 Step 4 冒烟（零网络）：多源降级链语义 + 各源客户端规范化 +
// §5.2 跨源合并（alias_sources JSON 列）+ /covers 懒下载与 immutable + 零用户表写入
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/server/app';
import { loadConfig, type Config } from '../src/server/config';
import { DAO } from '../src/server/db/dao';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { MinuteWindowGate, SourceChain, DeezerSource, DiscogsSource, ITunesSource, MusicBrainzSource, type AlbumSearchFields, type AlbumSource } from '../src/server/metadata/sources';
import { UpstreamError, type AlbumCandidate } from '../src/server/metadata/musicbrainz';
import { LocalRateLimitError } from '../src/server/metadata/queue';

const cand = (source: AlbumCandidate['source'], sourceId: string, title: string, artist: string, coverUrl: string | null = null): AlbumCandidate => ({
  source,
  source_id: sourceId,
  title,
  artist,
  release_year: null,
  cover_url: coverUrl,
  country: null,
  genres: [],
  in_collection: false
});

function stubSource(name: AlbumSource['name'], behavior: () => Promise<AlbumCandidate[]>): AlbumSource & { calls: number } {
  return {
    name,
    enabled: true,
    calls: 0,
    search() {
      this.calls++;
      return behavior();
    }
  };
}

describe('SourceChain 降级链（02 §5.1）', () => {
  test('主源失败（500）→ 自动降级到次源；更低的源不再调用', async () => {
    const mb = stubSource('musicbrainz', async () => {
      throw new UpstreamError(500, 'upstream_error', '模拟主源 500');
    });
    const deezer = stubSource('deezer', async () => [cand('deezer', 'dz-1', 'Discovery', 'Daft Punk')]);
    const itunes = stubSource('itunes', async () => [cand('itunes', 'it-1', 'X', 'Y')]);
    const chain = new SourceChain([mb, deezer, itunes]);
    const items = await chain.search('daft punk', 12);
    assert.equal(mb.calls, 1);
    assert.equal(deezer.calls, 1);
    assert.equal(itunes.calls, 0, '首个非空结果即返回');
    assert.equal(items[0]?.source, 'deezer');
    assert.equal(items[0]?.source_id, 'dz-1');
  });

  test('主源空结果（冷门）→ 逐级降级兜底；全部空 → 空数组', async () => {
    const mb = stubSource('musicbrainz', async () => []);
    const deezer = stubSource('deezer', async () => []);
    const itunes = stubSource('itunes', async () => [cand('itunes', 'it-9', 'Obscure LP', 'Nobody')]);
    const items = await new SourceChain([mb, deezer, itunes]).search('obscure', 12);
    assert.equal(items[0]?.source, 'itunes', '冷门兜底走到底');
    const empty = await new SourceChain([stubSource('musicbrainz', async () => []), stubSource('deezer', async () => [])]).search('nothing', 12);
    assert.deepEqual(empty, []);
  });

  test('任一源挂掉不影响返回已有结果；全链失败 → 抛主源错误', async () => {
    const mb = stubSource('musicbrainz', async () => [cand('musicbrainz', 'mb-1', 'Kid A', 'Radiohead')]);
    const boom = stubSource('deezer', async () => {
      throw new UpstreamError(500, 'upstream_error', '次源也挂');
    });
    const ok = await new SourceChain([mb, boom]).search('kid a', 12);
    assert.equal(ok.length, 1, '次源挂掉不影响主源已得结果');
    const errMb = stubSource('musicbrainz', async () => {
      throw new UpstreamError(503, 'upstream_rate_limited', '主源超速', 9);
    });
    const errDz = stubSource('deezer', async () => {
      throw new UpstreamError(500, 'upstream_error', '次源挂');
    });
    await assert.rejects(
      () => new SourceChain([errMb, errDz]).search('x', 12),
      (e: unknown) => e instanceof UpstreamError && e.status === 503 && e.retryAfterS === 9,
      '全链失败抛最高优先级（主源）错误'
    );
  });

  test('停用源（如 Discogs 无令牌）直接跳过', async () => {
    const discogs = new DiscogsSource(new MetadataRateLimiterStub(), 'ua/1', null);
    assert.equal(discogs.enabled, false);
    const mb = stubSource('musicbrainz', async () => [cand('musicbrainz', 'mb-2', 'A', 'B')]);
    const chain = new SourceChain([discogs, mb]);
    const items = await chain.search('a', 5);
    assert.equal(items[0]?.source, 'musicbrainz');
  });
});

/** 不真正排队的限位桩（仅满足构造签名） */
class MetadataRateLimiterStub {
  async run<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

describe('各源客户端规范化（零网络）', () => {
  test('DeezerSource：search/album 字段映射（cover_big 优先）', async () => {
    let url = '';
    const fetchFn = (async (u: string | URL) => {
      url = String(u);
      return new Response(
        JSON.stringify({
          data: [{ id: 302127, title: 'Discovery', artist: { name: 'Daft Punk' }, cover_big: 'https://e-cdns-images.dzcdn.net/images/cover/big.jpg', release_date: '2001-03-12' }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;
    const src = new DeezerSource(new MetadataRateLimiterStub(), 'Musicgraphy/0.1 (test)', fetchFn);
    const items = await src.search('daft punk discovery', 5);
    assert.match(url, /api\.deezer\.com\/search\/album\?q=daft%20punk%20discovery&limit=5/);
    assert.equal(items[0]?.source, 'deezer');
    assert.equal(items[0]?.source_id, '302127');
    assert.equal(items[0]?.title, 'Discovery');
    assert.equal(items[0]?.artist, 'Daft Punk');
    assert.equal(items[0]?.release_year, 2001);
    assert.ok(items[0]?.cover_url?.includes('/big.jpg'));
  });

  test('ITunesSource：artwork 提升到 600x600bb + primaryGenreName；20/min 门满 → 静默降级空数组', async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response(
        JSON.stringify({
          results: [
            {
              collectionId: 1441164426,
              collectionName: 'Abbey Road (Remastered)',
              artistName: 'The Beatles',
              releaseDate: '1969-09-26',
              artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg',
              primaryGenreName: 'Rock'
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;
    let now = 1_000_000;
    const src = new ITunesSource(new MetadataRateLimiterStub(), 'Musicgraphy/0.1 (test)', 2, fetchFn, 10_000, () => now);
    const items = await src.search('abbey road', 5);
    assert.equal(items[0]?.source_id, '1441164426');
    assert.ok(items[0]?.cover_url?.includes('600x600bb'));
    assert.deepEqual(items[0]?.genres, ['Rock']);
    now += 1000;
    await src.search('abbey road', 5);
    assert.equal(calls, 2, '窗口内第 2 次（max=2）仍放行');
    now += 1000;
    const skipped = await src.search('abbey road', 5);
    assert.deepEqual(skipped, [], '窗口满 → 不打上游，空数组降级');
    assert.equal(calls, 2);
    now += 61_000;
    await src.search('abbey road', 5);
    assert.equal(calls, 3, '窗口滑出后恢复');
  });

  test('DiscogsSource：无令牌停用；有令牌解析 "Artist - Album" 标题与 genre/style', async () => {
    const disabled = new DiscogsSource(new MetadataRateLimiterStub(), 'ua', null);
    assert.equal(disabled.enabled, false);
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: 987654,
              title: 'Fax Gang - Scattered into the Shape of a Nightmare',
              year: '2021',
              country: 'US',
              genre: ['Electronic'],
              style: ['Hyperpop'],
              thumb: 'https://img.discogs.com/t.jpg'
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;
    const src = new DiscogsSource(new MetadataRateLimiterStub(), 'ua', 'pat_token', fetchFn);
    const items = await src.search('fax gang', 5);
    assert.equal(items[0]?.source_id, '987654');
    assert.equal(items[0]?.title, 'Scattered into the Shape of a Nightmare');
    assert.equal(items[0]?.artist, 'Fax Gang');
    assert.deepEqual(items[0]?.genres, ['Electronic', 'Hyperpop']);
    assert.equal(items[0]?.cover_url, 'https://img.discogs.com/t.jpg', '无 cover_image 时回退 thumb');
  });

  test('MinuteWindowGate：满窗口抛 LocalRateLimitError 并携带 Retry-After', () => {
    let now = 0;
    const gate = new MinuteWindowGate(2, () => now);
    gate.take();
    gate.take();
    assert.throws(
      () => gate.take(),
      (e: unknown) => e instanceof LocalRateLimitError && e.retryAfterMs > 55_000
    );
    now += 61_000;
    gate.take();
  });
});

describe('§5.2 跨源合并 + /covers 懒下载（路由级）', () => {
  let dir: string;
  let db: Db;
  let dao: DAO;
  let cfg: Config;
  let coversDir: string;
  let coverRequests: string[];

  const bearer = (): { headers: Record<string, string> } => ({ headers: { Authorization: `Bearer ${cfg.accessKey}` } });

  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4]);
  const makeApp = (): ReturnType<typeof createApp> =>
    createApp(dao, cfg, [
      stubSource('musicbrainz', async () => [cand('musicbrainz', 'mb-x1', 'Sample Album', 'Sample Artist', 'https://coverartarchive.org/release/mb-x1/front-250')]),
      stubSource('deezer', async () => {
        throw new UpstreamError(500, 'upstream_error', '不使用');
      })
    ], {
      cover: {
        coversDir,
        fetchFn: (async (u: string | URL) => {
          coverRequests.push(String(u));
          return new Response(PNG_BYTES, { status: 200, headers: { 'Content-Type': 'image/png' } });
        }) as typeof fetch
      }
    });

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-step4-'));
    db = openDatabase(join(dir, 'test.db'));
    runMigrations(db, 'db/migrations');
    dao = new DAO(db);
    cfg = loadConfig();
    coversDir = join(dir, 'covers');
  });
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('§5.2：先入库的 deezer 行保留，后命中的 musicbrainz ID 进 alias_sources；用户表零写入', async () => {
    const seeded = dao.upsertAlbum({ source: 'deezer', source_id: 'dz-x1', title: 'Sample Album', artist: 'Sample Artist' });
    const userBefore = { records: dao.stats().records, tags: dao.stats().tags };
    const app = makeApp();
    const res = await app.request('/api/v1/search/albums?q=sample+album', bearer());
    assert.equal(res.status, 200);
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    const item = json.data[0] as Record<string, unknown>;
    assert.equal(item['id'], seeded.id, '首个挂接的 album_metadata 保留（不迁移）');
    assert.equal(item['source'], 'deezer', '展示保留行的源');
    assert.deepEqual(
      item['alias_sources'],
      [{ source: 'musicbrainz', source_id: 'mb-x1' }],
      '其余源 ID 写入 alias_sources JSON 列'
    );
    assert.equal(dao.stats().records, userBefore.records, 'collection_record 未被触碰');
    assert.equal(dao.stats().tags, userBefore.tags, 'tags 未被触碰');
    const rows = dao.getAlbum(seeded.id);
    assert.equal(rows?.alias_sources.length, 1);
  });

  test('候选落库后添加 → in_collection=true（成员判定）', async () => {
    const { id } = dao.upsertAlbum({ source: 'musicbrainz', source_id: 'mb-x1', title: 'Sample Album', artist: 'Sample Artist' });
    dao.createRecord({ album_id: id });
    const app = makeApp();
    const res = await app.request('/api/v1/search/albums?q=sample', bearer());
    const json = (await res.json()) as { data: Array<Record<string, unknown>> };
    assert.equal(json.data[0]?.['in_collection'], true);
  });

  test('/covers/a/:id 首次访问 → 懒下载落盘（内容 hash）+ 302；二次访问字节请求命中 immutable 磁盘缓存', async () => {
    coverRequests = [];
    const album = dao.getAlbum(dao.upsertAlbum({ source: 'deezer', source_id: 'dz-c1', title: 'Cover Album', artist: 'C', cover_url: 'https://coverartarchive.org/release/dz-c1/front-250' }).id);
    assert.ok(album, '种子行存在');
    const app = makeApp();

    const first = await app.request(`/covers/a/${album?.id}`);
    assert.equal(first.status, 302, '首次访问：下载后重定向到内容地址');
    const location = first.headers.get('Location') ?? '';
    assert.match(location, /^\/covers\/[0-9a-f]{64}\.png$/, '落盘文件名为内容 sha256');
    assert.ok(existsSync(join(coversDir, location.replace('/covers/', ''))), '字节已落盘');
    assert.equal(coverRequests.length, 1, '远端封面被下载一次');

    const bytesRes = await app.request(location);
    assert.equal(bytesRes.status, 200);
    assert.equal(bytesRes.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'immutable 缓存头生效');
    assert.equal(bytesRes.headers.get('content-type'), 'image/png');
    const body = new Uint8Array(await bytesRes.arrayBuffer());
    assert.deepEqual(body, PNG_BYTES);

    // 二次访问 /covers/a/:id：cover_local 已回填 → 直接 302，不再触网
    coverRequests = [];
    const second = await app.request(`/covers/a/${album?.id}`);
    assert.equal(second.status, 302);
    assert.equal(second.headers.get('Location'), location);
    assert.equal(coverRequests.length, 0, '磁盘缓存命中，零远端请求');
    const again = await app.request(location);
    assert.equal(again.status, 200, '二次字节请求命中磁盘缓存');
  });

  test('封面路由防护：文件名白名单 + 目录逃逸拒绝；遗留 sha1 命名文件仍可服务', async () => {
    const app = makeApp();
    const traversal = await app.request('/covers/..%2F..%2Fmusicgraphy.db');
    assert.ok(traversal.status === 404 || traversal.status === 403, `逃逸请求被拒（实际 ${traversal.status}）`);
    const legacyName = 'a'.repeat(40) + '.jpg';
    writeFileSync(join(coversDir, legacyName), 'legacy');
    const legacy = await app.request(`/covers/${legacyName}`);
    assert.equal(legacy.status, 200, 'Step 2 时代的 sha1(source_id) 文件向后兼容');
    assert.equal(legacy.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const junk = await app.request('/covers/not-a-cover-file.jpg');
    assert.equal(junk.status, 404);
  });
});

// ---------------------------------------------------------------- S2-2 P2 外部链分字段透传（方案 b）
// 评审案 = ../Musicgraphy-2.0-文档包/05-系统架构设计/评审案-搜索分字段定向.md（逐源证据节）
describe('S2-2 P2 分字段逐源映射（零网络，fetchFn 注入断言 URL）', () => {
  class FieldRecorder implements AlbumSource {
    readonly name = 'musicbrainz' as const;
    readonly enabled = true;
    last: { q: string; limit: number; fields?: AlbumSearchFields } | null = null;
    async search(q: string, limit: number, fields?: AlbumSearchFields): Promise<AlbumCandidate[]> {
      this.last = { q, limit, fields };
      return [];
    }
  }

  const capturingFetch = (capture: { url: string }): typeof fetch =>
    (async (u: string | URL) => {
      capture.url = String(u);
      return new Response(JSON.stringify({ releases: [], data: [], results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;

  test('MusicBrainzSource：fields → Lucene 字段语法（artist:"…" AND release:"…" + extra OR 组）；无 fields 原样透传', async () => {
    const seen: string[] = [];
    const src = new MusicBrainzSource({
      searchReleases: async (q: string) => {
        seen.push(q);
        return [];
      }
    });
    await src.search('artist:キリンジ title:三', 5, { artist: ['キリンジ'], title: ['三'], extra: [] });
    assert.equal(seen[0], 'artist:"キリンジ" AND release:"三"');
    await src.search('x', 5, { artist: ['a'], title: ['t'], extra: ['jazz', 'funk'] });
    assert.equal(seen[1], 'artist:"a" AND release:"t" AND (jazz funk)', 'extra 折为 OR 括号组（bare 现状 OR 语义）');
    await src.search('a"b', 5, { artist: ['a"b'], title: [], extra: [] });
    assert.equal(seen[2], 'artist:"ab"', '引号剥除防 Lucene 语法注入（resolveReleaseByArtistAndTitle 同款）');
    await src.search('raw q', 5);
    assert.equal(seen[3], 'raw q', '无 fields = 原样透传（现状字节同形）');
  });

  test('ITunesSource：单字段 attribute=artistTerm/albumTerm（实测可用）；组合/含 extra = 盲搜折叠降级', async () => {
    const cap = { url: '' };
    const src = new ITunesSource(new MetadataRateLimiterStub(), 'ua/1', 20, capturingFetch(cap));
    await src.search('raw', 5, { artist: ['kirinji'], title: [], extra: [] });
    assert.match(cap.url, /term=kirinji&entity=album&attribute=artistTerm&limit=5/);
    await src.search('raw', 5, { artist: [], title: ['three'], extra: [] });
    assert.match(cap.url, /term=three&entity=album&attribute=albumTerm&limit=5/);
    await src.search('raw', 5, { artist: ['a'], title: ['b'], extra: [] });
    assert.doesNotMatch(cap.url, /attribute=/, '双字段单请求不可表达 → 降级');
    assert.match(cap.url, /term=a%20b/, '折叠 = 全值空格连接');
    await src.search('raw', 5, { artist: [], title: [], extra: ['tag值'] });
    assert.match(cap.url, /term=tag%E5%80%BC/, 'tag 值折入盲搜文本（不丢词）');
    await src.search('raw', 5);
    assert.match(cap.url, /term=raw&entity=album&limit=5/, '无 fields = 现状字节同形');
  });

  test('DiscogsSource：artist=/release_title=（官方文档参数，token 环境实测留待）；extra 折入 q；extra 空省 q', async () => {
    const cap = { url: '' };
    const src = new DiscogsSource(new MetadataRateLimiterStub(), 'ua', 'pat_token', capturingFetch(cap));
    await src.search('raw', 5, { artist: ['coltrane'], title: ['blue train'], extra: [] });
    assert.match(cap.url, /type=release&per_page=5&artist=coltrane&release_title=blue%20train&token=pat_token/, 'extra 空 → q 参数省略');
    await src.search('raw', 5, { artist: ['a'], title: [], extra: ['jazz'] });
    assert.match(cap.url, /q=jazz&.*artist=a/);
    await src.search('raw', 5, { artist: ['a'], title: ['b'], extra: [] });
    assert.match(cap.url, /type=release&per_page=5&artist=a&release_title=b&token=pat_token/, '双字段可同时表达（官方参数各恰一值）');
    await src.search('raw', 5, { artist: ['a', 'c'], title: [], extra: [] });
    assert.doesNotMatch(cap.url, /artist=/, '同字段多值不可表达 → 折叠');
    assert.match(cap.url, /q=a%20c/);
    await src.search('raw', 5);
    assert.match(cap.url, /\?q=raw&type=release&per_page=5&token=pat_token/, '无 fields = 现状字节同形');
  });

  test('DeezerSource：诚实降级源（本环境不可达未留证）→ fields 折叠盲搜 q；无 fields 现状同形', async () => {
    const cap = { url: '' };
    const src = new DeezerSource(new MetadataRateLimiterStub(), 'ua/1', capturingFetch(cap));
    await src.search('raw', 5, { artist: ['a'], title: ['b'], extra: ['tag值'] });
    assert.match(cap.url, /search\/album\?q=a%20b%20tag%E5%80%BC&limit=5/);
    await src.search('raw', 5);
    assert.match(cap.url, /search\/album\?q=raw&limit=5/, '无 fields = 现状字节同形');
  });

  test('SourceChain：fields 透传给每个尝试的源（降级链语义不变）', async () => {
    const a = new FieldRecorder();
    const b = new FieldRecorder();
    const items = await new SourceChain([a, b]).search('artist:x', 5, { artist: ['x'], title: [], extra: [] });
    assert.deepEqual(items, []);
    assert.deepEqual(a.last?.fields, { artist: ['x'], title: [], extra: [] });
    assert.deepEqual(b.last?.fields, { artist: ['x'], title: [], extra: [] }, '空结果 → 次源接手，fields 原样透传');
  });
});
