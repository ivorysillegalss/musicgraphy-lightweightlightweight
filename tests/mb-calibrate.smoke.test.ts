// B7 MB 按需权威化冒烟（IM-23 Q1 路线 B 后置半截；零网络注入：resolve 走 client 桩 /
// 限流纪律走真 MetadataRateLimiter + nowFn/sleepFn 注入，W1-2/W2-2/B5 同口径）
// 覆盖：命中更新+关联+用户数据不动 / 未命中保留 / fail-soft / 幂等零上游 / dry-run 零写入 /
// 限流 ≥1s / --limit 续跑 / 封面缺档钩子 / 归并未落原行如实报告 / 空字段与 --id 守卫
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { DAO } from '../src/server/db/dao';
import type { Row } from '../src/server/db/sql';
import { mapAlbum, type AlbumRow } from '../src/server/db/types';
import { MusicBrainzClient, UpstreamError, type AlbumCandidate } from '../src/server/metadata/musicbrainz';
import { MetadataRateLimiter } from '../src/server/metadata/queue';
import { calibrateRows, getNeteaseRow, listNeteaseRows, type CalibrateSummary, type ResolveClient } from '../scripts/mb-calibrate';

/** 零网络 client 桩：按 (artist,title) 返回预置候选，记录调用 */
function stubClient(script: Array<AlbumCandidate | null | Error>): { client: ResolveClient; calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  let i = 0;
  return {
    calls,
    client: {
      async resolveReleaseByArtistAndTitle(artist: string, title: string) {
        calls.push([artist, title]);
        const step = script[Math.min(i++, script.length - 1)] ?? null;
        if (step instanceof Error) throw step;
        return step;
      }
    }
  };
}

const HIT = (sourceId = 'mbid-1', cover = `https://coverartarchive.org/release/${sourceId}/front-250`): AlbumCandidate => ({
  source: 'musicbrainz',
  source_id: sourceId,
  title: 'Fan Texi',
  artist: 'Jay Chou',
  release_year: 2001,
  cover_url: cover,
  country: 'TW',
  genres: [],
  in_collection: false
});

interface Fixture {
  db: Db;
  dao: DAO;
  cleanup: () => void;
}

function tempDb(tag: string): Fixture {
  const dir = mkdtempSync(join(tmpdir(), `mg-b7-${tag}-`));
  const db = openDatabase(join(dir, 't.db'));
  runMigrations(db, 'db/migrations');
  return {
    db,
    dao: new DAO(db),
    cleanup: () => {
      try {
        db.close(); // Windows：SQLite 文件句柄未关时 rmSync EPERM
      } catch {
        /* 已关则忽略 */
      }
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

let seedSeq = 0;
/** 种 netease 行（distinct title/artist 防 identity 互并；created_at 递增 → 枚举序确定）+ record + tag */
function seedNetease(db: Db, dao: DAO, title: string, artist = '周杰伦', over: Partial<{ sourceId: string; year: number | null; coverUrl: string | null }> = {}): string {
  const { id } = dao.upsertAlbum({
    source: 'netease',
    source_id: over.sourceId ?? `ne-${title}`,
    title,
    artist,
    release_year: over.year ?? null,
    cover_url: over.coverUrl === undefined ? 'http://ne/cover.jpg' : over.coverUrl
  });
  const seq = ++seedSeq;
  db.prepare('UPDATE album_metadata SET created_at = ? WHERE id = ?').run(`2026-01-01T00:00:0${seq % 10}.000Z`, id);
  const rec = dao.createRecord({ album_id: id, listened_at: '2005-01-01', listened_precision: 'day' });
  dao.setTags(rec.id, ['netease'], 'local');
  return id;
}

const albumOf = (db: Db, id: string): AlbumRow => mapAlbum(db.prepare('SELECT * FROM album_metadata WHERE id = ?').get(id) as Row);
const recordOf = (db: Db): Row => db.prepare('SELECT id, album_id, listened_at FROM collection_record').get() as Row;

describe('B7 MB 按需权威化（IM-23 Q1 路线 B 后置半截）', () => {
  test('命中：upsertAlbum 归并更新元数据 + alias_sources 记 MBID，netease 主键/用户数据不动', async () => {
    const f = tempDb('hit');
    try {
      const id = seedNetease(f.db, f.dao, '范特西'); // year=null 待 MB 填充；cover_url 有值（不降级）
      const recBefore = recordOf(f.db);
      const { client } = stubClient([HIT()]);
      const s = await calibrateRows(f.dao, listNeteaseRows(f.db), client);
      assert.deepEqual({ checked: s.checked, calibrated: s.calibrated, missed: s.missed, failed: s.failed }, { checked: 1, calibrated: 1, missed: 0, failed: 0 });
      const a = albumOf(f.db, id);
      assert.equal(a.source, 'netease', '主键仍 netease（三级落点归并，不分裂新行）');
      assert.equal(a.source_id, 'ne-范特西');
      assert.deepEqual(a.alias_sources, [{ source: 'musicbrainz', source_id: 'mbid-1' }]);
      assert.equal(a.release_year, 2001, 'MB 权威年份保守填充');
      assert.equal(a.country, 'TW');
      assert.equal(a.cover_url, 'http://ne/cover.jpg', '封面不降级：netease 现值优先');
      assert.equal(recordOf(f.db).album_id, recBefore.album_id, 'collection_record 不动');
      assert.equal(recordOf(f.db).listened_at, '2005-01-01');
      const tags = f.db.prepare('SELECT t.name FROM record_tag rt JOIN tags t ON t.id = rt.tag_id').all() as Row[];
      assert.deepEqual(tags.map((r) => r['name']), ['netease'], 'tags 不动');
    } finally {
      f.cleanup();
    }
  });

  test('未命中：missed 计数，netease 行保留不动（fail-soft）', async () => {
    const f = tempDb('miss');
    try {
      const id = seedNetease(f.db, f.dao, '无名专辑');
      const before = albumOf(f.db, id);
      const { client } = stubClient([null]);
      const s = await calibrateRows(f.dao, listNeteaseRows(f.db), client);
      assert.deepEqual({ checked: s.checked, calibrated: s.calibrated, missed: s.missed, failed: s.failed }, { checked: 1, calibrated: 0, missed: 1, failed: 0 });
      assert.deepEqual(s.missedKeys, ['周杰伦 - 无名专辑']);
      const after = albumOf(f.db, id);
      assert.deepEqual(after, before, '行零变化（含 updated_at）');
    } finally {
      f.cleanup();
    }
  });

  test('上游异常：failed 进 failures 不阻塞整批，后续行照常权威化', async () => {
    const f = tempDb('failsoft');
    try {
      const idA = seedNetease(f.db, f.dao, '专辑甲');
      seedNetease(f.db, f.dao, '专辑乙');
      const err = new UpstreamError(503, 'upstream_rate_limited', 'MusicBrainz 拒绝（超速）', 30);
      const { client } = stubClient([err, HIT('mbid-2')]);
      const s = await calibrateRows(f.dao, listNeteaseRows(f.db), client);
      assert.equal(s.failed, 1);
      assert.equal(s.calibrated, 1, '第二行不受首行失败连坐');
      assert.equal(s.failures.length, 1);
      const f0 = s.failures[0] ?? '';
      assert.ok(f0.includes('专辑甲') && f0.includes('超速'), `失败清单含行名与上游错误文本：${f0}`);
      assert.deepEqual(albumOf(f.db, idA).alias_sources, [], '失败行零写入');
    } finally {
      f.cleanup();
    }
  });

  test('幂等：已权威化行（alias 含 musicbrainz）零上游零写入，重复执行校准数稳定', async () => {
    const f = tempDb('idem');
    try {
      seedNetease(f.db, f.dao, '范特西');
      const { client, calls } = stubClient([HIT()]);
      const s1 = await calibrateRows(f.dao, listNeteaseRows(f.db), client);
      assert.equal(s1.calibrated, 1);
      assert.equal(calls.length, 1);
      const s2 = await calibrateRows(f.dao, listNeteaseRows(f.db), client); // 重跑：alias 已含 MB → 跳过
      assert.deepEqual({ checked: s2.checked, calibrated: s2.calibrated, missed: s2.missed, failed: s2.failed }, { checked: 1, calibrated: 1, missed: 0, failed: 0 });
      assert.equal(calls.length, 1, '第二次零上游调用');
    } finally {
      f.cleanup();
    }
  });

  test('dry-run：resolve 照常分类，零 DB 写、零封面钩子', async () => {
    const f = tempDb('dryrun');
    try {
      const id = seedNetease(f.db, f.dao, '范特西');
      const before = albumOf(f.db, id);
      const { client, calls } = stubClient([HIT()]);
      let hooked = 0;
      const s = await calibrateRows(f.dao, listNeteaseRows(f.db), client, { dryRun: true, onAlbumAdded: () => hooked++ });
      assert.equal(s.dryRun, true);
      assert.deepEqual({ checked: s.checked, calibrated: s.calibrated, missed: s.missed, failed: s.failed }, { checked: 1, calibrated: 1, missed: 0, failed: 0 });
      assert.equal(calls.length, 1, '上游 resolve 照常（分类可见）');
      assert.deepEqual(albumOf(f.db, id), before, '零写入（含 updated_at）');
      assert.equal(hooked, 0, '零封面钩子');
    } finally {
      f.cleanup();
    }
  });

  test('限流纪律：两次 resolve 相邻间隔 ≥1s（真 limiter + nowFn/sleepFn 注入）', async () => {
    const f = tempDb('limit');
    try {
      seedNetease(f.db, f.dao, '专辑甲');
      seedNetease(f.db, f.dao, '专辑乙');
      let t = 1_000_000;
      const sleeps: number[] = [];
      const nowFn = (): number => t;
      const sleepFn = (ms: number): Promise<void> => {
        t += ms;
        sleeps.push(ms);
        return Promise.resolve();
      };
      let mbCalls = 0;
      const client = new MusicBrainzClient(new MetadataRateLimiter({ minIntervalMs: 1050, maxPerMinute: 30, nowFn, sleepFn }), 'ua', (async () => {
        mbCalls++;
        return new Response(JSON.stringify({ releases: [{ id: `mbid-${mbCalls}`, title: 'T', 'artist-credit': [{ name: 'A' }] }] }), { status: 200 });
      }) as typeof fetch);
      const s = await calibrateRows(f.dao, listNeteaseRows(f.db), client);
      assert.equal(s.calibrated, 2);
      assert.equal(mbCalls, 2);
      assert.deepEqual(sleeps, [1050], '第二次调用前等待全局限流间隔');
    } finally {
      f.cleanup();
    }
  });

  test('--limit 续跑：额度只管需 resolve 的行，已权威化行不占额度', async () => {
    const f = tempDb('budget');
    try {
      seedNetease(f.db, f.dao, '专辑甲');
      seedNetease(f.db, f.dao, '专辑乙');
      seedNetease(f.db, f.dao, '专辑丙');
      const { client, calls } = stubClient([HIT('mbid-1'), HIT('mbid-2'), HIT('mbid-3')]);
      const s1 = await calibrateRows(f.dao, listNeteaseRows(f.db), client, { limit: 1 });
      assert.deepEqual({ checked: s1.checked, calibrated: s1.calibrated }, { checked: 1, calibrated: 1 });
      assert.equal(calls.length, 1);
      const s2 = await calibrateRows(f.dao, listNeteaseRows(f.db), client); // 续跑：剩两张
      assert.deepEqual({ checked: s2.checked, calibrated: s2.calibrated }, { checked: 3, calibrated: 3 });
      assert.equal(calls.length, 3, '总计 3 次上游（首行幂等跳过）');
    } finally {
      f.cleanup();
    }
  });

  test('封面缺档回填：cover_local 空 → onAlbumAdded 钩子触发；已有 cover_local 不触发', async () => {
    const f = tempDb('cover');
    try {
      const idA = seedNetease(f.db, f.dao, '缺封面', '周杰伦', { coverUrl: null }); // cover_url/cover_local 双空
      const idB = seedNetease(f.db, f.dao, '有封面', '周杰伦', { sourceId: 'ne-b' });
      f.dao.setAlbumCoverLocal(idB, 'b.jpg');
      const { client } = stubClient([HIT('mbid-a'), HIT('mbid-b')]);
      const hooked: Array<[string, string | null]> = [];
      await calibrateRows(f.dao, listNeteaseRows(f.db), client, { onAlbumAdded: (albumId, coverUrl) => hooked.push([albumId, coverUrl]) });
      assert.deepEqual(hooked, [[idA, 'https://coverartarchive.org/release/mbid-a/front-250']], '仅缺档行触发钩子');
      assert.equal(albumOf(f.db, idA).cover_url, 'https://coverartarchive.org/release/mbid-a/front-250', '缺档填 CAA');
      assert.equal(albumOf(f.db, idB).cover_url, 'http://ne/cover.jpg', '有档行封面不动');
    } finally {
      f.cleanup();
    }
  });

  test('归并未落原行（同 MBID 已被他行主键占用）→ failed 如实报告，原行不动', async () => {
    const f = tempDb('split');
    try {
      const idA = seedNetease(f.db, f.dao, '范特西');
      f.dao.upsertAlbum({ source: 'musicbrainz', source_id: 'mbid-9', title: '范特西 ', artist: '周杰伦' }); // 尾空格避 identity → 独立 MB 行
      const { client } = stubClient([HIT('mbid-9')]);
      const s = await calibrateRows(f.dao, listNeteaseRows(f.db), client);
      assert.deepEqual({ checked: s.checked, calibrated: s.calibrated, failed: s.failed }, { checked: 1, calibrated: 0, failed: 1 });
      assert.ok((s.failures[0] ?? '').includes('归并未落在原行'), `failures 披露落点：${s.failures[0] ?? ''}`);
      assert.deepEqual(albumOf(f.db, idA).alias_sources, [], '原行未被误标');
    } finally {
      f.cleanup();
    }
  });

  test('守卫：title/artist 空 → failed 且零上游；getNeteaseRow 拒绝非 netease/不存在行', async () => {
    const f = tempDb('guard');
    try {
      f.dao.upsertAlbum({ source: 'netease', source_id: 'ne-empty', title: '', artist: '' });
      const { client, calls } = stubClient([HIT()]);
      const s: CalibrateSummary = await calibrateRows(f.dao, listNeteaseRows(f.db), client);
      assert.equal(s.failed, 1);
      assert.ok((s.failures[0] ?? '').includes('为空'));
      assert.equal(calls.length, 0, '守卫在 resolve 之前');
      const neteaseId = (f.db.prepare("SELECT id FROM album_metadata WHERE source='netease'").get() as Row)['id'] as string;
      assert.notEqual(getNeteaseRow(f.db, neteaseId), null, 'netease 行可取');
      f.dao.upsertAlbum({ source: 'musicbrainz', source_id: 'mb-guard', title: '无空格', artist: '别人' });
      const mbId = (f.db.prepare("SELECT id FROM album_metadata WHERE source='musicbrainz'").get() as Row)['id'] as string;
      assert.equal(getNeteaseRow(f.db, mbId), null, '非 netease 行拒绝');
      assert.equal(getNeteaseRow(f.db, 'no-such-id'), null, '不存在行返回 null');
    } finally {
      f.cleanup();
    }
  });
});
