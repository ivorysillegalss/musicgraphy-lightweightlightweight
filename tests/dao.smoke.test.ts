// PM-02 测试骨架：六类核心查询冒烟（分页页 / 5 轴计数 / LIKE 检索 / 详情 / 联想 / 那年今日）
// + 写路径与错误语义（409 duplicate / 404 not_found / 400 cursor_invalid）
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { CursorInvalidError, DAO, DuplicateRecordError, NotFoundError } from '../src/server/db/dao';

let dir: string;
let db: Db;
let dao: DAO;
const recordIds: Record<string, { id: string; albumId: string }> = {};

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'mg-test-'));
  db = openDatabase(join(dir, 'test.db'));
  runMigrations(db, 'db/migrations');
  dao = new DAO(db);

  const core: Array<[string, string, number, string[], string | null]> = [
    ['Blue Train', 'John Coltrane', 1958, ['Jazz'], '通勤路上循环的蓝色列车'],
    ['Kind of Blue', 'Miles Davis', 1959, ['Jazz'], null],
    ['Selected Ambient Works 85-92', 'Aphex Twin', 1992, ['Electronic', 'Ambient'], '深夜 ambient'],
    ['OK Computer', 'Radiohead', 1997, ['Rock', 'Alternative'], null],
    ['Homework', 'Daft Punk', 2001, ['Electronic', 'House'], null],
    ['Demo Tape 自印', '本地乐队', 2020, [], '无元数据封面场景'],
    ['Random Access Memories', 'Daft Punk', 2013, ['Electronic'], null],
    ['Kid A', 'Radiohead', 2000, ['Rock', 'Electronic'], null]
  ];
  for (const [title, artist, year, genres, note] of core) {
    const { id: albumId } = dao.upsertAlbum({ source: 'musicbrainz', source_id: `t-${title}`, title, artist, release_year: year, genres });
    const { id } = dao.createRecord({ album_id: albumId, note });
    recordIds[title] = { id, albumId };
  }
  dao.setTags(recordIds['Blue Train']?.id ?? '', ['夜晚', '爵士']);
  dao.setTags(recordIds['Selected Ambient Works 85-92']?.id ?? '', ['夜晚', '氛围']);
  dao.setTags(recordIds['Homework']?.id ?? '', ['通勤', '电子']);
  dao.setTags(recordIds['Demo Tape 自印']?.id ?? '', ['自印']);
  dao.updateRecord(recordIds['Blue Train']?.id ?? '', { is_favorite: true });
  dao.updateRecord(recordIds['OK Computer']?.id ?? '', { is_favorite: true, cover_color: 3 });

  // 那年今日边界（复审注）：一周年当天命中 / 当日新增排除
  const now = new Date();
  const ann = new Date(Date.UTC(now.getFullYear() - 1, now.getMonth(), now.getDate(), 12, 0, 0));
  for (const [title, addedAt] of [
    ['Echo Anniversary', ann.toISOString()],
    ['Echo Recent', new Date().toISOString()]
  ] as Array<[string, string]>) {
    const { id: albumId } = dao.upsertAlbum({ source: 'musicbrainz', source_id: `t-${title}`, title, artist: 'Echo Artist', release_year: 2000, genres: ['Ambient'] });
    const { id } = dao.createRecord({ album_id: albumId, added_at: addedAt });
    recordIds[title] = { id, albumId };
  }

  // bulk 130 张（分页跨 3 页）
  for (let i = 0; i < 130; i++) {
    const { id: albumId } = dao.upsertAlbum({
      source: 'musicbrainz',
      source_id: `bulk-${i}`,
      title: `Bulk ${String(i).padStart(3, '0')}`,
      artist: `Artist ${i % 10}`,
      release_year: 1960 + (i % 60),
      genres: ['Bulk']
    });
    const { id } = dao.createRecord({ album_id: albumId });
    recordIds[`bulk-${i}`] = { id, albumId };
  }
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('DAO 六类核心查询（PM-02 冒烟）', () => {
  test('分页页：limit=60 走 cursor 翻完全库且单调', () => {
    let cursor: string | null = null;
    let total = 0;
    let pages = 0;
    do {
      const { items, meta } = dao.listPage({ cursor, limit: 60 });
      assert.ok(items.length > 0 && items.length <= 60);
      for (let i = 1; i < items.length; i++) {
        assert.ok((items[i - 1]?.added_at ?? '') >= (items[i]?.added_at ?? ''), 'added_at 应单调不增');
      }
      total += items.length;
      pages++;
      cursor = meta.next_cursor;
    } while (cursor !== null);
    assert.equal(total, 140); // 8 core + 2 echo + 130 bulk
    assert.ok(pages >= 3);
  });

  test('无效 cursor → CursorInvalidError（映射 400 cursor_invalid）', () => {
    assert.throws(() => dao.listPage({ cursor: '!!!not-base64url!!!' }), CursorInvalidError);
  });

  test('轴计数：favorite 总和=全量；轴排除式（genre 筛选不作用于 genre 轴自身）', () => {
    const counts = dao.countAxes('local');
    const favSum = (counts.favorite ?? []).reduce((a, f) => a + f.count, 0);
    assert.equal(favSum, 140);

    const jazz = dao.countAxes('local', { genre: 'Jazz' });
    const jazzTotal = (jazz.year ?? []).reduce((a, f) => a + f.count, 0);
    assert.equal(jazzTotal, 2); // Blue Train + Kind of Blue
    const genreAxisSum = (dao.countAxes('local', { genre: 'Jazz' }).genre ?? []).reduce((a, f) => a + f.count, 0);
    assert.ok(genreAxisSum > jazzTotal);
  });

  test('LIKE 检索：中文命中 + 通配符转义（评审 R10）', () => {
    const hit = dao.listPage({ filters: { q: '蓝色列车' }, limit: 10 });
    assert.equal(hit.items.length, 1);
    assert.equal(hit.items[0]?.album.title, 'Blue Train');
    const none = dao.listPage({ filters: { q: '%' }, limit: 10 });
    assert.equal(none.items.length, 0);
  });

  test('详情：元数据 + 个人区 + 标签组装', () => {
    const d = dao.getRecord(recordIds['Blue Train']?.id ?? '');
    assert.equal(d.album.artist, 'John Coltrane');
    assert.equal(d.album.release_year, 1958);
    assert.deepEqual(d.tags, ['夜晚', '爵士']);
    assert.equal(d.is_favorite, true);
    assert.equal(d.note, '通勤路上循环的蓝色列车');
  });

  test('联想：标签前缀补全（normalized 前缀 LIKE）', () => {
    assert.deepEqual(dao.suggestTags('local', '夜'), ['夜晚']);
    assert.deepEqual(dao.suggestTags('local', '自'), ['自印']);
    assert.deepEqual(dao.suggestTags('local', 'zzz'), []);
  });

  test('那年今日：恰好一周年当天命中（边界），当日新增排除（复审注）', () => {
    const titles = dao.echoToday('local', 50).map((e) => e.album.title);
    assert.ok(titles.includes('Echo Anniversary'));
    assert.ok(!titles.includes('Echo Recent'));
  });

  test('重复落库 → DuplicateRecordError 携带已有 record_id（409 语义）', () => {
    assert.throws(
      () => dao.createRecord({ album_id: recordIds['Blue Train']?.albumId ?? '' }),
      (e: unknown) => e instanceof DuplicateRecordError && e.recordId === (recordIds['Blue Train']?.id ?? '')
    );
  });

  test('不存在 → NotFoundError（404 语义）', () => {
    assert.throws(() => dao.getRecord('no-such-id'), NotFoundError);
    assert.throws(() => dao.updateRecord('no-such-id', { note: 'x' }), NotFoundError);
  });

  test('更新 + 标签整组替换落库', () => {
    const id = recordIds['Kind of Blue']?.id ?? '';
    dao.updateRecord(id, { note: 'modal jazz 起点', listened_at: '1959-01-01T00:00:00Z', listened_precision: 'year' });
    dao.setTags(id, ['爵士', '深夜', '爵士']); // 重复项去重
    const d = dao.getRecord(id);
    assert.equal(d.note, 'modal jazz 起点');
    assert.equal(d.listened_precision, 'year');
    assert.deepEqual(d.tags, ['深夜', '爵士']); // ORDER BY name
  });
});
