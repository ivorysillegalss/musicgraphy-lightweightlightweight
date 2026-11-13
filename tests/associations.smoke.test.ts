// B1 联想域冒烟（P1-5，评审案 docs/associations-review.md §7）：
// 三命中（同期/同天/同 Tag）+ 最强关系去重（Q5）+ 类内序 + limit 截断 + 空态 + 404 + 详情页渲染解锁。
// fixture 日期经 new Date(本地分量) 构造（strftime 'localtime' 锚，任意时区下断言均成立）。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { DAO, NotFoundError } from '../src/server/db/dao';
import type { AssociationItem } from '../src/server/db/associations';
import { renderAlbumDetail } from '../src/server/pages/album';

let dir: string;
let db: Db;
let dao: DAO;
const ids: Record<string, string> = {};

/** 本地日历意图 → ISO（new Date(y, mo-1, d, h) 为本地语义，toISO 后经 strftime localtime 折回仍为该日） */
const isoLocal = (y: number, mo: number, d: number, h = 12): string => new Date(y, mo - 1, d, h).toISOString();

const add = (title: string, artist: string, addedAt?: string, tags?: string[]): void => {
  const { id: albumId } = dao.upsertAlbum({ source: 'musicbrainz', source_id: `assoc-${title}`, title, artist, release_year: 2000, genres: ['Ambient'] });
  const { id } = dao.createRecord(addedAt === undefined ? { album_id: albumId } : { album_id: albumId, added_at: addedAt });
  if (tags !== undefined) dao.setTags(id, tags);
  ids[title] = id;
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'mg-assoc-'));
  db = openDatabase(join(dir, 'test.db'));
  runMigrations(db, 'db/migrations');
  dao = new DAO(db);

  add('锚点专辑', 'Anchor Artist', isoLocal(2026, 6, 15), ['夜晚', '爵士']); // 锚：2026-06 本地
  add('Tag Peak', 'Twin Artist', isoLocal(2026, 1, 10), ['夜晚', '爵士']); // 共享 2 标签（折叠为 1 行）+ 非锚月 + 非锚天 → 纯 same_tag
  add('Day Same Year', 'Fresh Artist', isoLocal(2026, 6, 15, 9)); // 当年同天（Q3：不排除当年）+ 同月 → 双命中，留最强 same_day
  add('Day Echo 1999', 'Retro Artist', isoLocal(1999, 6, 15)); // 跨年同天（同 MM-DD，1999-06 ≠ 2026-06 非同期）→ 纯 same_day
  add('Period Pal', 'Month Artist', isoLocal(2026, 6, 20)); // 同月不同天、无 tag → 纯 same_period
  add('Lonely One', 'Isle Artist', isoLocal(2025, 3, 8)); // 无同期/同天/同 Tag → 空态
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('getAssociations（P1-5 联想域）', () => {
  test('三命中 + 强度全序（tag→day→period）+ 类内序 added_at DESC', () => {
    const items = dao.getAssociations(ids['锚点专辑'] ?? '');
    assert.deepEqual(
      items.map((x) => [x.album.title, x.relation]),
      [
        ['Tag Peak', 'same_tag'],
        ['Day Same Year', 'same_day'],
        ['Day Echo 1999', 'same_day'],
        ['Period Pal', 'same_period']
      ]
    );
  });

  test('同一记录多命中只留最强（Q5：same_day 压过 same_period）', () => {
    const items = dao.getAssociations(ids['锚点专辑'] ?? '');
    const dup = items.filter((x) => x.album.title === 'Day Same Year');
    assert.equal(dup.length, 1);
    assert.equal(dup[0]?.relation, 'same_day');
  });

  test('同 Tag 命中带 matched_tag（多标签 GROUP BY 折叠，MIN 取字典序）；其余 relation matched_tag=null', () => {
    const items = dao.getAssociations(ids['锚点专辑'] ?? '');
    const tagHit = items.find((x) => x.album.title === 'Tag Peak');
    assert.equal(tagHit?.matched_tag, '夜晚'); // 共享 夜晚+爵士 → 一行，matched_tag=MIN='夜晚'
    const dayHit = items.find((x) => x.album.title === 'Day Echo 1999');
    assert.equal(dayHit?.matched_tag, null);
  });

  test('limit 截断（18 默认；limit=3 按强度序取前 3）', () => {
    assert.equal(dao.getAssociations(ids['锚点专辑'] ?? '').length, 4);
    const cut = dao.getAssociations(ids['锚点专辑'] ?? '', 3);
    assert.deepEqual(
      cut.map((x) => x.relation),
      ['same_tag', 'same_day', 'same_day']
    );
  });

  test('空态：无同期/同天/同 Tag → 空数组（API 侧 200 {data:[]}）', () => {
    assert.deepEqual(dao.getAssociations(ids['Lonely One'] ?? ''), []);
  });

  test('锚不存在 → NotFoundError（onError 映射 404 record_not_found）', () => {
    assert.throws(() => dao.getAssociations('no-such-id'), NotFoundError);
  });

  test('详情页渲染解锁：三组组题可见（确定性语义，禁「猜你喜欢」）', () => {
    const detail = dao.getRecord(ids['锚点专辑'] ?? '');
    const items: AssociationItem[] = dao.getAssociations(detail.id);
    const page = String(renderAlbumDetail(detail, null, { title: 't' }, items));
    assert.ok(page.includes('ASSOCIATIONS · 线索回响'));
    assert.ok(page.includes('同期收藏 · 2026 年 06 月'));
    assert.ok(page.includes('同一天 · 06-15'));
    assert.ok(page.includes('共享 Tag'));
    assert.ok(!page.includes('猜你喜欢'));
  });

  test('空联想/未接线 → 联想区不渲染（馈赠静默语义）', () => {
    const detail = dao.getRecord(ids['锚点专辑'] ?? '');
    const bare = String(renderAlbumDetail(detail, null, { title: 't' }));
    const empty = String(renderAlbumDetail(detail, null, { title: 't' }, []));
    assert.ok(!bare.includes('ASSOCIATIONS'));
    assert.ok(!empty.includes('ASSOCIATIONS'));
  });
});
