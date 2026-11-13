// SQL 常量（自 dao.ts 拆出，保持 DAO <200 行护栏，PM §7.1）

export const LIST_COLS =
  'r.id, r.added_at, r.listened_at, r.listened_precision, r.note, r.is_favorite, r.cover_color, ' +
  'm.id AS album_id, m.source, m.title, m.artist, m.release_year, m.cover_url, m.cover_local, m.genres';

export const DETAIL_COLS =
  LIST_COLS + ', r.user_id, r.updated_at, m.source_id, m.country, m.created_at AS album_created_at, m.updated_at AS album_updated_at';

export const SQL_DETAIL = `SELECT ${DETAIL_COLS} FROM collection_record r JOIN album_metadata m ON m.id = r.album_id WHERE r.id = ? AND r.user_id = ?`;

export const SQL_RECORD_TAGS =
  'SELECT t.name FROM record_tag rt JOIN tags t ON t.id = rt.tag_id WHERE rt.record_id = ? ORDER BY t.name';

// 那年今日（P1-1，确定性时间锚）：本地时区 + 周年边界已修（复审注）
export const SQL_ECHO =
  `SELECT ${LIST_COLS} FROM collection_record r JOIN album_metadata m ON m.id = r.album_id ` +
  `WHERE r.user_id = ? AND strftime('%m-%d', r.added_at, 'localtime') = strftime('%m-%d', 'now', 'localtime') ` +
  `AND date(r.added_at) <= date('now', 'localtime', '-1 year') ORDER BY r.added_at DESC LIMIT ?`;

// 全量导出投影（P1-3 §5.4，永久免费）：album 公共字段 + record 个人字段。全表读 =
// 内存纪律①（LIMIT≤60）的唯一豁免（拆分方案 §8 B2）；tags[] 全量经 SQL_EXPORT_TAGS
// 一次取回后按 record_id 归组（免逐记录 N+1），与 getRecord 的 SQL_RECORD_TAGS 同序（t.name）
export const SQL_EXPORT =
  `SELECT r.id AS record_id, m.title, m.artist, m.release_year, m.cover_url, m.genres, ` +
  'r.added_at, r.listened_at, r.listened_precision, r.is_favorite, r.cover_color, r.note ' +
  'FROM collection_record r JOIN album_metadata m ON m.id = r.album_id WHERE r.user_id = ? ORDER BY r.added_at, r.id';

export const SQL_EXPORT_TAGS =
  'SELECT rt.record_id, t.name FROM record_tag rt JOIN tags t ON t.id = rt.tag_id ' +
  'JOIN collection_record r ON r.id = rt.record_id WHERE r.user_id = ? ORDER BY rt.record_id, t.name';

// 轴排除式 facet 计数（FR-2 / 复审注：genre 轴经 json_each，不可索引，预期 <10ms——W0 spike 实测 4ms）
export const AXIS_SQL: Record<string, (w: string) => string> = {
  genre: (w) =>
    `SELECT je.value AS value, COUNT(*) AS count FROM collection_record r JOIN album_metadata m ON m.id = r.album_id, json_each(m.genres) je WHERE ${w} GROUP BY je.value ORDER BY count DESC`,
  year: (w) =>
    `SELECT m.release_year AS value, COUNT(*) AS count FROM collection_record r JOIN album_metadata m ON m.id = r.album_id WHERE ${w} GROUP BY m.release_year ORDER BY m.release_year DESC`,
  listened: (w) =>
    `SELECT substr(r.listened_at, 1, 4) AS value, COUNT(*) AS count FROM collection_record r JOIN album_metadata m ON m.id = r.album_id WHERE ${w} GROUP BY substr(r.listened_at, 1, 4) ORDER BY value DESC`,
  favorite: (w) =>
    `SELECT r.is_favorite AS value, COUNT(*) AS count FROM collection_record r JOIN album_metadata m ON m.id = r.album_id WHERE ${w} GROUP BY r.is_favorite ORDER BY value DESC`,
  color: (w) =>
    `SELECT r.cover_color AS value, COUNT(*) AS count FROM collection_record r JOIN album_metadata m ON m.id = r.album_id WHERE ${w} GROUP BY r.cover_color ORDER BY count DESC`,
  tag: (w) =>
    `SELECT t.name AS value, COUNT(*) AS count FROM record_tag rt JOIN tags t ON t.id = rt.tag_id JOIN collection_record r ON r.id = rt.record_id JOIN album_metadata m ON m.id = r.album_id WHERE ${w} GROUP BY t.name ORDER BY count DESC LIMIT 50`
};

// P1-5 联想（docs/associations-review.md §2，口径 = 02 §3⑤ + gap 报告）：锚点不存在 → NotFoundError。
// 同 Tag 走 record_tag PK 前缀点查 + idx_record_tag_tag（评审 R9）；同天/同期 strftime 月函数不可索引
// → 全表扫描规模=记录数（5000 行 <5ms 实测先例，评审案 §5 可接受；范围扫描改写登记为未来优化 R5）。
// 同期/同天同取 'localtime'（R2：本地日历口径一处）；当年同天也命中（Q3：联想 ≠ 那年今日，无周年条件）
export const SQL_ASSOC_ANCHOR = 'SELECT added_at FROM collection_record WHERE id = ? AND user_id = ?';

export const SQL_ASSOC_TAG =
  `SELECT ${LIST_COLS}, MIN(t.name) AS matched_tag ` +
  'FROM collection_record r JOIN album_metadata m ON m.id = r.album_id ' +
  'JOIN record_tag a_rt ON a_rt.record_id = r.id JOIN tags t ON t.id = a_rt.tag_id ' +
  'WHERE r.user_id = ? AND r.id <> ? AND a_rt.tag_id IN (SELECT tag_id FROM record_tag WHERE record_id = ?) ' +
  'GROUP BY r.id ORDER BY r.added_at DESC, r.id DESC LIMIT ?';

export const SQL_ASSOC_DAY =
  `SELECT ${LIST_COLS}, NULL AS matched_tag ` +
  'FROM collection_record r JOIN album_metadata m ON m.id = r.album_id ' +
  "WHERE r.user_id = ? AND r.id <> ? AND strftime('%m-%d', r.added_at, 'localtime') = strftime('%m-%d', ?, 'localtime') " +
  'ORDER BY r.added_at DESC, r.id DESC LIMIT ?';

export const SQL_ASSOC_PERIOD =
  `SELECT ${LIST_COLS}, NULL AS matched_tag ` +
  'FROM collection_record r JOIN album_metadata m ON m.id = r.album_id ' +
  "WHERE r.user_id = ? AND r.id <> ? AND strftime('%Y-%m', r.added_at, 'localtime') = strftime('%Y-%m', ?, 'localtime') " +
  'ORDER BY r.added_at DESC, r.id DESC LIMIT ?';

// 仪表总览四计数（自 dao.ts stats() 外拆，2026-11-14 B1 案 B 变体配套——IM-10a 先例同款机械搬移，零行为变更）
export const SQL_STATS =
  'SELECT (SELECT COUNT(*) FROM collection_record) AS records, (SELECT COUNT(*) FROM collection_record WHERE is_favorite = 1) AS favorites, (SELECT COUNT(*) FROM tags) AS tags, (SELECT COUNT(DISTINCT artist) FROM album_metadata) AS artists';

// 线索覆盖率（PRD §6 北极星，B3 观察池仪表域）：根线索 = note 非空串 / 听期 listened_at 非空 / 任一 tag。
// tag 用 EXISTS 免 join 复制行（record_tag 多对一会虚增 covered）；note 空串不计——writes 不归一空串（`note ?? null`），防御性排除
export const SQL_COVERAGE =
  'SELECT (SELECT COUNT(*) FROM collection_record WHERE user_id = ?) AS total, ' +
  "(SELECT COUNT(*) FROM collection_record r WHERE r.user_id = ? AND ((r.note IS NOT NULL AND r.note <> '') OR r.listened_at IS NOT NULL " +
  'OR EXISTS (SELECT 1 FROM record_tag rt WHERE rt.record_id = r.id))) AS covered';

// Tag 轻治理候选（P1-6，评审案 docs/tag-governance-review.md §2）：全部 tag + 引用计数
// （LEFT JOIN 含 0 引用——setTags 删引用不删 tags 行）；idx_record_tag_tag 点查驱动；refs DESC = 合并推荐方向的数据基础
export const SQL_TAG_GOV =
  'SELECT t.id, t.name, t.normalized_name, COUNT(rt.record_id) AS refs ' +
  'FROM tags t LEFT JOIN record_tag rt ON rt.tag_id = t.id ' +
  'WHERE t.user_id = ? GROUP BY t.id ORDER BY refs DESC, t.normalized_name LIMIT 500';

// 命名视图创建密度（P1-10 → PRD §6 named_view_rate「周人均新建数」）：总数 + 首建时间（存活周数分母）
export const SQL_NAMED_VIEW =
  'SELECT COUNT(*) AS cnt, MIN(created_at) AS first_at FROM saved_views WHERE user_id = ?';
