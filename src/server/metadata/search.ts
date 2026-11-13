// 搜索服务（FR-1 输入端，routes/metadata.ts 与 app.ts 首页共用）：
// 降级链搜索 → 候选快照落 album_metadata（F1：搜索即缓存外部元数据，源失效仍可显示/检索）
// → §5.2 跨源归并在 upsertAlbum 内完成（首个挂接的行保留，其余源 ID 进 alias_sources）
// → in_collection 按 collection_record 成员判定（搜索会建行，行存在 ≠ 已收藏）。
// 全程零用户数据表写入（只写 album_metadata，AGENTS §4 二分红线）。
// IM-22 R1/R2（规格 = 05-系统架构设计/评审案-多用户并发与封面缓存.md，Q1 TTL 10min）：
//   R2 single-flight——同链路同规范化 q 并发到达共享同一次在途上游调用（Map<key, Promise>）；
//   R1 快照回放——规范化 q → album row ids 内存缓存（只存 id 不存内容，~40KB 量级，预算
//   <0.5MB），TTL 10min；命中从 DB 重建 items 并重算 in_collection，零上游（用户数据即时、
//   外部元数据 10min 内取快照，与 F1 落库语义天然一致）。缓存与在途状态按 SourceChain 实例
//   分域（WeakMap）：`?source=` 过滤查询每请求新建链 → 天然不命中不过期串味，正确性优先。
//   memo 经可选参数注入（测试自建实例隔离）；缺省 = 模块级共享实例——三调用方
//   （routes/metadata、pages、suggest）共用同一份缓存与在途合并，DAO 零改动（缓存放 metadata 域）。
import type { DAO } from '../db/dao';
import type { AliasSourceRef, AlbumRow } from '../db/types';
import type { AlbumCandidate } from './musicbrainz';
import type { MetadataSource, SourceChain } from './sources';

/** 响应项：02 §2.1 字段对齐 + FR-1 的 in_collection 标记 */
export interface AlbumSearchItem extends AlbumCandidate {
  id: string;
  cover_local: string | null;
  alias_sources: AliasSourceRef[];
}

/** SearchMemo 选项：TTL（Q1 默认 600_000 = 10min）与每链路快照条数上限（FIFO 淘汰防无界） */
export interface SearchMemoOptions {
  ttlMs?: number;
  maxEntries?: number;
  nowFn?: () => number;
}

/** IM-22 R1/R2 搜索记忆层：快照回放缓存（R1）+ 在途查询合并（R2）。只存 row id，无内容驻留。 */
export class SearchMemo {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly nowFn: () => number;
  /** chain → (memoKey → 快照)；Map 插入序 = FIFO 淘汰依据 */
  private readonly snapshots = new WeakMap<SourceChain, Map<string, { at: number; ids: string[] }>>();
  /** chain → (memoKey → 在途上游调用)；R2 同键并发共享 */
  private readonly inFlight = new WeakMap<SourceChain, Map<string, Promise<AlbumCandidate[]>>>();

  constructor(opts: SearchMemoOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 600_000;
    this.maxEntries = opts.maxEntries ?? 256;
    this.nowFn = opts.nowFn ?? (() => Date.now());
  }

  /** Q1 规范化：trim + casefold（JS 等价 = toLowerCase）；仅作 memo 键，不改传给上游的原始 q */
  normalize(q: string): string {
    return q.trim().toLowerCase();
  }

  /** R1：未过期快照命中 → row ids；缺失/过期（惰性清除）→ null */
  take(chain: SourceChain, key: string): string[] | null {
    const hit = this.snapshots.get(chain)?.get(key);
    if (hit === undefined) return null;
    if (this.nowFn() - hit.at >= this.ttlMs) {
      this.snapshots.get(chain)?.delete(key);
      return null;
    }
    return hit.ids;
  }

  /** R1：成功搜索后登记快照；超限按 FIFO 淘汰最旧（重复键重插队尾刷新序） */
  put(chain: SourceChain, key: string, ids: string[]): void {
    let m = this.snapshots.get(chain);
    if (m === undefined) {
      m = new Map();
      this.snapshots.set(chain, m);
    }
    m.delete(key);
    m.set(key, { at: this.nowFn(), ids });
    while (m.size > this.maxEntries) {
      const oldest = m.keys().next();
      if (oldest.done === true) break;
      m.delete(oldest.value);
    }
  }

  /** R2：同链路同键并发共享在途上游调用；失败即摘除（不连坐后续请求） */
  joinInFlight(chain: SourceChain, key: string, run: () => Promise<AlbumCandidate[]>): Promise<AlbumCandidate[]> {
    let m = this.inFlight.get(chain);
    if (m === undefined) {
      m = new Map();
      this.inFlight.set(chain, m);
    }
    const existing = m.get(key);
    if (existing !== undefined) return existing;
    const map = m;
    const p = run().catch((err: unknown) => {
      map.delete(key);
      throw err;
    });
    m.set(key, p);
    return p;
  }

  /** R2：成功路径在缓存登记后摘除（finally 调用），闭合「已摘除、缓存未落」并发窗口 */
  finishInFlight(chain: SourceChain, key: string): void {
    this.inFlight.get(chain)?.delete(key);
  }
}

/** 模块级共享实例：三调用方共用同一份缓存与在途合并（测试经可选参数注入自有实例隔离） */
const defaultMemo = new SearchMemo();

export async function searchAlbums(
  dao: DAO,
  chain: SourceChain,
  q: string,
  limit: number,
  memo: SearchMemo = defaultMemo
): Promise<AlbumSearchItem[]> {
  const key = `${memo.normalize(q)}|${limit}`;
  // R1 快照回放：命中 → 从 DB 重建 items（重算 in_collection），零上游
  const cachedIds = memo.take(chain, key);
  if (cachedIds !== null) return rebuildItems(dao, cachedIds);
  let items: AlbumSearchItem[];
  try {
    const candidates = await memo.joinInFlight(chain, key, () => chain.search(q, limit));
    items = [];
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
      items.push(itemFromRow(row, false));
    }
    // R1：快照登记（成功路径）——先落缓存再摘在途，合并窗口两侧均有归宿
    memo.put(chain, key, items.map((it) => it.id));
  } finally {
    memo.finishInFlight(chain, key);
  }
  const inCollection = dao.albumIdsInCollection(items.map((it) => it.id));
  for (const it of items) it.in_collection = inCollection.has(it.id);
  return items;
}

/** 行 → 响应项（fresh 与回放共用形状）；in_collection 由调用方按成员集回填 */
function itemFromRow(row: AlbumRow, inCollection: boolean): AlbumSearchItem {
  return {
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
    in_collection: inCollection
  };
}

/** R1 回放：ids → DB 重建 items（行消失防御性跳过）+ 重算 in_collection（用户数据即时） */
function rebuildItems(dao: DAO, ids: string[]): AlbumSearchItem[] {
  const items: AlbumSearchItem[] = [];
  for (const id of ids) {
    const row = dao.getAlbum(id);
    if (row === null) continue;
    items.push(itemFromRow(row, false));
  }
  const inCollection = dao.albumIdsInCollection(items.map((it) => it.id));
  for (const it of items) it.in_collection = inCollection.has(it.id);
  return items;
}
