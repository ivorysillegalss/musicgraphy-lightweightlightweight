// 封面回填驱动冒烟（R4 接线 · IM-32）：pass 补齐缺口写回 cover_local / 死链如实 failed 不阻塞 /
// 无 cover_url 不在扫描面 / 幂等（重复 pass 零重复下载）。零真实网络（fetchFn 注入）。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { DAO } from '../src/server/db/dao';
import { CoverGate } from '../src/server/metadata/cover-gate';
import { coverBackfillPass } from '../src/server/metadata/cover-backfill';

describe('封面回填驱动（R4 接线 · IM-32）', () => {
  let dir: string;
  let db: Db;
  let coversDir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-cbfill-'));
    db = openDatabase(join(dir, 't.db'));
    runMigrations(db, 'db/migrations');
    coversDir = join(dir, 'covers');
    const dao = new DAO(db);
    const withCover = dao.upsertAlbum({ source: 'musicbrainz', source_id: 'bf-1', title: 'Has Cover', artist: 'A' });
    db.prepare('UPDATE album_metadata SET cover_url = ? WHERE id = ?').run('http://cdn/1.jpg', withCover.id);
    const dead = dao.upsertAlbum({ source: 'musicbrainz', source_id: 'bf-2', title: 'Dead Url', artist: 'B' });
    db.prepare('UPDATE album_metadata SET cover_url = ? WHERE id = ?').run('http://cdn/dead.jpg', dead.id);
    dao.upsertAlbum({ source: 'musicbrainz', source_id: 'bf-3', title: 'No Url', artist: 'C' }); // 无 cover_url → 不在扫描面
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('pass：缺口补齐写回 cover_local + 死链如实 failed + 无 url 行不在扫描面', async () => {
    let t = 0;
    const gate = new CoverGate({
      nowFn: () => (t += 30_000), // 每次读钟 +30s → 空闲判定立即满足（避开真实 10s 空闲等待）
      sleepFn: async () => {}
    });
    const fetchFn = (async (input: unknown) => {
      const url = String(input);
      if (url.includes('dead')) return new Response('nope', { status: 404 });
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), {
        status: 200,
        headers: { 'Content-Type': 'image/jpg' } // 顺带回归网易云非标准类型放行
      });
    }) as typeof fetch;
    const r = await coverBackfillPass(db, gate, coversDir, 't', fetchFn);
    assert.equal(r.downloaded, 1);
    assert.equal(r.failed, 1);
    assert.equal(r.remaining, 1);
    const ok = db.prepare("SELECT cover_local FROM album_metadata WHERE source_id='bf-1'").get() as { cover_local: string | null };
    assert.ok(ok.cover_local !== null && ok.cover_local.endsWith('.jpg'));
    assert.ok(existsSync(join(coversDir, ok.cover_local ?? ''))); // 文件真落盘
    const deadRow = db.prepare("SELECT cover_local FROM album_metadata WHERE source_id='bf-2'").get() as { cover_local: string | null };
    assert.equal(deadRow.cover_local, null); // 死链不写值（诚实缺档）
  });

  test('幂等：重复 pass 不重复下载（缺口只剩死链 → downloaded=0 / failed=1）', async () => {
    let calls = 0;
    let t = 0;
    const gate = new CoverGate({
      nowFn: () => (t += 30_000),
      sleepFn: async () => {}
    });
    const fetchFn = (async () => {
      calls += 1;
      return new Response('nope', { status: 404 });
    }) as typeof fetch;
    const r = await coverBackfillPass(db, gate, coversDir, 't', fetchFn);
    assert.equal(r.downloaded, 0);
    assert.equal(r.failed, 1);
    assert.equal(r.remaining, 1);
    assert.equal(calls, 1); // 只对死链发起一次，无重复
  });
});
