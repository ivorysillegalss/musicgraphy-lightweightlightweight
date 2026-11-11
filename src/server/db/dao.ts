import type { Db } from './connection';
import { buildWhere, decodeCursor, encodeCursor, escapeLike, normalizeTag, SORTS, StmtCache, type Cell, type Filters, type Row } from './sql';
import { AXIS_SQL, LIST_COLS, SQL_DETAIL, SQL_ECHO, SQL_RECORD_TAGS } from './queries';
import { CursorInvalidError, NotFoundError } from './errors';
import { asStr, cell, mapAlbum, mapItem, type AxisCounts, type CollectionDetail, type CollectionItem, type FacetCount, type Stats } from './types';
import * as writes from './writes';

export { DuplicateRecordError, NotFoundError, CursorInvalidError } from './errors';
export { parseGenres, asNumN, asStrN, asBool } from './types';
export type { AlbumRow, CollectionItem, CollectionDetail, AxisCounts, Stats } from './types';
export type { Filters } from './sql';

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

  /** FR-1 已收藏前置标记：按 (source, source_id) 批量查已存在（SQLite 变量上限，分块 100） */
  existingSourceIds(source: string, sourceIds: string[]): Set<string> {
    const found = new Set<string>();
    for (let i = 0; i < sourceIds.length; i += 100) {
      const chunk = sourceIds.slice(i, i + 100);
      if (chunk.length === 0) continue;
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.st.get(`SELECT source_id FROM album_metadata WHERE source = ? AND source_id IN (${placeholders})`).all(source, ...chunk) as Row[];
      for (const r of rows) found.add(asStr(cell(r, 'source_id'), 'source_id'));
    }
    return found;
  }

  // —— 写路径（实现见 writes.ts；委托保持调用方接口不变，PM §7.1 护栏）——
  upsertAlbum = (input: Parameters<typeof writes.upsertAlbum>[2]): { id: string; existed: boolean } => writes.upsertAlbum(this.db, this.st, input);
  createRecord = (input: Parameters<typeof writes.createRecord>[2]): { id: string } => writes.createRecord(this.db, this.st, input);
  updateRecord = (id: string, patch: Parameters<typeof writes.updateRecord>[2], userId = 'local'): { id: string } =>
    writes.updateRecord(this.st, id, patch, userId);
  setTags = (recordId: string, names: string[], userId = 'local'): string[] => writes.setTags(this.db, this.st, recordId, names, userId);
  setAlbumCoverLocal = (albumId: string, filename: string | null): void => writes.setAlbumCoverLocal(this.st, albumId, filename);
}
