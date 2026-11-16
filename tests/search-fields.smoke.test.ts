// S2-2 搜索分字段定向冒烟（方案 b · q 前缀语法）：路由层全链验证。
// URL 即状态零新参数（语法住在既有 q 参数值内）；本地 /api/v1/collection 与 SSR
// search-suggest 片段同走 buildWhere（一处接线全链生效）；外部 /api/v1/search/albums
// 经 searchAlbums 解析后向源透传 fields。
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
import type { AlbumCandidate } from '../src/server/metadata/musicbrainz';
import { type AlbumSearchFields, type AlbumSource } from '../src/server/metadata/sources';

/** 记录调用实参的桩源（挂名 deezer 以便 ?source= 定向单源链） */
class RecordingSource implements AlbumSource {
  readonly name = 'deezer' as const;
  readonly enabled = true;
  readonly calls: Array<{ q: string; limit: number; fields?: AlbumSearchFields }> = [];
  async search(q: string, limit: number, fields?: AlbumSearchFields): Promise<AlbumCandidate[]> {
    this.calls.push({ q, limit, fields });
    return [];
  }
}

describe('S2-2 分字段搜索路由冒烟（方案 b）', () => {
  let dir: string;
  let db: Db;
  let dao: DAO;
  let cfg: Config;
  let app: Hono;
  let src: RecordingSource;
  const ids: Record<string, string> = {};
  let cookie = '';

  const G = (): RequestInit => ({ headers: { Authorization: `Bearer ${cfg.accessKey}` } });
  const qIds = async (query: string): Promise<string[]> => {
    const res = await app.request(`/api/v1/collection?${query}`, G());
    assert.equal(res.status, 200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    return json.data.map((it) => it.id);
  };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mg-s22-'));
    db = openDatabase(join(dir, 't.db'));
    runMigrations(db, 'db/migrations');
    dao = new DAO(db);
    cfg = loadConfig();
    src = new RecordingSource();
    app = createApp(dao, cfg, [src]);

    // 语料（刻意错位：Train 在 r3 是 title、在 r4 是 artist；jazz 在 r2 是 tag、在 r4 是 tag 子串）
    const corpus: Array<{
      key: string;
      artist: string;
      title: string;
      year: number;
      tags: string[];
      note: string | null;
    }> = [
      { key: 'r1', artist: 'Jordan Rakei', title: 'Groove Curse', year: 2019, tags: ['soul'], note: '深夜巡游' },
      { key: 'r2', artist: 'キリンジ', title: '三', year: 2016, tags: ['jazz'], note: '阵雨记忆' },
      { key: 'r3', artist: 'John Coltrane', title: 'Blue Train', year: 1958, tags: ['bop'], note: null },
      { key: 'r4', artist: 'Nighttrain Productions', title: 'Odditorium', year: 2004, tags: ['trip-hop', 'jazz-fusion'], note: 'foo:bar 遗忘' }
    ];
    for (const c of corpus) {
      const { id: albumId } = dao.upsertAlbum({
        source: 'musicbrainz',
        source_id: `s22-${c.key}`,
        title: c.title,
        artist: c.artist,
        release_year: c.year,
        genres: []
      });
      const { id: recordId } = dao.createRecord({ album_id: albumId, note: c.note });
      if (c.tags.length > 0) dao.setTags(recordId, c.tags);
      ids[c.key] = recordId;
    }

    // SSR 片段走 cookie 通道（页面守卫不认 Bearer）
    const login = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `access_key=${encodeURIComponent(cfg.accessKey)}`
    });
    const setCookie = login.headers.get('Set-Cookie') ?? '';
    cookie = setCookie.split(';')[0] ?? '';
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('artist: 只搜艺术家（Train 是 r3 的 title 而非 artist → 命中 r4 不含 r3）', async () => {
    assert.deepEqual(await qIds('q=artist%3ATrain'), [ids['r4'] as string]);
  });

  test('title: 只搜专辑名（命中 r3 不含 r4）', async () => {
    assert.deepEqual(await qIds('q=title%3ATrain'), [ids['r3'] as string]);
  });

  test('无前缀 = 现状盲搜（title + artist 都命中 → r3+r4）——分字段与盲搜可区分', async () => {
    const got = await qIds('q=Train');
    assert.deepEqual(got.sort(), [ids['r3'], ids['r4']].sort());
  });

  test('引号值 artist:"Jordan Rakei"；无引号同效（值延伸到串尾）', async () => {
    assert.deepEqual(await qIds('q=artist%3A%22Jordan%20Rakei%22'), [ids['r1'] as string]);
    assert.deepEqual(await qIds('q=artist%3AJordan%20Rakei'), [ids['r1'] as string]);
  });

  test('多前缀 AND：artist:キリンジ title:三 → r2；artist:キリンジ title:Train → 空', async () => {
    assert.deepEqual(await qIds('q=artist%3A%E3%82%AD%E3%83%AA%E3%83%B3%E3%82%B8%20title%3A%E4%B8%89'), [ids['r2'] as string]);
    assert.deepEqual(await qIds('q=artist%3A%E3%82%AD%E3%83%AA%E3%83%B3%E3%82%B8%20title%3ATrain'), []);
  });

  test('tag: 子串命中（jazz → jazz + jazz-fusion）', async () => {
    const got = await qIds('q=tag%3Ajazz');
    assert.deepEqual(got.sort(), [ids['r2'], ids['r4']].sort());
  });

  test('note: 只搜备注', async () => {
    assert.deepEqual(await qIds('q=note%3A%E9%98%B5%E9%9B%A8'), [ids['r2'] as string]);
    assert.deepEqual(await qIds('q=note%3A%E6%B7%B1%E5%A4%9C'), [ids['r1'] as string]);
  });

  test('未知前缀字面量参与盲搜（foo:bar 命中 r4 的 note）', async () => {
    assert.deepEqual(await qIds('q=foo%3Abar'), [ids['r4'] as string]);
  });

  test('空值前缀忽略（q=artist: → 无条件全量）；前缀大小写不敏感', async () => {
    assert.equal((await qIds('q=artist%3A')).length, 4);
    assert.deepEqual(await qIds('q=ARTIST%3Acoltrane'), [ids['r3'] as string]);
  });

  test('URL 即状态零新参数：语法住在既有 q 参数值内（q 值原文携带前缀，无新增参数名）', async () => {
    const res = await app.request('/api/v1/collection?q=artist%3ATrain', G());
    assert.equal(res.status, 200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    assert.deepEqual(json.data.map((it) => it.id), [ids['r4'] as string]);
    // app.request 的 Response.url 为空串（Hono 测试响应不回填）——以请求串形态断言参数面：
    const sent = new URL('http://test.local/api/v1/collection?q=artist%3ATrain');
    assert.deepEqual([...sent.searchParams.keys()], ['q'], '请求只携带 q 一个参数（DD3 零新参数）');
    assert.equal(decodeURIComponent(sent.searchParams.get('q') ?? ''), 'artist:Train', '前缀语法住在 q 值内');
  });

  test('外部链：/api/v1/search/albums 解析同一语法 → fields 透传给源（q 原样、fields 结构化）', async () => {
    const res = await app.request('/api/v1/search/albums?q=artist%3Acoltrane&source=deezer&limit=5', G());
    assert.equal(res.status, 200);
    assert.equal(src.calls.length, 1);
    const call = src.calls[0];
    assert.equal(call?.q, 'artist:coltrane', 'q 保持原文（memo 键与降级折叠均可用）');
    assert.deepEqual(call?.fields, { artist: ['coltrane'], title: [], extra: [] });
    assert.equal(call?.limit, 5);
  });

  test('外部链：无前缀 q → fields=undefined（源行为与现状完全一致）', async () => {
    await app.request('/api/v1/search/albums?q=coltrane&source=deezer', G());
    const call = src.calls[src.calls.length - 1];
    assert.equal(call?.q, 'coltrane');
    assert.equal(call?.fields, undefined);
  });

  test('外部链：tag:（本地概念）→ 值折入 extra 盲搜文本，不丢词', async () => {
    await app.request('/api/v1/search/albums?q=tag%3Ajazz&source=deezer', G());
    const call = src.calls[src.calls.length - 1];
    assert.deepEqual(call?.fields, { artist: [], title: [], extra: ['jazz'] });
  });

  test('SSR 全链：search-suggest 片段本地组同走 buildWhere（cookie 登录 → 分字段命中）', async () => {
    const res = await app.request('/fragment/search-suggest?q=artist%3ATrain', { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Nighttrain/, '本地组命中 r4（artist 字段）');
    assert.doesNotMatch(html, /Blue Train/, 'r3 的 Train 在 title → 不应出现');
  });
});
