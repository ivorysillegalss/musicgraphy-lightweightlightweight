// 搜索服务（FR-1 输入端，routes/metadata.ts 与 app.ts 首页共用）：
// 降级链搜索 → 候选快照落 album_metadata（F1：搜索即缓存外部元数据，源失效仍可显示/检索）
// → §5.2 跨源归并在 upsertAlbum 内完成（首个挂接的行保留，其余源 ID 进 alias_sources）
// → in_collection 按 collection_record 成员判定（搜索会建行，行存在 ≠ 已收藏）。
// 全程零用户数据表写入（只写 album_metadata，AGENTS §4 二分红线）。
import type { DAO } from '../db/dao';
import type { AliasSourceRef } from '../db/types';
import type { AlbumCandidate } from './musicbrainz';
import type { MetadataSource, SourceChain } from './sources';

/** 响应项：02 §2.1 字段对齐 + FR-1 的 in_collection 标记 */
export interface AlbumSearchItem extends AlbumCandidate {
  id: string;
  cover_local: string | null;
  alias_sources: AliasSourceRef[];
}

export async function searchAlbums(dao: DAO, chain: SourceChain, q: string, limit: number): Promise<AlbumSearchItem[]> {
  const candidates = await chain.search(q, limit);
  const items: AlbumSearchItem[] = [];
  const seenRows = new Set<string>();
  for (const cand of candidates) {
    const { id } = dao.upsertAlbum({
      source: cand.source,
      source_id: cand.source_id,
      title: cand.title,
      artist: cand.artist,
      release_year: cand.release_year,
      cover_url: cand.cover_url,
      genres: cand.genres,
      country: cand.country
    });
    if (seenRows.has(id)) continue; // 同响应内两候选归并到同一行 → 只保留首个
    seenRows.add(id);
    const row = dao.getAlbum(id);
    if (row === null) throw new Error(`album row vanished after upsert: ${id}`);
    items.push({
      // CHECK 约束保证 source ∈ 枚举（0001_init.sql），字符串列在此收窄
      source: row.source as MetadataSource,
      source_id: row.source_id,
      title: row.title,
      artist: row.artist,
      release_year: row.release_year,
      cover_url: row.cover_url,
      cover_local: row.cover_local,
      genres: row.genres,
      country: row.country,
      alias_sources: row.alias_sources,
      id: row.id,
      in_collection: false
    });
  }
  const inCollection = dao.albumIdsInCollection(items.map((it) => it.id));
  for (const it of items) it.in_collection = inCollection.has(it.id);
  return items;
}
