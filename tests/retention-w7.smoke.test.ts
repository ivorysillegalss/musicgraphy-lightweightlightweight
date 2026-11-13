// W7 批留存冒烟（P1-1 回响卡片 + P1-2 记忆条；PM §4 W7 表）：
// P1-1 四约束核对（无推送/单入口/单卡片/确定性锚）+ 渲染解锁（有则显示、无则不显示、点击进详情 ≤1 步）
// P1-2 双区分区（外部元数据 / 个人记录）+ 记忆条一行式第一人称重组（零新数据纯视图重组）
// fixture 日期经 new Date(本地分量) 构造（SQL_ECHO strftime 'localtime' 锚，任意时区下断言均成立——associations 先例）。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { DAO } from '../src/server/db/dao';
import { renderCollection, EMPTY_FILTER } from '../src/server/pages/collection';
import { renderAlbumDetail } from '../src/server/pages/album';

let dir: string;
let db: Db;
let dao: DAO;
const ids: Record<string, string> = {};

/** 本地日历意图 → ISO（new Date(y, mo-1, d, h) 为本地语义，toISO 后经 strftime localtime 折回仍为该日） */
const isoLocal = (y: number, mo: number, d: number, h = 12): string => new Date(y, mo - 1, d, h).toISOString();

const add = (title: string, artist: string, addedAt?: string, tags?: string[], note?: string, listened?: { at: string; precision: 'day' | 'year' }): void => {
  const { id: albumId } = dao.upsertAlbum({ source: 'musicbrainz', source_id: `w7-${title}`, title, artist, release_year: 2010, genres: ['Electronic'] });
  const { id } = dao.createRecord(
    addedAt === undefined
      ? { album_id: albumId }
      : { album_id: albumId, added_at: addedAt, listened_at: listened?.at, listened_precision: listened?.precision, note }
  );
  if (tags !== undefined) dao.setTags(id, tags);
  ids[title] = id;
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'mg-w7-'));
  db = openDatabase(join(dir, 'test.db'));
  runMigrations(db, 'db/migrations');
  dao = new DAO(db);

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  // 周年锚（确定性：本地今天 MM-DD，恰好满 1 周年当天——SQL_ECHO `<= date('now','localtime','-1 year')` 含当天）
  add('Echo One', 'Anniversary', isoLocal(y - 2, m, d), ['夜晚'], '青旅的天台', { at: `${y - 2}-01-01T00:00:00Z`, precision: 'year' });
  // 同 MM-DD 更老的一条：锚序 added_at DESC 取最近周年（单卡片约束下只渲染一条）
  add('Echo Two', 'Older', isoLocal(y - 5, m, d), [], '更早的那一年');
  // 当年同 MM-DD（<1 周年）→ 不该回响（周年边界）
  add('Fresh Same Day', 'This Year', isoLocal(y, m, d));
  // 无周年普通记录
  add('Plain', 'Nobody', isoLocal(y - 3, 2, 2));
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('P1-1 回响卡片（echo/today · 四约束）', () => {
  test('确定性锚：周年边界（恰好满 1 周年当天命中；当年同天不命中；非今天不命中）', () => {
    const hits = dao.echoToday('local', 10).map((x) => x.album.title);
    assert.ok(hits.includes('Echo One'));
    assert.ok(hits.includes('Echo Two'));
    assert.ok(!hits.includes('Fresh Same Day')); // <1 周年排除
    assert.ok(!hits.includes('Plain')); // MM-DD 不同
  });

  test('单卡片约束：echoToday(limit=1) 只取锚序最近一条 → 渲染恰一张 .echo-card', () => {
    const echo = dao.echoToday('local', 1)[0] ?? null;
    assert.equal(echo?.album.title, 'Echo One'); // added_at DESC → 最近周年优先
    const page = String(
      renderCollection(
        { flash: null, dupHref: null, echo, filter: EMPTY_FILTER, counts: null, items: [], meta: { has_next: false, next_cursor: null }, total: 0, candidates: null, notice: null, topTags: [], error: null },
        { title: 't' }
      )
    );
    assert.equal((page.match(/class="echo-card"/g) ?? []).length, 1); // 单卡片（PRD P1-1）
    assert.ok(page.includes('ON THIS DAY · 一年前的今天'));
    assert.ok(page.includes('《Echo One》'));
  });

  test('单入口 + ≤1 步：卡片是 <a> 直达详情页（无推送——渲染期一次性查询，无定时/通知机制）', () => {
    const echo = dao.echoToday('local', 1)[0] ?? null;
    const page = String(
      renderCollection(
        { flash: null, dupHref: null, echo, filter: EMPTY_FILTER, counts: null, items: [], meta: { has_next: false, next_cursor: null }, total: 0, candidates: null, notice: null, topTags: [], error: null },
        { title: 't' }
      )
    );
    const m = /<a class="echo-card" href="\/album\/([0-9a-f-]{36})"/.exec(page);
    assert.notEqual(m, null);
    assert.equal(m?.[1], ids['Echo One']); // 点开即详情页，≤1 步
  });

  test('无则不显示：echo=null（无周年记录 / safeEcho 馈赠失败）→ 不渲染回响区', () => {
    const page = String(
      renderCollection(
        { flash: null, dupHref: null, echo: null, filter: EMPTY_FILTER, counts: null, items: [], meta: { has_next: false, next_cursor: null }, total: 0, candidates: null, notice: null, topTags: [], error: null },
        { title: 't' }
      )
    );
    assert.ok(!page.includes('echo-card'));
    assert.ok(!page.includes('一年前的今天'));
  });
});

describe('P1-2 详情页记忆条（零新数据纯视图重组）', () => {
  const render = (id: string): string => String(renderAlbumDetail(dao.getRecord(id), null, { title: 't' }));

  test('双区分区：外部元数据区 / 个人记录区（§4 数据二分的视觉执行）', () => {
    const page = render(ids['Echo One'] ?? '');
    assert.ok(page.includes('PUBLIC METADATA · 外部元数据'));
    assert.ok(page.includes('PERSONAL RECORD · 个人记录'));
    // 分区次序：外部元数据在前、个人记录在后（P1-5 联想版位在个人区之后）
    assert.ok(page.indexOf('PUBLIC METADATA') < page.indexOf('PERSONAL RECORD'));
  });

  test('记忆条一行式第一人称重组：记录月 / 听的时期 / Tags / 当时（PRD P1-2 示例形状）', () => {
    const page = render(ids['Echo One'] ?? '');
    assert.match(page, /\d{4} 年 \d{2} 月记录/); // "2023 年 8 月记录" 同形
    assert.ok(page.includes('听的时期：')); // listened_at 有值才出现
    assert.ok(page.includes('2024 年')); // precision=year → 年份粗粒度显示
    assert.ok(page.includes('Tags：夜晚'));
    assert.ok(page.includes('当时：'));
    assert.ok(page.includes('青旅的天台')); // note 原文（当时 = 全页唯一 Playfair Italic 落点）
  });

  test('个人区空态：无 note → 引导补线索文案（"先添加、稍后补"合法）；无听期不渲染听期段', () => {
    const page = render(ids['Plain'] ?? '');
    assert.ok(page.includes('还没有「当时」'));
    assert.ok(!page.includes('听的时期：'));
  });

  test('P1-5 版位衔接：ASSOCIATIONS 区在个人记录区之后（记忆条下方，B1 解锁的版位）', () => {
    const detail = dao.getRecord(ids['Echo One'] ?? '');
    dao.setTags(ids['Plain'] ?? '', ['夜晚']); // 制造一条同 Tag 联想
    const assoc = dao.getAssociations(detail.id, 18);
    assert.ok(assoc.length > 0);
    const page = String(renderAlbumDetail(detail, null, { title: 't' }, assoc));
    assert.ok(page.indexOf('PERSONAL RECORD') < page.indexOf('ASSOCIATIONS · 线索回响'));
  });
});
