// 跨源合并解析（02 §5.2 / 评审 R4）：同一专辑被多源命中时，保留首个挂接的 album_metadata，
// 其余源 ID 写入 alias_sources JSON 列；用户数据（collection_record/tags）永不触碰、永不迁移。
// 自 writes.ts 拆出（PM §7.1 <200 行护栏）。
import { nowIso, type Row, type StmtCache } from './sql';
import { asStr, cell, parseAliasSources, type AliasSourceRef } from './types';

export interface AlbumUpsertInput {
  source: string;
  source_id: string;
  title: string;
  artist: string;
  release_year?: number | null;
  cover_url?: string | null;
  genres?: string[];
  country?: string | null;
}

/** upsert 落点：key=主键命中；alias=输入键已是某行别名；identity=同 title+artist 归并；new=新建 */
export type AlbumMergeTarget =
  | { kind: 'key' | 'alias' | 'identity'; row: Row }
  | { kind: 'new' };

/**
 * 三级落点解析：
 * ① (source, source_id) 主键命中（UNIQUE idx_album_source）；
 * ② 输入键已存在于某行 alias_sources（旧候选重放 → 归并回锚定行，防重复建行）；
 * ③ title+artist COLLATE NOCASE 命中且键不同 → 归并（保守：精确等值，无模糊匹配）。
 * ③ 的全表等值扫描仅发生在主键未命中的新键路径（5000 行规模毫秒级，暂不加索引——加索引须迁移）。
 */
export function resolveAlbumTarget(st: StmtCache, input: AlbumUpsertInput): AlbumMergeTarget {
  const keyHit = st.get('SELECT * FROM album_metadata WHERE source = ? AND source_id = ?').get(input.source, input.source_id) as Row | undefined;
  if (keyHit) return { kind: 'key', row: keyHit };

  const aliasHit = findByAlias(st, input.source, input.source_id);
  if (aliasHit) return { kind: 'alias', row: aliasHit };

  if (input.title !== '' && input.artist !== '') {
    const rows = st
      .get('SELECT * FROM album_metadata WHERE title = ? COLLATE NOCASE AND artist = ? COLLATE NOCASE LIMIT 1')
      .all(input.title, input.artist) as Row[];
    const first = rows[0];
    if (first) return { kind: 'identity', row: first };
  }
  return { kind: 'new' };
}

/** 输入键是否已是某行的别名（alias_sources 为小数组 JSON，行级解析比对） */
function findByAlias(st: StmtCache, source: string, sourceId: string): Row | undefined {
  const rows = st.get('SELECT * FROM album_metadata WHERE alias_sources IS NOT NULL').all() as Row[];
  for (const r of rows) {
    const refs = parseAliasSources(cell(r, 'alias_sources'));
    if (refs.some((a) => a.source === source && a.source_id === sourceId)) return r;
  }
  return undefined;
}

/** 追加别名（去重；不与行自身主键重复）。返回是否发生写入。 */
export function appendAlias(st: StmtCache, albumId: string, source: string, sourceId: string): boolean {
  const row = st.get('SELECT source, source_id, alias_sources FROM album_metadata WHERE id = ?').get(albumId) as Row | undefined;
  if (!row) return false;
  if (asStr(cell(row, 'source'), 'source') === source && asStr(cell(row, 'source_id'), 'source_id') === sourceId) return false;
  const refs: AliasSourceRef[] = parseAliasSources(cell(row, 'alias_sources'));
  if (refs.some((a) => a.source === source && a.source_id === sourceId)) return false;
  refs.push({ source, source_id: sourceId });
  st.get('UPDATE album_metadata SET alias_sources = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(refs), nowIso(), albumId);
  return true;
}
