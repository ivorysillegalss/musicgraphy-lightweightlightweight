// S2-2 搜索分字段定向（方案 b）——解析器纯函数 + buildWhere 接线（零 boot，纯单元）
// 语法规范与评审案 = ../Musicgraphy-2.0-文档包/05-系统架构设计/评审案-搜索分字段定向.md
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseFieldQuery } from '../src/server/db/search-parse';
import { buildWhere, escapeLike } from '../src/server/db/sql';

describe('parseFieldQuery 解析器（S2-2 方案 b）', () => {
  test('整串无前缀 = 单段 bare + fielded=false（向后兼容现状）', () => {
    const p = parseFieldQuery('blue train');
    assert.deepEqual(p, { bare: ['blue train'], artist: [], title: [], tag: [], note: [], fielded: false });
  });

  test('空串 = 全空结构', () => {
    assert.deepEqual(parseFieldQuery(''), { bare: [], artist: [], title: [], tag: [], note: [], fielded: false });
    assert.deepEqual(parseFieldQuery('   '), { bare: [], artist: [], title: [], tag: [], note: [], fielded: false });
  });

  test('单一前缀：值 = 到串尾；前缀文本不混入值', () => {
    const p = parseFieldQuery('artist:キリンジ');
    assert.deepEqual(p, { bare: [], artist: ['キリンジ'], title: [], tag: [], note: [], fielded: true });
  });

  test('多前缀 AND 组合；无引号值延伸到下一个已识别前缀记号', () => {
    const p = parseFieldQuery('artist:キリンジ title:三');
    assert.equal(p.fielded, true);
    assert.deepEqual(p.artist, ['キリンジ']);
    assert.deepEqual(p.title, ['三']);
    assert.deepEqual(p.bare, []);
  });

  test('无引号值含空格（延伸语义）：artist:Jordan Rakei title:x → artist="Jordan Rakei"', () => {
    const p = parseFieldQuery('artist:Jordan Rakei title:x');
    assert.deepEqual(p.artist, ['Jordan Rakei']);
    assert.deepEqual(p.title, ['x']);
  });

  test('引号值含空格：artist:"Jordan Rakei"', () => {
    const p = parseFieldQuery('artist:"Jordan Rakei"');
    assert.deepEqual(p.artist, ['Jordan Rakei']);
    assert.deepEqual(p.bare, []);
  });

  test('引号值内前缀记号不识别（字面量保留）', () => {
    const p = parseFieldQuery('artist:"foo title:bar"');
    assert.deepEqual(p.artist, ['foo title:bar']);
    assert.deepEqual(p.title, []);
  });

  test('未闭合引号 = 值取到串尾', () => {
    const p = parseFieldQuery('artist:"Jordan Rakei');
    assert.deepEqual(p.artist, ['Jordan Rakei']);
  });

  test('前缀之间的文本归 bare；末前缀无引号值贪尾（值 = 到下一记号或串尾）', () => {
    const p = parseFieldQuery('white album artist:キリンジ jazz');
    assert.deepEqual(p.bare, ['white album']);
    assert.deepEqual(p.artist, ['キリンジ jazz'], '无引号值延伸到串尾（含 jazz）——裸文本须置于前缀之前或用引号');
    const p3 = parseFieldQuery('jazz artist:キリンジ');
    assert.deepEqual(p3.bare, ['jazz']);
    assert.deepEqual(p3.artist, ['キリンジ']);
  });

  test('未知前缀 = 字面量参与盲搜（bare）', () => {
    const p = parseFieldQuery('foo:bar');
    assert.deepEqual(p.bare, ['foo:bar']);
    assert.equal(p.fielded, false);
  });

  test('未知前缀与已知前缀混排：未知段入 bare，已知段分字段', () => {
    const p = parseFieldQuery('foo:bar artist:x');
    assert.deepEqual(p.bare, ['foo:bar']);
    assert.deepEqual(p.artist, ['x']);
    assert.equal(p.fielded, true);
  });

  test('空值前缀忽略（artist: 单独出现 → 无条件可生成）', () => {
    const p = parseFieldQuery('artist:');
    assert.deepEqual(p, { bare: [], artist: [], title: [], tag: [], note: [], fielded: true });
    const p2 = parseFieldQuery('artist: title:foo');
    assert.deepEqual(p2.artist, []);
    assert.deepEqual(p2.title, ['foo']);
  });

  test('前缀名大小写不敏感', () => {
    const p = parseFieldQuery('Artist:Rakei TITLE:x Tag:soul');
    assert.deepEqual(p.artist, ['Rakei']);
    assert.deepEqual(p.title, ['x']);
    assert.deepEqual(p.tag, ['soul']);
  });

  test('同字段多次出现 = 多值（各一条件 AND）', () => {
    const p = parseFieldQuery('artist:a artist:b');
    assert.deepEqual(p.artist, ['a', 'b']);
  });

  test('tag:/note: 归各字段数组', () => {
    const p = parseFieldQuery('tag:jazz note:深夜 title:三');
    assert.deepEqual(p.tag, ['jazz']);
    assert.deepEqual(p.note, ['深夜']);
    assert.deepEqual(p.title, ['三']);
  });

  test('记号须以空白/串首为界：artists:x 不识别前缀；引号后无空白紧邻记号按字面量', () => {
    const p = parseFieldQuery('artists:x');
    assert.deepEqual(p.bare, ['artists:x']);
    assert.equal(p.fielded, false);
    const p2 = parseFieldQuery('artist:"x"title:y');
    assert.deepEqual(p2.artist, ['x']);
    assert.deepEqual(p2.bare, ['title:y'], '无空白紧邻 = 字面量（记号以空白分隔）');
  });

  test('解析层不转义：%/\\ 原文保留（escapeLike 由消费方施加）', () => {
    const p = parseFieldQuery('artist:a%b_c\\d');
    assert.deepEqual(p.artist, ['a%b_c\\d']);
    assert.equal(escapeLike('a%b_c\\d'), 'a\\%b\\_c\\\\d');
  });
});

describe('buildWhere 分字段接线（本地 Collection）', () => {
  const uid = 'local';

  test('无前缀 q = 现状字节同形（四字段 OR 单条件 + 4 like 参数）', () => {
    const { where, params } = buildWhere({ q: 'blue train' }, uid);
    assert.equal(
      where,
      "r.user_id = ? AND (m.title LIKE ? ESCAPE '\\' OR m.artist LIKE ? ESCAPE '\\' OR r.note LIKE ? ESCAPE '\\' " +
        "OR EXISTS (SELECT 1 FROM record_tag rt2 JOIN tags t2 ON t2.id = rt2.tag_id WHERE rt2.record_id = r.id AND t2.name LIKE ? ESCAPE '\\'))"
    );
    assert.deepEqual(params, [uid, '%blue train%', '%blue train%', '%blue train%', '%blue train%']);
  });

  test('artist: → 仅 m.artist 条件', () => {
    const { where, params } = buildWhere({ q: 'artist:coltrane' }, uid);
    assert.equal(where, "r.user_id = ? AND m.artist LIKE ? ESCAPE '\\'");
    assert.deepEqual(params, [uid, '%coltrane%']);
  });

  test('title: → 仅 m.title 条件；tag: → EXISTS tags；note: → r.note', () => {
    const t = buildWhere({ q: 'title:blue' }, uid);
    assert.equal(t.where, "r.user_id = ? AND m.title LIKE ? ESCAPE '\\'");
    assert.deepEqual(t.params, [uid, '%blue%']);
    const g = buildWhere({ q: 'tag:jazz' }, uid);
    assert.match(g.where, /EXISTS \(SELECT 1 FROM record_tag rt2 JOIN tags t2/);
    assert.match(g.where, /t2\.name LIKE \? ESCAPE '\\'/);
    assert.deepEqual(g.params, [uid, '%jazz%']);
    const n = buildWhere({ q: 'note:深夜' }, uid);
    assert.equal(n.where, "r.user_id = ? AND r.note LIKE ? ESCAPE '\\'");
    assert.deepEqual(n.params, [uid, '%深夜%']);
  });

  test('多前缀 AND：artist:x title:y → 两条件 AND；参数顺序随条件', () => {
    const { where, params } = buildWhere({ q: 'artist:x title:y' }, uid);
    assert.equal(where, "r.user_id = ? AND m.artist LIKE ? ESCAPE '\\' AND m.title LIKE ? ESCAPE '\\'");
    assert.deepEqual(params, [uid, '%x%', '%y%']);
  });

  test('bare 段与前缀段共存：每 bare 段四字段 OR，段间 AND', () => {
    const { where, params } = buildWhere({ q: 'white artist:x' }, uid);
    const blind = "(m.title LIKE ? ESCAPE '\\' OR m.artist LIKE ? ESCAPE '\\' OR r.note LIKE ? ESCAPE '\\' " +
      "OR EXISTS (SELECT 1 FROM record_tag rt2 JOIN tags t2 ON t2.id = rt2.tag_id WHERE rt2.record_id = r.id AND t2.name LIKE ? ESCAPE '\\'))";
    assert.equal(where, `r.user_id = ? AND ${blind} AND m.artist LIKE ? ESCAPE '\\'`);
    assert.deepEqual(params, [uid, '%white%', '%white%', '%white%', '%white%', '%x%']);
  });

  test('LIKE 转义沿用 escapeLike：%_\\ 值安全', () => {
    const { params } = buildWhere({ q: 'artist:a%b_c\\d' }, uid);
    assert.deepEqual(params, [uid, '%a\\%b\\_c\\\\d%']);
  });

  test('空值前缀 → 无 q 条件（等于未筛选；user_id 条件恒在）', () => {
    const { where, params } = buildWhere({ q: 'artist:' }, uid);
    assert.equal(where, 'r.user_id = ?');
    assert.deepEqual(params, [uid]);
  });

  test('与其他轴筛选叠加：genre + artist:', () => {
    const { where, params } = buildWhere({ genre: 'Jazz', q: 'artist:x' }, uid);
    assert.match(where, /r\.user_id = \? AND EXISTS/);
    assert.match(where, /AND m\.artist LIKE \? ESCAPE '\\'/);
    assert.deepEqual(params, [uid, 'Jazz', '%x%']);
  });

  test('未出现 q 时零 q 条件（现状回归）', () => {
    const { where, params } = buildWhere({ favorite: true }, uid);
    assert.equal(where, 'r.user_id = ? AND r.is_favorite = 1');
    assert.deepEqual(params, [uid]);
  });
});
