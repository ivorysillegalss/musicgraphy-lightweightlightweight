// Tag 轻治理域（P1-6，评审案 docs/tag-governance-review.md；自 dao.ts 外拆保持 G3<200——域文件委托先例 = associations/metrics）
// Q1 候选 = 全部 tag + 引用计数（LEFT JOIN 含 0 引用——setTags 删引用不删 tags 行）；Q2 近形 = 归一化名编辑距离 ≤2 且长度 ≥2；
// Q5 合并 = 事务内引用重定向（PK 排除已有目标）+ 删旧引用 + 删旧 tag 行——旧 tag 消失、引用保留（PRD 验收）。
import type { Db } from './connection';
import { normalizeTag, nowIso, type Row, type StmtCache } from './sql';
import { SQL_TAG_GOV } from './queries';

export interface TagGovItem {
  id: string;
  name: string;
  refs: number;
}

export interface TagGovPair {
  /** 推荐方向：refs 大者为目标（Q7） */
  source: TagGovItem;
  target: TagGovItem;
}

export interface TagGovernance {
  pairs: TagGovPair[];
  orphans: TagGovItem[];
}

/** 编辑距离（Levenshtein，自写 DP——G1 零依赖；归一化名上比对，Q2） */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** 治理候选（Q1/Q3）：近形对 ≤3（推荐方向 = refs 大者为目标）+ 孤 tag ≤5（refs ≤1，仅提示）。 */
export function candidates(st: StmtCache, userId = 'local'): TagGovernance {
  const rows = st.get(SQL_TAG_GOV).all(userId) as Row[];
  const items: TagGovItem[] = rows.map((r) => ({
    id: String(r['id'] ?? ''),
    name: String(r['name'] ?? ''),
    refs: Number(r['refs'] ?? 0)
  }));
  // Q2：O(n²) 距离比对（LIMIT 500 上限内，个人规模毫秒级）。
  // 阈值分档（02 §2.3「≤2」的收紧修订，防 2 字符中文 tag 误报——任意两个不同字对距离恒为 2）：
  // 短词（min 长度 ≤2）距离 1 才算近形；≥3 字维持 ≤2
  const pairs: TagGovPair[] = [];
  outer: for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i] as TagGovItem;
      const b = items[j] as TagGovItem;
      const na = normalizeTag(a.name);
      const nb = normalizeTag(b.name);
      if (na.length < 2 || nb.length < 2) continue;
      const threshold = Math.min(na.length, nb.length) <= 2 ? 1 : 2;
      if (editDistance(na, nb) <= threshold) {
        pairs.push(a.refs >= b.refs ? { source: b, target: a } : { source: a, target: b });
        if (pairs.length >= 3) break outer; // Q3：一行式 ≤3 对
      }
    }
  }
  const paired = new Set(pairs.flatMap((p) => [p.source.id, p.target.id]));
  const orphans = items.filter((t) => t.refs <= 1 && !paired.has(t.id)).slice(0, 5);
  return { pairs, orphans };
}

/** 合并（Q5）：引用重定向 → 删旧引用 → 删旧 tag。返回 moved = 重定向引用数、deleted = 旧 tag 行确实被删（合并发生）——
 * moved=0 且 deleted=true 合法：唯一引用记录已同挂目标 tag（全部 PK 去重），重定向 0 行但旧 tag 仍消失。 */
export function mergeTags(db: Db, st: StmtCache, sourceName: string, targetName: string, userId = 'local'): { moved: number; deleted: boolean } {
  const src = normalizeTag(sourceName);
  const tgt = normalizeTag(targetName);
  if (src === '' || tgt === '' || src === tgt) return { moved: 0, deleted: false };
  const srcRow = st.get('SELECT id FROM tags WHERE user_id = ? AND normalized_name = ?').get(userId, src) as Row | undefined;
  const tgtRow = st.get('SELECT id FROM tags WHERE user_id = ? AND normalized_name = ?').get(userId, tgt) as Row | undefined;
  if (!srcRow || !tgtRow) return { moved: 0, deleted: false };
  const sourceId = String(srcRow['id'] ?? '');
  const targetId = String(tgtRow['id'] ?? '');
  db.exec('BEGIN IMMEDIATE');
  try {
    const ins = st
      .get(
        'INSERT INTO record_tag (record_id, tag_id, created_at) SELECT record_id, ?, ? FROM record_tag WHERE tag_id = ? ' +
          'AND record_id NOT IN (SELECT record_id FROM record_tag WHERE tag_id = ?)'
      )
      .run(targetId, nowIso(), sourceId, targetId);
    st.get('DELETE FROM record_tag WHERE tag_id = ?').run(sourceId);
    const del = st.get('DELETE FROM tags WHERE id = ? AND user_id = ?').run(sourceId, userId);
    db.exec('COMMIT');
    return { moved: Number(ins['changes'] ?? 0), deleted: Number(del['changes'] ?? 0) > 0 };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
