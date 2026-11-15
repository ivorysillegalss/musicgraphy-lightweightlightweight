import type { Db } from './connection';
import { buildWhere, decodeCursor, encodeCursor, escapeLike, normalizeTag, nowIso, SORTS, StmtCache, type Cell, type Filters, type Row } from './sql';
import { AXIS_SQL, LIST_COLS, SQL_DETAIL, SQL_EXPORT, SQL_EXPORT_TAGS, SQL_RECORD_TAGS } from './queries';
import { CursorInvalidError, NotFoundError } from './errors';
import * as echo from './echo';
import * as lookups from './lookups';
import * as savedviews from './savedviews';
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
import * as genremap from './genremap';
import * as metrics from './metrics';
import * as panorama from './panorama';
import * as taggov from './taggov';
import * as writes from './writes';
import * as topster from './topster';

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

  /** 那年今日（P1-1，确定性时间锚）：本地时区 + 周年边界已修（复审注）——实现见 echo.ts（G3 外拆腾位，IM-10a 先例同款） */
  echoToday = (userId = 'local', limit = 10): CollectionItem[] => echo.echoToday(this.st, userId, limit);

  // P1-10 命名视图（实现见 savedviews.ts；用户 2026-11-14 批准，评审案 docs/saved-views-review.md）
  listSavedViews = (userId = 'local'): savedviews.SavedView[] => savedviews.listSavedViews(this.st, userId);
  createSavedView = (name: string, queryJson: string, userId = 'local'): { id: string } => savedviews.createSavedView(this.db, this.st, name, queryJson, userId);
  deleteSavedView = (id: string, userId = 'local'): { id: string } => savedviews.deleteSavedView(this.st, id, userId);
  getViewByName = (name: string, userId = 'local'): savedviews.SavedView | undefined => savedviews.getViewByName(this.st, name, userId);

  // —— 仪表聚合（实现见 metrics.ts：stats 四计数机械搬移零行为变更 + 观察池 metricsCoverage 北极星；委托 PM §7.1 护栏）——
  stats = (): Stats => metrics.stats(this.st);
  metricsCoverage = (userId = 'local'): metrics.MetricsCoverage => metrics.metricsCoverage(this.st, userId);

  // —— 查找域（实现见 lookups.ts：existingSourceIds/getAlbum/albumIdsInCollection 机械搬移，IM-10a 先例同款零行为变更）——
  existingSourceIds = (source: string, sourceIds: string[]): Set<string> => lookups.existingSourceIds(this.st, source, sourceIds);
  getAlbum = (albumId: string): AlbumRow | null => lookups.getAlbum(this.st, albumId);
  albumIdsInCollection = (albumIds: string[]): Set<string> => lookups.albumIdsInCollection(this.st, albumIds);
  randomRecordId = (userId = 'local'): string | null => lookups.randomRecordId(this.st, userId);

  // —— 设计参考视图域（R-106/R-109 · S2-12/S2-24，评审案 docs/design-refs-review.md；域文件委托先例）——
  genreMap = (userId = 'local'): genremap.GenreMap => genremap.genreMap(this.st, userId);
  panoramaNodes = (userId = 'local'): panorama.PanoramaData => panorama.panoramaNodes(this.st, userId);

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

  // P1-6 Tag 轻治理（实现见 taggov.ts；评审案 docs/tag-governance-review.md——域文件委托先例）
  tagCandidates = (userId = 'local'): taggov.TagGovernance => taggov.candidates(this.st, userId);
  mergeTags = (sourceName: string, targetName: string, userId = 'local'): { moved: number; deleted: boolean } =>
    taggov.mergeTags(this.db, this.st, sourceName, targetName, userId);

  // —— 写路径（实现见 writes.ts；委托保持调用方接口不变，PM §7.1 护栏）——
  upsertAlbum = (input: Parameters<typeof writes.upsertAlbum>[2]): { id: string; existed: boolean } => writes.upsertAlbum(this.db, this.st, input);
  createRecord = (input: Parameters<typeof writes.createRecord>[2]): { id: string } => writes.createRecord(this.db, this.st, input);
  updateRecord = (id: string, patch: Parameters<typeof writes.updateRecord>[2], userId = 'local'): { id: string } =>
    writes.updateRecord(this.st, id, patch, userId);
  setTags = (recordId: string, names: string[], userId = 'local'): string[] => writes.setTags(this.db, this.st, recordId, names, userId);
  setAlbumCoverLocal = (albumId: string, filename: string | null): void => writes.setAlbumCoverLocal(this.st, albumId, filename);

  // Topster 策展域（W10-12-1 W10 批；实现见 topster.ts；评审案 docs/topster-review.md——域文件委托先例 = savedviews/assoc/taggov）
  listTopsters = (userId = 'local'): topster.TopsterMeta[] => topster.listTopsters(this.st, userId);
  getTopster = (id: string, userId = 'local'): topster.TopsterMeta | undefined => topster.getTopster(this.st, id, userId);
  createTopster = (title: string, subtitle: string | null, userId = 'local'): { id: string } => topster.createTopster(this.st, title, subtitle, userId);
  updateTopsterMeta = (id: string, title: string, subtitle: string | null, userId = 'local'): void => topster.updateTopsterMeta(this.st, id, title, subtitle, userId);
  deleteTopster = (id: string, userId = 'local'): void => topster.deleteTopster(this.st, id, userId);
  topsterItems = (recordIds: string[], userId = 'local'): { items: CollectionItem[]; missing: number } => topster.topsterItems(this.st, recordIds, userId);
  addTopsterMember = (id: string, recordId: string, userId = 'local'): topster.MemberOpResult => topster.addTopsterMember(this.st, id, recordId, userId);
  removeTopsterMember = (id: string, recordId: string, userId = 'local'): topster.MemberOpResult => topster.removeTopsterMember(this.st, id, recordId, userId);
  moveTopsterMember = (id: string, recordId: string, dir: 'up' | 'down', userId = 'local'): topster.MemberOpResult =>
    topster.moveTopsterMember(this.st, id, recordId, dir, userId);
  memberCandidates = (id: string, q: string, userId = 'local'): CollectionItem[] => topster.memberCandidates(this.st, id, q, userId);
}
