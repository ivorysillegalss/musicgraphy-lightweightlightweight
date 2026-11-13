// P1-5 联想域（自 dao.ts 案 B 拆出，保持 DAO <200 行护栏——2026-11-14 用户裁决路径 B，
// 评审案 docs/associations-review.md §3 修正案；writes.ts/album-merge.ts 域文件先例同款）。
// 口径 = 02 §3⑤ + gap 报告 Q1–Q7：同期（added_at 同自然月）/ 同天（同 MM-DD 跨年，不排除当年）/
// 同 Tag（共享任一标签）；关系强度 same_tag > same_day > same_period，同一记录只留最强（Q5）；
// 类内序 added_at DESC, id DESC（确定性 tiebreak，复审 V11 先例）。
import { NotFoundError } from './errors';
import { SQL_ASSOC_ANCHOR, SQL_ASSOC_DAY, SQL_ASSOC_PERIOD, SQL_ASSOC_TAG } from './queries';
import type { Cell, Row, StmtCache } from './sql';
import { asStr, asStrN, cell, mapItem, type CollectionItem } from './types';

/** 联想项 = CollectionItem + 最强关系与命中标签（matched_tag 仅 relation='same_tag' 非空，gap §4.2） */
export interface AssociationItem extends CollectionItem {
  relation: 'same_tag' | 'same_day' | 'same_period';
  matched_tag: string | null;
}

// 强度表（Q5）：SQL 已各自 ORDER BY 类内序，按强度从高到低遍历 + Map 先到先得 = 天然保留最强关系，
// 拼接后即"强度 DESC → added_at DESC → id DESC"全序，无需二次 sort（评审案 R3）
const STRENGTH: Array<{ sql: string; relation: AssociationItem['relation']; params: (base: string, rid: string, uid: string) => Cell[] }> = [
  { sql: SQL_ASSOC_TAG, relation: 'same_tag', params: (_base, rid, uid) => [uid, rid, rid] },
  { sql: SQL_ASSOC_DAY, relation: 'same_day', params: (base, rid, uid) => [uid, rid, base] },
  { sql: SQL_ASSOC_PERIOD, relation: 'same_period', params: (base, rid, uid) => [uid, rid, base] }
];

/** P1-5 联想（02 §4 端点）：三查询各 LIMIT ≤60，合并去重后取前 n（内存纪律①）；锚不存在 → NotFoundError */
export function getAssociations(st: StmtCache, recordId: string, limit = 18, userId = 'local'): AssociationItem[] {
  const n = Math.min(Math.max(limit, 1), 60);
  const anchor = st.get(SQL_ASSOC_ANCHOR).get(recordId, userId) as Row | undefined;
  if (!anchor) throw new NotFoundError(); // gap §3.0：API 层转 404 envelope
  const base = asStr(cell(anchor, 'added_at'), 'added_at');
  const merged = new Map<string, AssociationItem>();
  for (const { sql, relation, params } of STRENGTH) {
    for (const r of st.get(sql).all(...params(base, recordId, userId), n) as Row[]) {
      const id = asStr(cell(r, 'id'), 'id');
      if (!merged.has(id)) merged.set(id, { ...mapItem(r), relation, matched_tag: asStrN(cell(r, 'matched_tag')) });
    }
  }
  return [...merged.values()].slice(0, n);
}
