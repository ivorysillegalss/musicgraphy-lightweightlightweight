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
