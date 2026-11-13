// 查找域（元数据成员判定 / 专辑行读取；自 dao.ts 机械搬移保持 G3<200——IM-10a 先例同款，零行为变更）
// saved_views 委托腾位预案 = docs/saved-views-review.md §4（用户 2026-11-14 批准实现时的配套外拆）
import type { Row, StmtCache } from './sql';
import { asStr, cell, mapAlbum, type AlbumRow } from './types';

/** FR-1 已收藏前置标记：按 (source, source_id) 批量查已存在（SQLite 变量上限，分块 100） */
export function existingSourceIds(st: StmtCache, source: string, sourceIds: string[]): Set<string> {
  const found = new Set<string>();
  for (let i = 0; i < sourceIds.length; i += 100) {
    const chunk = sourceIds.slice(i, i + 100);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(',');
    const rows = st.get(`SELECT source_id FROM album_metadata WHERE source = ? AND source_id IN (${placeholders})`).all(source, ...chunk) as Row[];
    for (const r of rows) found.add(asStr(cell(r, 'source_id'), 'source_id'));
  }
  return found;
}

/** 专辑行读取（封面懒下载 / 搜索响应锚定用）；不存在 → null */
export function getAlbum(st: StmtCache, albumId: string): AlbumRow | null {
  const row = st.get('SELECT * FROM album_metadata WHERE id = ?').get(albumId) as Row | undefined;
  return row ? mapAlbum(row) : null;
}

/** FR-1 捷径③（成员判定版）：候选专辑是否真的在 collection_record 中（搜索期会落 album_metadata，行存在 ≠ 已收藏） */
export function albumIdsInCollection(st: StmtCache, albumIds: string[]): Set<string> {
  const found = new Set<string>();
  for (let i = 0; i < albumIds.length; i += 100) {
    const chunk = albumIds.slice(i, i + 100);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(',');
    const rows = st.get(`SELECT DISTINCT album_id FROM collection_record WHERE album_id IN (${placeholders})`).all(...chunk) as Row[];
    for (const r of rows) found.add(asStr(cell(r, 'album_id'), 'album_id'));
  }
  return found;
}
