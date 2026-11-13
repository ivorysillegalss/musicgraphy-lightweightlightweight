// IM-22 B4 多用户并发与封面缓存（规格 = 05-系统架构设计/评审案-多用户并发与封面缓存.md）：
//   R3 封面门（cover-gate.ts）：独立「串行 ≥1s + 在途 ≤2」+ single-flight 同封面合并
//   R4 回填空闲门：空闲 >10s 才注入下一张，交互优先（busyProbe 预留搜索队列联动）
//   R2 搜索 single-flight（search.ts SearchMemo）：同链路同规范化 q 并发共享一次上游调用
//   R1 快照回放缓存：q 规范化(trim+casefold)→row ids，TTL 10min，命中零上游重算 in_collection
// 零网络注入口径（W1-2/W2-2 先例）：fetchFn/nowFn/sleepFn 全注入，假时钟确定性推进。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { DAO } from '../src/server/db/dao';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { CoverGate } from '../src/server/metadata/cover-gate';
import type { CoverDownloadOptions } from '../src/server/metadata/covers';
import { MusicBrainzClient, type AlbumCandidate } from '../src/server/metadata/musicbrainz';
import { LocalRateLimitError, MetadataRateLimiter } from '../src/server/metadata/queue';
import { searchAlbums, SearchMemo } from '../src/server/metadata/search';
import { MusicBrainzSource, SourceChain, type AlbumSource, type MetadataSource } from '../src/server/metadata/sources';

// —— 假时钟：sleepFn 即推进（零真实等待，间隔断言在假时钟上确定性成立）——
function fakeClock() {
  const state = { now: 0 };
  return {
    get now() {
      return state.now;
    },
    nowFn: () => state.now,
    advance: (ms: number) => {
      state.now += ms;
    },
    sleepFn: async (ms: number) => {
      await tick(); // 让出 macrotask：回填轮询间可插入交互（waitIdle 每 tick 至多一轮）
      state.now += ms;
    }
  };
}

const tick = () => new Promise<void>((r) => setImmediate(r));
const flush = async (n = 20) => {
  for (let i = 0; i < n; i++) await tick();
};

const png = (): Response => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'Content-Type': 'image/png' } });
const dl = (coverUrl: string, coversDir: string, fetchFn?: typeof fetch): CoverDownloadOptions => ({
  coverUrl,
  coversDir,
  userAgent: 't',
  fetchFn: fetchFn ?? (async () => png()) as typeof fetch
});

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

/** 桩源：记录调用次数（先例 = metadata.smoke.test.ts stubSource） */
function stubSource(name: MetadataSource, behavior: () => Promise<AlbumCandidate[]>): AlbumSource & { calls: number } {
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

describe('CoverGate（IM-22 R3 封面独立门）', () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-gate-'));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('串行间隔：相邻上游发起 ≥ minIntervalMs（独立门不占搜索 30/min 窗）', async () => {
    const clock = fakeClock();
    const starts: number[] = [];
    const fetchFn = (async () => {
      starts.push(clock.now);
      return png();
    }) as typeof fetch;
    const gate = new CoverGate({ minIntervalMs: 1000, maxInFlight: 2, nowFn: clock.nowFn, sleepFn: clock.sleepFn });
    await Promise.all([gate.download(dl('u1', dir, fetchFn)), gate.download(dl('u2', dir, fetchFn)), gate.download(dl('u3', dir, fetchFn))]);
    assert.equal(starts.length, 3);
    assert.equal(starts[0], 0);
    assert.ok((starts[1] ?? 0) - (starts[0] ?? 0) >= 1000, '第 2 次发起距第 1 次 ≥1s（假时钟）');
    assert.ok((starts[2] ?? 0) - (starts[1] ?? 0) >= 1000, '第 3 次发起距第 2 次 ≥1s（假时钟）');
  });

  test('在途 ≤2：名额满时第三个下载等待，释放后才发起', async () => {
    const clock = fakeClock();
    const pendings: Array<(r: Response) => void> = [];
    const fetchFn = (async () => new Promise<Response>((resolve) => pendings.push(resolve))) as typeof fetch;
    const gate = new CoverGate({ minIntervalMs: 1000, maxInFlight: 2, nowFn: clock.nowFn, sleepFn: clock.sleepFn });
    const p1 = gate.download(dl('a', dir, fetchFn));
    const p2 = gate.download(dl('b', dir, fetchFn));
    const p3 = gate.download(dl('c', dir, fetchFn));
    await flush();
    assert.equal(pendings.length, 2, '在途满 2，第 3 个不得发起');
    (pendings[0] as (r: Response) => void)(png());
    await p1;
    await flush();
    assert.equal(pendings.length, 3, '名额释放后第 3 个发起（间隔照守）');
    (pendings[1] as (r: Response) => void)(png());
    (pendings[2] as (r: Response) => void)(png());
    await Promise.all([p2, p3]);
  });

  test('single-flight：同封面并发合并为一次 fetch，不同封面不合并', async () => {
    const clock = fakeClock();
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      // 字节随调用序变化：内容寻址下相同字节必同名，须不同字节才能断言「不同封面不同名」
      return new Response(new Uint8Array([9, calls]), { status: 200, headers: { 'Content-Type': 'image/png' } });
    }) as typeof fetch;
    const gate = new CoverGate({ minIntervalMs: 0, maxInFlight: 4, nowFn: clock.nowFn, sleepFn: clock.sleepFn });
    const [a, b, c] = await Promise.all([gate.download(dl('same', dir, fetchFn)), gate.download(dl('same', dir, fetchFn)), gate.download(dl('other', dir, fetchFn))]);
    assert.equal(calls, 2, '同 URL 两次并发 = 1 次 fetch + 另一 URL 1 次');
    assert.equal(a, b, '同封面并发者拿到同一结果');
    assert.notEqual(a, c);
  });
});

describe('CoverGate R4 回填空闲门（Q3 N=10s）', () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-idle-'));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('交互在途不让位；交互结束且空闲 >阈值 后回填才注入，且注入走同一串行门', async () => {
    const clock = fakeClock();
    const starts: number[] = [];
    let resolveFetch!: (r: Response) => void;
    const fetchFn = (async () => {
      starts.push(clock.now);
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    }) as typeof fetch;
    const gate = new CoverGate({ minIntervalMs: 1000, idleMs: 10_000, nowFn: clock.nowFn, sleepFn: clock.sleepFn });
    const interactive = gate.download(dl('u1', dir, fetchFn));
    void gate.downloadBackfill(dl('u2', dir, fetchFn)); // 回填挂起等待空闲，断言仅观测其注入时刻
    await flush();
    assert.equal(starts.length, 1, '交互在途 → 回填不注入（交互优先）');
    resolveFetch(png());
    await interactive;
    await flush(80); // 回填轮询推进假时钟（1s/轮）
    assert.equal(starts.length, 2, '空闲达标后回填注入');
    assert.ok((starts[1] ?? 0) - (starts[0] ?? 0) >= 10_000, '回填距交互发起 ≥ 空闲阈值');
    assert.ok(gate.idleForMs() >= 0);
  });

  test('busyProbe 外部忙碌（搜索队列忙）→ 让行；交互到达重置空闲钟再次顺延', async () => {
    const clock = fakeClock();
    const starts: number[] = [];
    let probeBusy = true;
    const fetchFn = (async () => {
      starts.push(clock.now);
      return png();
    }) as typeof fetch;
    const gate = new CoverGate({ minIntervalMs: 0, idleMs: 5000, busyProbe: () => probeBusy, nowFn: clock.nowFn, sleepFn: clock.sleepFn });
    const backfill = gate.downloadBackfill(dl('u1', dir, fetchFn));
    await flush(30);
    assert.equal(starts.length, 0, '外部忙碌 → 门空闲也不注入');
    probeBusy = false;
    await flush(30);
    assert.equal(starts.length, 1, '外部空闲且门空闲 >阈值 → 注入');
    // 第二轮回填：等待中途交互到达 → 空闲钟重置 → 注入点顺延 ≥ idleMs
    const backfill2 = gate.downloadBackfill(dl('u2', dir, fetchFn));
    await flush(2); // ~2 轮轮询：假时钟 +2s < 5s，未达空闲阈值不注入
    const interactiveAt = clock.now;
    await gate.download(dl('u3', dir, fetchFn)); // 交互：即时完成并重置 lastActivityAt
    await flush(90);
    assert.equal(starts.length, 3, '发起序 = u1（首轮回填）/ u3（交互）/ u2（顺延后的回填）');
    assert.equal(starts[1], interactiveAt, '交互立即发起不排队等待');
    assert.ok((starts[2] ?? 0) - interactiveAt >= 5000, '交互重置空闲钟 → 回填注入顺延 ≥ idleMs');
    await backfill;
    await backfill2;
  });
});

describe('SearchMemo R2 搜索 single-flight（search.ts）', () => {
  let dir: string;
  let db: Db;
  let dao: DAO;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-sf-'));
    db = openDatabase(join(dir, 't.db'));
    runMigrations(db, 'db/migrations');
    dao = new DAO(db);
  });
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('同链路同 q 同 limit 并发 → 共享一次上游调用，双方同结果', async () => {
    let release!: (v: AlbumCandidate[]) => void;
    const src = stubSource('musicbrainz', () => new Promise<AlbumCandidate[]>((resolve) => (release = resolve)));
    const chain = new SourceChain([src]);
    const memo = new SearchMemo();
    const p1 = searchAlbums(dao, chain, 'radiohead', 12, memo);
    const p2 = searchAlbums(dao, chain, 'radiohead', 12, memo);
    await flush();
    assert.equal(src.calls, 1, '并发同 q = 1 次上游');
    release([cand('musicbrainz', 'rel-1', 'OK Computer', 'Radiohead')]);
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.length, 1);
    assert.deepEqual(r2, r1, '共享同一在途结果');
  });

  test('不同 limit / 不同链路不共享；上游失败即摘除不连坐后续', async () => {
    let fail = true;
    const src = stubSource('musicbrainz', async () => {
      if (fail) throw new Error('upstream boom');
      return [cand('musicbrainz', 'rel-2', 'Kid A', 'Radiohead')];
    });
    const memo = new SearchMemo();
    const chain = new SourceChain([src]);
    const chain2 = new SourceChain([src]);
    // 失败：并发双方同 rejection
    await assert.rejects(() => Promise.all([searchAlbums(dao, chain, 'kid a', 12, memo), searchAlbums(dao, chain, 'kid a', 12, memo)]));
    assert.equal(src.calls, 1, '并发失败也只打一次上游');
    // 失败已摘除：同 q 可重试成功
    fail = false;
    const ok = await searchAlbums(dao, chain, 'kid a', 12, memo);
    assert.equal(ok.length, 1);
    assert.equal(src.calls, 2);
    // 不同 limit = 不同键：再打一次上游
    await searchAlbums(dao, chain, 'kid a', 6, memo);
    assert.equal(src.calls, 3);
    // 不同链路实例 = 不同键（?source= 过滤查询每请求新建链，天然不串味）
    await searchAlbums(dao, chain2, 'kid a', 12, memo);
    assert.equal(src.calls, 4);
  });
});

describe('SearchMemo R1 快照回放缓存（TTL 10min · Q1 规范化）', () => {
  let dir: string;
  let db: Db;
  let dao: DAO;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-r1-'));
    db = openDatabase(join(dir, 't.db'));
    runMigrations(db, 'db/migrations');
    dao = new DAO(db);
  });
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('命中：规范化（trim+casefold）同 q 零上游，从 DB 重建并重算 in_collection（用户数据即时）', async () => {
    const src = stubSource('musicbrainz', async () => [cand('musicbrainz', 'r1', 'OK Computer', 'Radiohead'), cand('musicbrainz', 'r2', 'Kid A', 'Radiohead')]);
    const chain = new SourceChain([src]);
    const memo = new SearchMemo();
    const first = await searchAlbums(dao, chain, 'OK Computer', 12, memo);
    assert.equal(src.calls, 1);
    assert.equal(first.length, 2);
    dao.createRecord({ album_id: first[0]?.id ?? '' }); // 用户收藏第一张（回放须重算）
    const replay = await searchAlbums(dao, chain, '  ok COMPUTER  ', 12, memo);
    assert.equal(src.calls, 1, '规范化后命中快照 → 零上游');
    assert.deepEqual(replay.map((it) => it.id), first.map((it) => it.id), 'ids 保序回放');
    assert.equal(replay[0]?.in_collection, true, 'in_collection 重算：搜索后才收藏的行回放即标 true');
    assert.equal(replay[1]?.in_collection, false);
  });

  test('TTL 10min：窗口内命中零上游，过期重打；超限 FIFO 淘汰（内存有界）', async () => {
    const clock = fakeClock();
    const src = stubSource('musicbrainz', async () => [cand('musicbrainz', 't1', 'T Album', 'T Artist')]);
    const chain = new SourceChain([src]);
    const memo = new SearchMemo({ nowFn: clock.nowFn });
    await searchAlbums(dao, chain, 'same', 12, memo);
    assert.equal(src.calls, 1);
    clock.advance(599_999);
    await searchAlbums(dao, chain, 'same', 12, memo);
    assert.equal(src.calls, 1, 'TTL 窗口内（<10min）命中零上游');
    clock.advance(1);
    await searchAlbums(dao, chain, 'same', 12, memo);
    assert.equal(src.calls, 2, '恰过 10min → 过期重打上游');
    // FIFO：maxEntries=1 时旧键被淘汰
    const memo1 = new SearchMemo({ nowFn: clock.nowFn, maxEntries: 1 });
    const chain1 = new SourceChain([src]);
    await searchAlbums(dao, chain1, 'a', 12, memo1);
    await searchAlbums(dao, chain1, 'b', 12, memo1);
    assert.equal(src.calls, 4);
    await searchAlbums(dao, chain1, 'a', 12, memo1);
    assert.equal(src.calls, 5, '"a" 已被 "b" 淘汰 → 重打上游（条目数有界）');
  });

  test('429 保护路径：窗口满时新 q 仍本地 429；缓存命中 q 不受窗口影响照常返回', async () => {
    let upstream = 0;
    const FIXTURE = {
      count: 1,
      releases: [
        {
          id: 'mb-429',
          title: 'Window Album',
          'artist-credit': [{ name: 'W', joinphrase: '' }],
          'cover-art-archive': { front: false, artwork: false }
        }
      ]
    };
    const fetchFn = (async () => {
      upstream++;
      return new Response(JSON.stringify(FIXTURE), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    // maxPerMinute=1：第一次搜索占满窗口（self-imposed 30/min 的 1/min 缩影）
    const src = new MusicBrainzSource(new MusicBrainzClient(new MetadataRateLimiter({ minIntervalMs: 0, maxPerMinute: 1 }), 'ua', fetchFn));
    const chain = new SourceChain([src]);
    const memo = new SearchMemo();
    const first = await searchAlbums(dao, chain, 'alpha', 12, memo);
    assert.equal(first.length, 1);
    assert.equal(upstream, 1);
    const replay = await searchAlbums(dao, chain, 'alpha', 12, memo);
    assert.equal(upstream, 1, '缓存命中零上游（窗口满也不影响）');
    assert.equal(replay.length, 1);
    await assert.rejects(() => searchAlbums(dao, chain, 'beta', 12, memo), LocalRateLimitError, '新 q 必打上游 → 窗口满 → 本地 429');
    assert.equal(upstream, 1, '429 未打上游');
  });
});
