import { randomUUID } from 'node:crypto';
import type { Db } from './connection';
import {
  buildWhere,
  decodeCursor,
  encodeCursor,
  escapeLike,
  normalizeTag,
  SORTS,
  StmtCache,
  type Cell,
  type Filters,
  type Row
} from './sql';
import {
  asBool,
  asNumN,
  asStr,
  asStrN,
  cell,
  mapAlbum,
  mapItem,
  parseGenres,
  type AlbumRow,
  type AxisCounts,
  type CollectionDetail,
  type CollectionItem,
  type FacetCount,
  type Stats
} from './types';

export class DuplicateRecordError extends Error {
  constructor(public readonly recordId: string) {
    super('duplicate_record');
  }
}
export class NotFoundError extends Error {
  constructor() {
    super('record_not_found');
  }
}
export class CursorInvalidError extends Error {
  constructor() {
    super('cursor_invalid');
  }
}

const nowIso = (): string => new Date().toISOString();

// 轴排除式 facet 计数（FR-2 / 复审 V2 注记：genre 轴经 json_each，不可索引，预期 <10ms）
const AXIS_SQL: Record<string, (w: string) => string> = {
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

const LIST_COLS =
  'r.id, r.added_at, r.listened_at, r.listened_precision, r.note, r.is_favorite, r.cover_color, ' +
  'm.id AS album_id, m.source, m.title, m.artist, m.release_year, m.cover_url, m.cover_local, m.genres';
const DETAIL_COLS =
  LIST_COLS + ', r.user_id, r.updated_at, m.source_id, m.country, m.created_at AS album_created_at, m.updated_at AS album_updated_at';
const SQL_DETAIL = `SELECT ${DETAIL_COLS} FROM collection_record r JOIN album_metadata m ON m.id = r.album_id WHERE r.id = ? AND r.user_id = ?`;
const SQL_RECORD_TAGS = 'SELECT t.name FROM record_tag rt JOIN tags t ON t.id = rt.tag_id WHERE rt.record_id = ? ORDER BY t.name';
const SQL_ECHO =
  `SELECT ${LIST_COLS} FROM collection_record r JOIN album_metadata m ON m.id = r.album_id ` +
  `WHERE r.user_id = ? AND strftime('%m-%d', r.added_at, 'localtime') = strftime('%m-%d', 'now', 'localtime') ` +
  `AND date(r.added_at) <= date('now', 'localtime', '-1 year') ORDER BY r.added_at DESC LIMIT ?`;

export class DAO {
  private st: StmtCache;
  constructor(private db: Db) {
    this.st = new StmtCache(db);
  }

  /** 网格分页（FR-2）：cursor = [sort_value, id] 复合键 + row-value 比较（复审 V11），limit 上限 60（ADR-005 纪律①） */
  listPage(
    opts: { userId?: string; sort?: string; cursor?: string | null; limit?: number; filters?: Filters } = {}
  ): { items: CollectionItem[]; meta: { has_next: boolean; next_cursor: string | null } } {
    const userId = opts.userId ?? 'local';
    const sort = SORTS[opts.sort ?? 'added'];
    if (!sort) throw new CursorInvalidError();
    const limit = Math.min(Math.max(opts.limit ?? 60, 1), 60);
    const { where, params } = buildWhere(opts.filters ?? {}, userId);
    const dir = sort.desc ? 'DESC' : 'ASC';
    let cursorCond = '';
    const curParams: Cell[] = [];
    if (opts.cursor) {
      const cur = decodeCursor(opts.cursor);
      if (!cur) throw new CursorInvalidError();
      cursorCond = ` AND (${sort.expr}, r.id) ${sort.desc ? '<' : '>'} (?, ?)`;
      curParams.push(cur[0], cur[1]);
    }
    const sql =
      `SELECT ${LIST_COLS} FROM collection_record r JOIN album_metadata m ON m.id = r.album_id ` +
      `WHERE ${where}${cursorCond} ORDER BY ${sort.expr} ${dir}, r.id ${dir} LIMIT ${limit + 1}`;
    const rows = this.st.get(sql).all(...params, ...curParams) as Row[];
    const has_next = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    // cursor 值取自行内原始列（sort key 均为 string|number，无 bigint/blob）
    const next_cursor = has_next && last ? encodeCursor(cell(last, sort.key) as string | number | null, asStr(cell(last, 'id'), 'id')) : null;
    return { items: page.map(mapItem), meta: { has_next, next_cursor } };
  }

  /** 各轴实时计数（FR-2 联动收敛）：每轴剔除自身筛选 */
  countAxes(userId = 'local', filters: Filters = {}, axes?: string[]): AxisCounts {
    const out: AxisCounts = {};
    const list = axes ?? ['genre', 'year', 'listened', 'favorite', 'tag', 'color'];
    for (const axis of list) {
      const builder = AXIS_SQL[axis];
      if (!builder) throw new Error(`unknown axis: ${axis}`);
      const { where, params } = buildWhere(filters, userId, axis as Parameters<typeof buildWhere>[2]);
      const rows = this.st.get(builder(where)).all(...params) as Row[];
      out[axis as keyof AxisCounts] = rows.map((r) => {
        const v = cell(r, 'value');
        const value: string | number | null = v === null ? null : typeof v === 'number' ? v : String(v);
        return { value, count: Number(cell(r, 'count') ?? 0) } satisfies FacetCount;
      });
    }
    return out;
  }

  /** 详情（P1-2）：元数据 + 个人区重组数据 + 标签 */
  getRecord(id: string, userId = 'local'): CollectionDetail {
    const row = this.st.get(SQL_DETAIL).get(id, userId) as Row | undefined;
    if (!row) throw new NotFoundError();
    const tagRows = this.st.get(SQL_RECORD_TAGS).all(id) as Row[];
    return {
      ...mapItem(row),
      user_id: asStr(cell(row, 'user_id'), 'user_id'),
      updated_at: asStr(cell(row, 'updated_at'), 'updated_at'),
      album: mapAlbum(row),
      tags: tagRows.map((t) => asStr(cell(t, 'name'), 'name'))
    };
  }

  /** 标签自动补全（FR-1）：前缀 LIKE 走 idx_tags_norm_prefix（评审 R9） */
  suggestTags(userId = 'local', prefix: string, limit = 10): string[] {
    const like = `${escapeLike(normalizeTag(prefix))}%`;
    const rows = this.st
      .get('SELECT name FROM tags WHERE user_id = ? AND normalized_name LIKE ? ESCAPE \'\\\' ORDER BY normalized_name LIMIT ' + Math.min(limit, 20))
      .all(userId, like) as Row[];
    return rows.map((r) => asStr(cell(r, 'name'), 'name'));
  }

  /** 那年今日（P1-1，确定性时间锚）：本地时区 + 周年边界已修（复审注） */
  echoToday(userId = 'local', limit = 10): CollectionItem[] {
    const rows = this.st.get(SQL_ECHO).all(userId, limit) as Row[];
    return rows.map(mapItem);
  }

  stats(): Stats {
    const row = this.st
      .get(
        'SELECT (SELECT COUNT(*) FROM collection_record) AS records, (SELECT COUNT(*) FROM collection_record WHERE is_favorite = 1) AS favorites, (SELECT COUNT(*) FROM tags) AS tags, (SELECT COUNT(DISTINCT artist) FROM album_metadata) AS artists'
      )
      .get() as Row | undefined;
    const r = row ?? {};
    return {
      records: Number(cell(r, 'records') ?? 0),
      favorites: Number(cell(r, 'favorites') ?? 0),
      tags: Number(cell(r, 'tags') ?? 0),
      artists: Number(cell(r, 'artists') ?? 0)
    };
  }

  /** 元数据落库：同 (source, source_id) 则更新外部快照字段——永不触碰用户数据（I2 / AGENTS §4） */
  upsertAlbum(input: {
    source: string;
    source_id: string;
    title: string;
    artist: string;
    release_year?: number | null;
    cover_url?: string | null;
    genres?: string[];
    country?: string | null;
  }): { id: string; existed: boolean } {
    const genresJson = input.genres && input.genres.length > 0 ? JSON.stringify(input.genres) : null;
    const existing = this.st.get('SELECT id FROM album_metadata WHERE source = ? AND source_id = ?').get(input.source, input.source_id) as Row | undefined;
    if (existing) {
      const id = asStr(cell(existing, 'id'), 'id');
      this.st
        .get('UPDATE album_metadata SET title = ?, artist = ?, release_year = ?, cover_url = ?, genres = ?, country = ?, updated_at = ? WHERE id = ?')
        .run(input.title, input.artist, input.release_year ?? null, input.cover_url ?? null, genresJson, input.country ?? null, nowIso(), id);
      return { id, existed: true };
    }
    const id = randomUUID();
    this.st
      .get('INSERT INTO album_metadata (id, source, source_id, title, artist, release_year, cover_url, genres, country, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, input.source, input.source_id, input.title, input.artist, input.release_year ?? null, input.cover_url ?? null, genresJson, input.country ?? null, nowIso(), nowIso());
    return { id, existed: false };
  }

  /** 落库记录（FR-1/D2）：重复 → DuplicateRecordError（409 duplicate_record，ADR-007 条 2） */
  createRecord(input: {
    album_id: string;
    userId?: string;
    added_at?: string;
    listened_at?: string | null;
    listened_precision?: 'day' | 'year' | null;
    note?: string | null;
  }): { id: string } {
    const userId = input.userId ?? 'local';
    const id = randomUUID();
    const ts = nowIso();
    try {
      this.st
        .get('INSERT INTO collection_record (id, user_id, album_id, added_at, listened_at, listened_precision, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, userId, input.album_id, input.added_at ?? ts, input.listened_at ?? null, input.listened_precision ?? null, input.note ?? null, ts, ts);
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
        const dup = this.st.get('SELECT id FROM collection_record WHERE user_id = ? AND album_id = ?').get(userId, input.album_id) as Row | undefined;
        throw new DuplicateRecordError(dup ? asStr(cell(dup, 'id'), 'id') : '');
      }
      throw err;
    }
    return { id };
  }

  /** 补/改 favorite、note、listened_at（FR-1/P1-7）：未命中 → NotFoundError */
  updateRecord(
    id: string,
    patch: { note?: string | null; is_favorite?: boolean; listened_at?: string | null; listened_precision?: 'day' | 'year' | null; cover_color?: number | null },
    userId = 'local'
  ): { id: string } {
    const sets: string[] = [];
    const params: Cell[] = [];
    if (patch.note !== undefined) {
      sets.push('note = ?');
      params.push(patch.note);
    }
    if (patch.is_favorite !== undefined) {
      sets.push('is_favorite = ?');
      params.push(patch.is_favorite ? 1 : 0);
    }
    if (patch.listened_at !== undefined) {
      sets.push('listened_at = ?');
      params.push(patch.listened_at);
    }
    if (patch.listened_precision !== undefined) {
      sets.push('listened_precision = ?');
      params.push(patch.listened_precision);
    }
    if (patch.cover_color !== undefined) {
      sets.push('cover_color = ?');
      params.push(patch.cover_color);
    }
    if (sets.length === 0) throw new Error('empty_patch');
    sets.push('updated_at = ?');
    params.push(nowIso());
    params.push(id, userId);
    const res = this.st.get(`UPDATE collection_record SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
    if (Number(res['changes'] ?? 0) === 0) throw new NotFoundError();
    return { id };
  }

  /** 挂标签（AGENTS §7）：normalized 唯一约束防分裂（复审 V12）；整组替换语义 */
  setTags(recordId: string, names: string[], userId = 'local'): string[] {
    const pairs = [...new Map(names.map((n) => [normalizeTag(n), n.trim()]))].filter(([norm]) => norm !== '');
    this.tx(() => {
      const cur = this.st.get('SELECT id FROM collection_record WHERE id = ? AND user_id = ?').get(recordId, userId) as Row | undefined;
      if (!cur) throw new NotFoundError();
      this.st.get('DELETE FROM record_tag WHERE record_id = ?').run(recordId);
      for (const [norm, raw] of pairs) {
        const row = this.st.get('SELECT id FROM tags WHERE user_id = ? AND normalized_name = ?').get(userId, norm) as Row | undefined;
        let tagId: string;
        if (row) {
          tagId = asStr(cell(row, 'id'), 'tag.id');
        } else {
          tagId = randomUUID();
          this.st.get('INSERT INTO tags (id, user_id, name, normalized_name, created_at) VALUES (?,?,?,?,?)').run(tagId, userId, raw, norm, nowIso());
        }
        this.st.get('INSERT INTO record_tag (record_id, tag_id, created_at) VALUES (?,?,?)').run(recordId, tagId, nowIso());
      }
      this.st.get('UPDATE collection_record SET updated_at = ? WHERE id = ?').run(nowIso(), recordId);
    });
    return pairs.map(([norm]) => norm);
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

export type { AlbumRow, CollectionItem, CollectionDetail, AxisCounts, Stats, Filters };
export { parseGenres, asNumN, asStrN, asBool };
