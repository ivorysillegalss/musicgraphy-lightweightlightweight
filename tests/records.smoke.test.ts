// 集合域路由冒烟（Step 1）：POST 201/409/422 · 详情/PATCH · collection cursor 翻页 · counts · echo 204
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Hono } from 'hono';
import { createApp } from '../src/server/app';
import { loadConfig, type Config } from '../src/server/config';
import { DAO } from '../src/server/db/dao';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { MusicBrainzClient } from '../src/server/metadata/musicbrainz';
import { MetadataRateLimiter } from '../src/server/metadata/queue';

const stubFetch = (async () =>
  new Response(JSON.stringify({ releases: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

describe('集合域路由（Step 1，ADR-007）', () => {
  let dir: string;
  let db: Db;
  let dao: DAO;
  let cfg: Config;
  let app: Hono;
  let recordId = '';

  const H = (): Record<string, string> => ({ Authorization: `Bearer ${cfg.accessKey}`, 'Content-Type': 'application/json' });
  const G = (): RequestInit => ({ headers: { Authorization: `Bearer ${cfg.accessKey}` } });

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-rec-'));
    db = openDatabase(join(dir, 't.db'));
    runMigrations(db, 'db/migrations');
    dao = new DAO(db);
    cfg = loadConfig();
    app = createApp(dao, cfg, new MusicBrainzClient(new MetadataRateLimiter({ minIntervalMs: 0 }), cfg.userAgent, stubFetch));
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('POST /records → 201 + Location + 快照落库；重复 → 409 duplicate_record 带 record_id', async () => {
    const res = await app.request('/api/v1/records', {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({
        source: 'musicbrainz',
        source_id: 'rec-1',
        title: 'Blue Train',
        artist: 'John Coltrane',
        release_year: 1958,
        genres: ['Jazz'],
        cover_url: 'https://coverartarchive.org/release/rec-1/front-250',
        tags: ['夜晚'],
        is_favorite: true
      })
    });
    assert.equal(res.status, 201);
    const json = (await res.json()) as { data: { id: string; in_collection: boolean } };
    assert.equal(res.headers.get('Location'), `/api/v1/records/${json.data.id}`);
    assert.equal(json.data.in_collection, true);

    const dup = await app.request('/api/v1/records', {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({ source: 'musicbrainz', source_id: 'rec-1' })
    });
    assert.equal(dup.status, 409);
    const dj = (await dup.json()) as { error: { code: string; details: { record_id: string } } };
    assert.equal(dj.error.code, 'duplicate_record');
    recordId = dj.error.details.record_id;
    assert.ok(recordId.length > 0);
  });

  test('新专辑缺 title/artist → 422 validation_failed（F1 快照要求）', async () => {
    const res = await app.request('/api/v1/records', {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({ source: 'musicbrainz', source_id: 'rec-new' })
    });
    assert.equal(res.status, 422);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'validation_failed');
  });

  test('详情 + PATCH（note/listened 落库；非法 cover_color 422；不存在 404）', async () => {
    const g = await app.request(`/api/v1/records/${recordId}`, G());
    assert.equal(g.status, 200);
    const gj = (await g.json()) as {
      data: {
        title: string;
        tags: string[];
        is_favorite: boolean;
        cover_src: string | null;
        album: { title: string; artist: string; release_year: number | null };
      };
    };
    // 该记录此前经历过一次"重复添加"（409 路径）——快照必须未被空字段清空（IM-12 保守合并回归）
    assert.equal(gj.data.album.title, 'Blue Train');
    assert.deepEqual(gj.data.tags, ['夜晚']);
    assert.equal(gj.data.is_favorite, true);
    assert.equal(gj.data.cover_src, 'https://coverartarchive.org/release/rec-1/front-250');

    const p = await app.request(`/api/v1/records/${recordId}`, {
      method: 'PATCH',
      headers: H(),
      body: JSON.stringify({ note: '为什么留下它', listened_at: '2026-01-01T00:00:00Z', listened_precision: 'year' })
    });
    assert.equal(p.status, 200);
    const bad = await app.request(`/api/v1/records/${recordId}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ cover_color: 99 }) });
    assert.equal(bad.status, 422);
    const nf = await app.request('/api/v1/records/nope', G());
    assert.equal(nf.status, 404);
  });

  test('collection cursor 翻页（meta/links）+ counts 轴排除 + echo 204', async () => {
    for (let i = 0; i < 65; i++) {
      const { id: albumId } = dao.upsertAlbum({
        source: 'musicbrainz',
        source_id: `bulk-${i}`,
        title: `Bulk ${String(i).padStart(3, '0')}`,
        artist: `Artist ${i % 7}`,
        release_year: 1970 + (i % 50),
        genres: ['Bulk']
      });
      dao.createRecord({ album_id: albumId });
    }
    const p1 = await app.request('/api/v1/collection?limit=60', G());
    const j1 = (await p1.json()) as {
      data: unknown[];
      meta: { has_next: boolean; next_cursor: string | null };
      links: { next: string | null };
    };
    assert.equal(j1.data.length, 60); // 66 条全量
    assert.equal(j1.meta.has_next, true);
    assert.ok((j1.links.next ?? '').includes('cursor='));
    const p2 = await app.request(j1.links.next ?? '', G());
    const j2 = (await p2.json()) as { data: unknown[]; meta: { has_next: boolean } };
    assert.equal(j2.data.length, 6);
    assert.equal(j2.meta.has_next, false);

    const counts = await app.request('/api/v1/collection/counts?genre=Jazz', G());
    const cj = (await counts.json()) as { data: { genre?: Array<{ value: unknown; count: number }>; year?: Array<{ count: number }> } };
    const genreSum = (cj.data.genre ?? []).reduce((a, x) => a + x.count, 0);
    assert.ok(genreSum > 1, 'genre 轴不受自身筛选影响（轴排除式）');

    const echo = await app.request('/api/v1/echo/today', G());
    assert.equal(echo.status, 204); // 种子无"一年前的今天"
  });
});
