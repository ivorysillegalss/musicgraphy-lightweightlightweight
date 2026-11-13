// Topster 策展域（W10-12-1 W10 批；评审案 docs/topster-review.md Q1–Q7，用户 2026-11-14 AskUserQuestion 批准实现）。
// 域文件直连先例 = savedviews/lookups/associations（G3：dao.ts 178 行零改动）。红线（PRD §4 方案 B 调整 1 +
// 终稿不做清单）：Topster = Collection 的一种 View——item_order 只存 collection_record.id 引用，不复制任何
// 专辑/记录数据（成员渲染实时 JOIN = View 语义）；策展仅限顺序 + 副标题（禁自由画布：表无布局/位置字段）；
// 容量 ≤60（内存纪律① LIMIT≤60 对齐，一次取数零豁免）。
import { randomUUID } from 'node:crypto';
import { NotFoundError } from './errors';
import { LIST_COLS, SQL_TOPSTER_BY_ID, SQL_TOPSTER_LIST } from './queries';
import { escapeLike, nowIso, type Row, type StmtCache } from './sql';
import { asStr, cell, mapItem, type CollectionItem } from './types';

export const TOPSTER_CAPACITY = 60;
export const TITLE_MAX = 80;
export const SUBTITLE_MAX = 120;

export interface TopsterMeta {
  id: string;
  title: string;
  subtitle: string | null;
  item_order: string; // JSON 数组 [record_id,...]（存库原形；解析 = parseItemOrder）
  created_at: string;
}

/** item_order 解析（写路径唯一入口）：必须是 JSON 字符串数组（元素为 record id），否则 null */
export function parseItemOrder(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > TOPSTER_CAPACITY) return null;
    return parsed.every((x) => typeof x === 'string' && x !== '') ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function mapTopster(r: Row): TopsterMeta {
  return {
    id: asStr(cell(r, 'id'), 'id'),
    title: asStr(cell(r, 'title'), 'title'),
    subtitle: cell(r, 'subtitle') === null ? null : asStr(cell(r, 'subtitle'), 'subtitle'),
    item_order: asStr(cell(r, 'item_order'), 'item_order'),
    created_at: asStr(cell(r, 'created_at'), 'created_at')
  };
}

export function listTopsters(st: StmtCache, userId = 'local'): TopsterMeta[] {
  const rows = st.get(SQL_TOPSTER_LIST).all(userId) as Row[];
  return rows.map(mapTopster);
}

/** 不存在 → undefined（页面 404） */
export function getTopster(st: StmtCache, id: string, userId = 'local'): TopsterMeta | undefined {
  const row = st.get(SQL_TOPSTER_BY_ID).get(id, userId) as Row | undefined;
  return row ? mapTopster(row) : undefined;
}

export function createTopster(st: StmtCache, title: string, subtitle: string | null, userId = 'local'): { id: string } {
  const id = randomUUID();
  st.get('INSERT INTO topster_views (id, user_id, title, subtitle, item_order, created_at) VALUES (?,?,?,?,?,?)').run(
    id, userId, title, subtitle, '[]', nowIso()
  );
  return { id };
}

export function updateTopsterMeta(st: StmtCache, id: string, title: string, subtitle: string | null, userId = 'local'): void {
  const res = st.get('UPDATE topster_views SET title = ?, subtitle = ? WHERE id = ? AND user_id = ?').run(title, subtitle, id, userId);
  if (Number(res['changes'] ?? 0) === 0) throw new NotFoundError();
}

export function deleteTopster(st: StmtCache, id: string, userId = 'local'): void {
  const res = st.get('DELETE FROM topster_views WHERE id = ? AND user_id = ?').run(id, userId);
  if (Number(res['changes'] ?? 0) === 0) throw new NotFoundError();
}

/**
 * 成员取数（View 语义）：按 item_order 序重排（策展顺序是用户事实，非元数据事实——SQL 不排序）。
 * 已删记录的 id 渲染时跳过并如实计数（评审案 Q7 诚实占位，不静默伪造满格）。
 */
export function topsterItems(st: StmtCache, recordIds: string[], userId = 'local'): { items: CollectionItem[]; missing: number } {
  if (recordIds.length === 0) return { items: [], missing: 0 };
  const found = new Map<string, CollectionItem>();
  for (let i = 0; i < recordIds.length; i += 100) {
    // SQLite 变量上限，分块 100（lookups.existingSourceIds 先例）
    const chunk = recordIds.slice(i, i + 100);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = st
      .get(`SELECT ${LIST_COLS} FROM collection_record r JOIN album_metadata m ON m.id = r.album_id WHERE r.user_id = ? AND r.id IN (${placeholders})`)
      .all(userId, ...chunk) as Row[];
    for (const r of rows) found.set(asStr(cell(r, 'id'), 'id'), mapItem(r));
  }
  const items: CollectionItem[] = [];
  for (const rid of recordIds) {
    const it = found.get(rid);
    if (it !== undefined) items.push(it);
  }
  return { items, missing: recordIds.length - items.length };
}

/** record_id 是否为本档案在册（成员写路径防越权/防悬空引用） */
function recordExists(st: StmtCache, recordId: string, userId = 'local'): boolean {
  const row = st.get('SELECT 1 AS one FROM collection_record WHERE id = ? AND user_id = ?').get(recordId, userId) as Row | undefined;
  return row !== undefined;
}

export type MemberOpResult = 'added' | 'removed' | 'moved' | 'no_change' | 'full' | 'duplicate' | 'invalid_record' | 'not_found';

/** 尾部追加成员（容量/重复/越权校验；失败返回原因码不抛——页面通道 303+flash 语义，评审案 Q4 修订披露） */
export function addTopsterMember(st: StmtCache, id: string, recordId: string, userId = 'local'): MemberOpResult {
  const t = getTopster(st, id, userId);
  if (t === undefined) return 'not_found';
  const order = parseItemOrder(t.item_order);
  if (order === null) return 'no_change';
  if (order.includes(recordId)) return 'duplicate';
  if (order.length >= TOPSTER_CAPACITY) return 'full';
  if (!recordExists(st, recordId, userId)) return 'invalid_record';
  order.push(recordId);
  st.get('UPDATE topster_views SET item_order = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(order), id, userId);
  return 'added';
}

/** 移出成员（不在列 → no_change；不存在 → not_found） */
export function removeTopsterMember(st: StmtCache, id: string, recordId: string, userId = 'local'): MemberOpResult {
  const t = getTopster(st, id, userId);
  if (t === undefined) return 'not_found';
  const order = parseItemOrder(t.item_order);
  if (order === null) return 'no_change';
  const idx = order.indexOf(recordId);
  if (idx === -1) return 'no_change';
  order.splice(idx, 1);
  st.get('UPDATE topster_views SET item_order = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(order), id, userId);
  return 'removed';
}

/** 上移/下移一位（无 JS ↑↓ form 语义；越界/不在列 → no_change） */
export function moveTopsterMember(st: StmtCache, id: string, recordId: string, dir: 'up' | 'down', userId = 'local'): MemberOpResult {
  const t = getTopster(st, id, userId);
  if (t === undefined) return 'not_found';
  const order = parseItemOrder(t.item_order);
  if (order === null) return 'no_change';
  const idx = order.indexOf(recordId);
  if (idx === -1) return 'no_change';
  const target = dir === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= order.length) return 'no_change';
  const tmp = order[idx];
  order[idx] = order[target] as string;
  order[target] = tmp as string;
  st.get('UPDATE topster_views SET item_order = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(order), id, userId);
  return 'moved';
}

/** 添加成员候选（本地档案检索，不调上游——成员必须来自 Collection）：标题/艺术家 LIKE（escapeLike，评审 R10），排除已在列 */
export function memberCandidates(st: StmtCache, id: string, q: string, userId = 'local'): CollectionItem[] {
  const t = getTopster(st, id, userId);
  if (t === undefined) return [];
  const order = parseItemOrder(t.item_order) ?? [];
  const like = `%${escapeLike(q)}%`;
  const rows = st
    .get(`SELECT ${LIST_COLS} FROM collection_record r JOIN album_metadata m ON m.id = r.album_id ` +
      'WHERE r.user_id = ? AND (m.title LIKE ? ESCAPE \'\\\' OR m.artist LIKE ? ESCAPE \'\\\') ' +
      'ORDER BY r.added_at DESC, r.id DESC LIMIT 12')
    .all(userId, like, like) as Row[];
  return rows.map(mapItem).filter((it) => !order.includes(it.id));
}
