// 观察池仪表域（PRD §6 六埋点 + 02 §4 metrics 行；自 dao.ts 外拆保持 G3<200——域文件委托先例 = associations/writes）
// coverage = 线索覆盖率（≥1 根线索 Note/Tag/听期的记录占比，北极星，SQL_COVERAGE 实算）；
// named_view_rate = 命名视图周人均新建数（P1-10 saved_views 表实算，SQL_NAMED_VIEW）；
// 行为类四项（W8-9 立项 2026-11-15，评审案 docs/telemetry-review.md，用户执行令）：0005 telemetry_days
// 天粒度计数 → windowSums 近 28 天窗口实算——0/0 无样本 → null（勿伪造）；notes 仅在 null 时给出
// 「无样本 + 口径 + 埋点起点」说明（实算后对应条目移除）。
import { nowIso, type Row, type StmtCache } from './sql';
import { SQL_COVERAGE, SQL_NAMED_VIEW, SQL_STATS } from './queries';
import { cell, type MetricsCoverage, type Stats } from './types';
import { WINDOW_DAYS, windowStartDay, windowSums } from './telemetry';

export type { MetricsCoverage };

/** 仪表总览四计数（自 dao.ts stats() 机械搬移，IM-10a 先例同款，零行为变更；与六仪表零重复——先核对口径避免重复实现） */
export function stats(st: StmtCache): Stats {
  const r = (st.get(SQL_STATS).get() as Row | undefined) ?? {};
  return {
    records: Number(cell(r, 'records') ?? 0),
    favorites: Number(cell(r, 'favorites') ?? 0),
    tags: Number(cell(r, 'tags') ?? 0),
    artists: Number(cell(r, 'artists') ?? 0)
  };
}

/** named_view_rate = 周人均新建数（PRD §6）：视图总数 / 存活周数（首建至今向上取整，≥1）；无视图 → null */
function namedViewRate(st: StmtCache, userId: string): number | null {
  const r = (st.get(SQL_NAMED_VIEW).get(userId) as Row | undefined) ?? {};
  const cnt = Number(cell(r, 'cnt') ?? 0);
  const firstAt = cell(r, 'first_at');
  if (cnt <= 0 || typeof firstAt !== 'string') return null;
  const firstMs = Date.parse(firstAt);
  if (!Number.isFinite(firstMs)) return null;
  const weeks = Math.max(1, Math.ceil((Date.now() - firstMs) / (7 * 24 * 3600_000)));
  return cnt / weeks;
}

/** 行为类四仪表（近 28 天窗口实算，评审案 §3 口径）：0/0 无样本 → null */
function behaviorRates(st: StmtCache, userId: string): Pick<MetricsCoverage, 'search_fail_rate' | 'echo_ctr' | 'note_revisit_rate' | 'export_usage'> {
  const w = windowSums(st, windowStartDay());
  // export_usage（评审案 Q1d）：有效天数 = min(28, 自首记录 added_at 起含首尾天数)；档案空（无记录）→ null
  const fr = st.get('SELECT MIN(added_at) AS first_at FROM collection_record WHERE user_id = ?').get(userId) as Row | undefined;
  const firstAt = cell(fr ?? {}, 'first_at');
  let exportUsage: number | null = null;
  if (typeof firstAt === 'string' && firstAt !== '') {
    const firstMs = Date.parse(firstAt);
    if (Number.isFinite(firstMs)) {
      const ageDays = Math.max(1, Math.floor((Date.now() - firstMs) / 86_400_000) + 1);
      exportUsage = w.export_days / Math.min(WINDOW_DAYS, ageDays);
    }
  }
  return {
    search_fail_rate: w.search_total > 0 ? w.search_fail / w.search_total : null,
    echo_ctr: w.echo_shown > 0 ? w.echo_click / w.echo_shown : null,
    note_revisit_rate: w.detail_view > 0 ? w.note_view / w.detail_view : null,
    export_usage: exportUsage
  };
}

const WINDOW_NOTE = `口径 = 近 ${WINDOW_DAYS} 天窗口（评审案 docs/telemetry-review.md Q1；埋点自 2026-11-15 起累计）`;

/** 观察池六仪表（02 §4：{data}，匿名化 = 仅聚合比率、无个人标识符；空档案 0/0 无定义 → coverage null） */
export function metricsCoverage(st: StmtCache, userId = 'local'): MetricsCoverage {
  const r = (st.get(SQL_COVERAGE).get(userId, userId) as Row | undefined) ?? {};
  const total = Number(cell(r, 'total') ?? 0);
  const covered = Number(cell(r, 'covered') ?? 0);
  const b = behaviorRates(st, userId);
  return {
    coverage: total > 0 ? covered / total : null,
    search_fail_rate: b.search_fail_rate,
    named_view_rate: namedViewRate(st, userId),
    echo_ctr: b.echo_ctr,
    note_revisit_rate: b.note_revisit_rate,
    export_usage: b.export_usage,
    generated_at: nowIso(),
    notes: {
      ...(b.search_fail_rate === null ? { search_fail_rate: `窗口内无搜索（429/422 不计 = 搜索未发生）。${WINDOW_NOTE}` } : {}),
      ...(b.echo_ctr === null ? { echo_ctr: `窗口内无回响卡曝光（echoToday 未命中或曝光后无点击）。${WINDOW_NOTE}` } : {}),
      ...(b.note_revisit_rate === null ? { note_revisit_rate: `窗口内无详情页视图。${WINDOW_NOTE}` } : {}),
      ...(b.export_usage === null ? { export_usage: '档案为空（无记录），导出使用率无定义。' } : {})
    }
  };
}
