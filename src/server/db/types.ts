// 行类型 + 行映射（ADR-002：类型安全由 "SQL → DAO 返回类型" 手写接口层保证）
import type { Cell, Row } from './sql';

/** 跨源合并的别名引用（02 §5.2 / 评审 R4：alias_sources JSON 列的元素形状） */
export interface AliasSourceRef {
  source: string;
  source_id: string;
}

export interface AlbumRow {
  id: string;
  source: string;
  source_id: string;
  title: string;
  artist: string;
  release_year: number | null;
  cover_url: string | null;
  cover_local: string | null;
  genres: string[];
  country: string | null;
  alias_sources: AliasSourceRef[];
  created_at: string;
  updated_at: string;
}

export interface RecordRow {
  id: string;
  user_id: string;
  album_id: string;
  added_at: string;
  listened_at: string | null;
  listened_precision: 'day' | 'year' | null;
  note: string | null;
  is_favorite: boolean;
  cover_color: number | null;
  created_at: string;
  updated_at: string;
}

/** 封面墙网格项（FR-2）：record 平铺 + album 关键字段 */
export interface CollectionItem {
  id: string;
  added_at: string;
  listened_at: string | null;
  listened_precision: 'day' | 'year' | null;
  note: string | null;
  is_favorite: boolean;
  cover_color: number | null;
  album: {
    id: string;
    source: string;
    title: string;
    artist: string;
    release_year: number | null;
    cover_url: string | null;
    cover_local: string | null;
    genres: string[];
  };
}

export interface CollectionDetail extends CollectionItem {
  user_id: string;
  updated_at: string;
  album: AlbumRow;
  tags: string[];
}

export interface FacetCount {
  value: string | number | null;
  count: number;
}

export interface AxisCounts {
  genre?: FacetCount[];
  year?: FacetCount[];
  listened?: FacetCount[];
  favorite?: FacetCount[];
  tag?: FacetCount[];
  color?: FacetCount[];
}

export interface Stats {
  records: number;
  favorites: number;
  tags: number;
  artists: number;
}

// —— 导出投影（P1-3 §5.4 原形，永久免费；评审 R6：cover_url 仅远端地址，图片文件走 with_covers zip）——

export interface ExportItem {
  album: { title: string; artist: string; release_year: number | null; cover_url: string | null; genres: string[] };
  record: {
    added_at: string;
    listened_at: string | null;
    listened_precision: 'day' | 'year' | null;
    is_favorite: boolean;
    cover_color: number | null;
    note: string | null;
  };
  tags: string[];
}

export interface ExportPayload {
  version: string;
  exported_at: string;
  records: ExportItem[];
}

// —— 观察池仪表（PRD §6 六埋点 / 02 §4 metrics 行：{data}，匿名化、可关闭）——
// coverage 北极星实算（SQL_COVERAGE）；行为类五项待埋点（W8-9 行为层）→ null，notes 逐项记录数据源缺失说明
export interface MetricsCoverage {
  coverage: number | null;
  search_fail_rate: number | null;
  named_view_rate: number | null;
  echo_ctr: number | null;
  note_revisit_rate: number | null;
  export_usage: number | null;
  generated_at: string;
  /** null 字段的数据源缺失说明（埋点接线后对应条目移除，勿伪造数字） */
  notes: Partial<Record<'search_fail_rate' | 'named_view_rate' | 'echo_ctr' | 'note_revisit_rate' | 'export_usage', string>>;
}

// —— Row → 类型映射（node:sqlite 返回值为宽松 Record<string, primitive>，边界处收窄）——

export const cell = (r: Row, k: string): Cell => r[k] ?? null;

export const asStr = (v: Cell, field: string): string => {
  if (typeof v !== 'string') throw new Error(`dao: expect string for ${field}, got ${typeof v}`);
  return v;
};
export const asStrN = (v: Cell): string | null => (typeof v === 'string' ? v : null);
export const asNumN = (v: Cell): number | null => (typeof v === 'number' ? v : null);
export const asBool = (v: Cell): boolean => v === 1;

export function parseGenres(v: Cell): string[] {
  if (typeof v !== 'string' || v === '') return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** alias_sources JSON 列解析（02 §5.2：跨源合并的其余源 ID；坏值容错为空数组） */
export function parseAliasSources(v: Cell): AliasSourceRef[] {
  if (typeof v !== 'string' || v === '') return [];
  try {
    const parsed: unknown = JSON.parse(v);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is AliasSourceRef =>
        typeof x === 'object' && x !== null && typeof (x as AliasSourceRef).source === 'string' && typeof (x as AliasSourceRef).source_id === 'string'
    );
  } catch {
    return [];
  }
}

export function mapItem(r: Row): CollectionItem {
  return {
    id: asStr(cell(r, 'id'), 'id'),
    added_at: asStr(cell(r, 'added_at'), 'added_at'),
    listened_at: asStrN(cell(r, 'listened_at')),
    listened_precision: asStrN(cell(r, 'listened_precision')) as CollectionItem['listened_precision'],
    note: asStrN(cell(r, 'note')),
    is_favorite: asBool(cell(r, 'is_favorite')),
    cover_color: asNumN(cell(r, 'cover_color')),
    album: {
      id: asStr(cell(r, 'album_id'), 'album_id'),
      source: asStr(cell(r, 'source'), 'source'),
      title: asStr(cell(r, 'title'), 'title'),
      artist: asStr(cell(r, 'artist'), 'artist'),
      release_year: asNumN(cell(r, 'release_year')),
      cover_url: asStrN(cell(r, 'cover_url')),
      cover_local: asStrN(cell(r, 'cover_local')),
      genres: parseGenres(cell(r, 'genres'))
    }
  };
}

export function mapAlbum(r: Row): AlbumRow {
  return {
    id: asStr(cell(r, 'album_id') ?? cell(r, 'id'), 'album.id'),
    source: asStr(cell(r, 'source'), 'source'),
    source_id: asStr(cell(r, 'source_id'), 'source_id'),
    title: asStr(cell(r, 'title'), 'title'),
    artist: asStr(cell(r, 'artist'), 'artist'),
    release_year: asNumN(cell(r, 'release_year')),
    cover_url: asStrN(cell(r, 'cover_url')),
    cover_local: asStrN(cell(r, 'cover_local')),
    genres: parseGenres(cell(r, 'genres')),
    country: asStrN(cell(r, 'country')),
    alias_sources: parseAliasSources(cell(r, 'alias_sources')),
    created_at: asStr(cell(r, 'album_created_at') ?? cell(r, 'created_at'), 'album.created_at'),
    updated_at: asStr(cell(r, 'album_updated_at') ?? cell(r, 'updated_at'), 'album.updated_at')
  };
}
