// 观察池仪表域（PRD §6 六埋点 + 02 §4 metrics 行；自 dao.ts 外拆保持 G3<200——域文件委托先例 = associations/writes）
// coverage = 线索覆盖率（≥1 根线索 Note/Tag/听期的记录占比，北极星，SQL_COVERAGE 实算）；
// named_view_rate = 命名视图周人均新建数（P1-10 saved_views 表落地后实算，2026-11-14 用户批准——SQL_NAMED_VIEW）；
// 其余行为类四项（search_fail_rate / echo_ctr / note_revisit_rate / export_usage）无埋点数据源 → null：
//   search_fail_rate 无搜索会话日志表；echo_ctr / note_revisit_rate / export_usage 为曝光-点击-会话级行为事件，
//   现有表不承载——埋点属 W8-9 行为层，接线前不伪造数字（notes 逐项说明）。
import { nowIso, type Row, type StmtCache } from './sql';
import { SQL_COVERAGE, SQL_NAMED_VIEW, SQL_STATS } from './queries';
import { cell, type MetricsCoverage, type Stats } from './types';

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

/** 观察池六仪表（02 §4：{data}，匿名化 = 仅聚合比率、无个人标识符；空档案 0/0 无定义 → coverage null） */
export function metricsCoverage(st: StmtCache, userId = 'local'): MetricsCoverage {
  const r = (st.get(SQL_COVERAGE).get(userId, userId) as Row | undefined) ?? {};
  const total = Number(cell(r, 'total') ?? 0);
  const covered = Number(cell(r, 'covered') ?? 0);
  return {
    coverage: total > 0 ? covered / total : null,
    search_fail_rate: null,
    named_view_rate: namedViewRate(st, userId),
    echo_ctr: null,
    note_revisit_rate: null,
    export_usage: null,
    generated_at: nowIso(),
    notes: {
      search_fail_rate: '无搜索会话日志表，埋点属 W8-9 行为层',
      echo_ctr: '无卡片曝光/点击事件记录，埋点属 W8-9 行为层',
      note_revisit_rate: '无详情页个人区回访事件记录，埋点属 W8-9 行为层',
      export_usage: '无导出会话事件记录，埋点属 W8-9 行为层'
    }
  };
}
