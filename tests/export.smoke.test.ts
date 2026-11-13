// 导出域冒烟（P1-3 永久免费红线，02 §5.4 + §4 export 行 + 评审 R6）：
// 空档案合法 · JSON §5.4 形状 + 全量条数=种子数 · CSV 行数对齐 + BOM 字节校验（e2e 教训：
// response.text() 剥 BOM，必须字节级比较）· RFC4180 转义 · with_covers zip 结构 · format 白名单
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Hono } from 'hono';
import { createApp } from '../src/server/app';
import { loadConfig, type Config } from '../src/server/config';
import { DAO } from '../src/server/db/dao';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';

const SEED = 5;

describe('导出域（P1-3，ADR-007）', () => {
  let dir: string;
  let db: Db;
  let dao: DAO;
  let cfg: Config;
  let app: Hono;
  let covers: string;
  let G: RequestInit;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-export-'));
    covers = join(dir, 'covers');
    mkdirSync(covers);
    db = openDatabase(join(dir, 't.db'));
    runMigrations(db, 'db/migrations');
    dao = new DAO(db);
    cfg = loadConfig();
    app = createApp(dao, cfg, [], { cover: { coversDir: covers } });
    G = { headers: { Authorization: `Bearer ${cfg.accessKey}` } };
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('空档案导出合法：JSON records=[] + version/exported_at；CSV 仅表头一行（含 BOM）', async () => {
    const j = await app.request('/api/v1/export?format=json', G);
    assert.equal(j.status, 200);
    assert.match(j.headers.get('Content-Disposition') ?? '', /^attachment; filename="musicgraphy-\d{8}\.json"$/);
    const payload = JSON.parse(await j.text()) as { version: string; exported_at: string; records: unknown[] };
    assert.equal(payload.version, '2.0');
    assert.ok(payload.exported_at.length > 0);
    assert.equal(payload.records.length, 0);

    const csv = await app.request('/api/v1/export?format=csv', G);
    assert.equal(csv.status, 200);
    const bytes = new Uint8Array(await csv.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM 必须字节级校验');
    const text = new TextDecoder().decode(bytes.slice(3));
    assert.match(text, /^title,artist,release_year/);
    assert.equal(text.split('\r\n').filter((l) => l !== '').length, 1);
  });

  test('种子落库（5 张：tags / favorite / note 含逗号引号 / listened 齐全）', () => {
    for (let i = 0; i < SEED; i++) {
      const { id: albumId } = dao.upsertAlbum({
        source: 'musicbrainz',
        source_id: `exp-${i}`,
        title: `Export ${i}`,
        artist: `Artist ${i % 2}`,
        release_year: 1990 + i,
        genres: ['Jazz', 'Fusion'],
        cover_url: `https://example.com/${i}.jpg`
      });
      const { id } = dao.createRecord({
        album_id: albumId,
        note: i === 0 ? '为什么留下它, "重听"' : null,
        listened_at: '2026-01-02T00:00:00Z',
        listened_precision: 'day'
      });
      dao.setTags(id, ['夜晚', `tag${i}`]);
      if (i % 2 === 0) dao.updateRecord(id, { is_favorite: true, cover_color: 3 });
    }
  });

  test('JSON：全量条数=种子数 + §5.4 原形字段 + tags 全量', async () => {
    const res = await app.request('/api/v1/export?format=json', G);
    assert.equal(res.status, 200);
    const payload = JSON.parse(await res.text()) as {
      version: string;
      records: Array<{
        album: Record<string, unknown>;
        record: Record<string, unknown>;
        tags: string[];
      }>;
    };
    assert.equal(payload.records.length, SEED);
    const [first] = payload.records;
    assert.ok(first);
    assert.deepEqual(Object.keys(first.album).sort(), ['artist', 'cover_url', 'genres', 'release_year', 'title']);
    assert.deepEqual(Object.keys(first.record).sort(), [
      'added_at',
      'cover_color',
      'is_favorite',
      'listened_at',
      'listened_precision',
      'note'
    ]);
    assert.equal(first.record.is_favorite, true);
    assert.equal(first.record.note, '为什么留下它, "重听"');
    assert.deepEqual(first.album.genres, ['Jazz', 'Fusion']);
    assert.ok(first.tags.includes('夜晚') && first.tags.includes('tag0'));
  });

  test('CSV：行数=种子数+表头；RFC4180 转义（note 逗号引号入引号字段）；genres/tags 用 | 连接', async () => {
    const res = await app.request('/api/v1/export?format=csv', G);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Disposition') ?? '', /\.csv"$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes.slice(3));
    const lines = text.split('\r\n').filter((l) => l !== '');
    assert.equal(lines.length, SEED + 1);
    const [header, row1] = lines;
    assert.ok(row1);
    assert.match(header ?? '', /^title,artist,release_year/);
    assert.ok(row1.includes('"为什么留下它, ""重听"""'), 'note 逗号/引号须引号字段转义');
    assert.ok(row1.includes('Jazz|Fusion') && row1.includes('tag0|夜晚'), 'tags 按 t.name 序 | 连接');
  });

  test('with_covers=1：zip（records.json + records.csv + covers/**）+ EOCD 条目数对齐', async () => {
    writeFileSync(join(covers, 'aaa.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
    writeFileSync(join(covers, 'bbb.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe1, 5, 6, 7, 8]));
    const res = await app.request('/api/v1/export?with_covers=1&format=csv', G);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'application/zip');
    assert.match(res.headers.get('Content-Disposition') ?? '', /\.zip"$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'zip 以 PK\x03\x04 起始');
    // EOCD 固定居尾 22 字节（comment len=0）布局：+8 本盘条目数 / +10 总条目数 / +12 CD 大小 / +16 CD 偏移
    const eocd = bytes.length - 22;
    assert.deepEqual([...bytes.slice(eocd, eocd + 4)], [0x50, 0x4b, 0x05, 0x06]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint16(eocd + 8, true), 4);
    assert.equal(view.getUint16(eocd + 10, true), 4);
    // 结构不变量：CD 偏移 + CD 大小 = EOCD 起点
    assert.equal(view.getUint32(eocd + 16, true) + view.getUint32(eocd + 12, true), eocd);
    const text = new TextDecoder().decode(bytes);
    assert.ok(text.includes('records.json') && text.includes('records.csv') && text.includes('covers/aaa.jpg'));
  });

  test('format 白名单：非法值 → 400 invalid_format envelope', async () => {
    const res = await app.request('/api/v1/export?format=xml', G);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'invalid_format');
  });
});
