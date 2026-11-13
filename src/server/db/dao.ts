import type { Db } from './connection';
import { buildWhere, decodeCursor, encodeCursor, escapeLike, normalizeTag, nowIso, SORTS, StmtCache, type Cell, type Filters, type Row } from './sql';
import { AXIS_SQL, LIST_COLS, SQL_DETAIL, SQL_ECHO, SQL_EXPORT, SQL_EXPORT_TAGS, SQL_RECORD_TAGS } from './queries';
import { CursorInvalidError, NotFoundError } from './errors';
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
  type ExportItem,
  type ExportPayload,
  type FacetCount,
  type Stats
} from './types';
import * as assoc from './associations';
import * as metrics from './metrics';
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

  // —— 仪表聚合（实现见 metrics.ts：stats 四计数机械搬移零行为变更 + 观察池 metricsCoverage 北极星；委托 PM §7.1 护栏）——
  stats = (): Stats => metrics.stats(this.st);
  metricsCoverage = (userId = 'local'): metrics.MetricsCoverage => metrics.metricsCoverage(this.st, userId);

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

  /** 专辑行读取（封面懒下载 / 搜索响应锚定用）；不存在 → null */
  getAlbum(albumId: string): AlbumRow | null {
    const row = this.st.get('SELECT * FROM album_metadata WHERE id = ?').get(albumId) as Row | undefined;
    return row ? mapAlbum(row) : null;
  }

  /** FR-1 捷径③（成员判定版）：候选专辑是否真的在 collection_record 中（搜索期会落 album_metadata，行存在 ≠ 已收藏） */
  albumIdsInCollection(albumIds: string[]): Set<string> {
    const found = new Set<string>();
    for (let i = 0; i < albumIds.length; i += 100) {
      const chunk = albumIds.slice(i, i + 100);
      if (chunk.length === 0) continue;
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.st.get(`SELECT DISTINCT album_id FROM collection_record WHERE album_id IN (${placeholders})`).all(...chunk) as Row[];
      for (const r of rows) found.add(asStr(cell(r, 'album_id'), 'album_id'));
    }
    return found;
  }

  /** 全量导出投影（P1-3 §5.4 原形，永久免费）：tags 一次取回按 record_id 归组；全表读 = 内存纪律①唯一豁免 */
  exportAll(userId = 'local'): ExportPayload {
    const rows = this.st.get(SQL_EXPORT).all(userId) as Row[];
    const byRecord = new Map<string, string[]>();
    for (const t of this.st.get(SQL_EXPORT_TAGS).all(userId) as Row[]) {
      const rid = asStr(cell(t, 'record_id'), 'record_id');
      byRecord.set(rid, [...(byRecord.get(rid) ?? []), asStr(cell(t, 'name'), 'name')]);
    }
    return {
      version: '2.0',
      exported_at: nowIso(),
      records: rows.map((r) => ({
        album: {
          title: asStr(cell(r, 'title'), 'title'),
          artist: asStr(cell(r, 'artist'), 'artist'),
          release_year: asNumN(cell(r, 'release_year')),
          cover_url: asStrN(cell(r, 'cover_url')),
          genres: parseGenres(cell(r, 'genres'))
        },
        record: {
          added_at: asStr(cell(r, 'added_at'), 'added_at'),
          listened_at: asStrN(cell(r, 'listened_at')),
          listened_precision: asStrN(cell(r, 'listened_precision')) as ExportItem['record']['listened_precision'],
          is_favorite: asBool(cell(r, 'is_favorite')),
          cover_color: asNumN(cell(r, 'cover_color')),
          note: asStrN(cell(r, 'note'))
        },
        tags: byRecord.get(asStr(cell(r, 'record_id'), 'record_id')) ?? []
      }))
    };
  }

  // P1-5 联想（实现见 associations.ts；案 B 域文件委托——2026-11-14 用户裁决路径 B，DAO <200 行护栏 G3）
  getAssociations = (recordId: string, limit = 18, userId = 'local'): assoc.AssociationItem[] => assoc.getAssociations(this.st, recordId, limit, userId);

  // —— 写路径（实现见 writes.ts；委托保持调用方接口不变，PM §7.1 护栏）——
  upsertAlbum = (input: Parameters<typeof writes.upsertAlbum>[2]): { id: string; existed: boolean } => writes.upsertAlbum(this.db, this.st, input);
  createRecord = (input: Parameters<typeof writes.createRecord>[2]): { id: string } => writes.createRecord(this.db, this.st, input);
  updateRecord = (id: string, patch: Parameters<typeof writes.updateRecord>[2], userId = 'local'): { id: string } =>
    writes.updateRecord(this.st, id, patch, userId);
  setTags = (recordId: string, names: string[], userId = 'local'): string[] => writes.setTags(this.db, this.st, recordId, names, userId);
  setAlbumCoverLocal = (albumId: string, filename: string | null): void => writes.setAlbumCoverLocal(this.st, albumId, filename);
}
