// 观察池仪表域（PRD §6 六埋点 + 02 §4 metrics 行；自 dao.ts 外拆保持 G3<200——域文件委托先例 = associations/writes）
// coverage = 线索覆盖率（≥1 根线索 Note/Tag/听期的记录占比，北极星，SQL_COVERAGE 实算）；
// 行为类五项（search_fail_rate / named_view_rate / echo_ctr / note_revisit_rate / export_usage）无埋点数据源 → null：
//   search_fail_rate 无搜索会话日志表；named_view_rate P1-10 命名视图未实现（无表）；
//   echo_ctr / note_revisit_rate / export_usage 为曝光-点击-会话级行为事件，现四表
//   （album_metadata / collection_record / tags / record_tag）不承载——埋点属 W8-9 行为层，接线前不伪造数字（notes 逐项说明）。
import { nowIso, type Row, type StmtCache } from './sql';
import { SQL_COVERAGE, SQL_STATS } from './queries';
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

/** 观察池六仪表（02 §4：{data}，匿名化 = 仅聚合比率、无个人标识符；空档案 0/0 无定义 → coverage null） */
export function metricsCoverage(st: StmtCache, userId = 'local'): MetricsCoverage {
  const r = (st.get(SQL_COVERAGE).get(userId, userId) as Row | undefined) ?? {};
  const total = Number(cell(r, 'total') ?? 0);
  const covered = Number(cell(r, 'covered') ?? 0);
  return {
    coverage: total > 0 ? covered / total : null,
    search_fail_rate: null,
    named_view_rate: null,
    echo_ctr: null,
    note_revisit_rate: null,
    export_usage: null,
    generated_at: nowIso(),
    notes: {
      search_fail_rate: '无搜索会话日志表，埋点属 W8-9 行为层',
      named_view_rate: 'P1-10 命名视图未实现（无数据表），埋点属 W8-9 行为层',
      echo_ctr: '无卡片曝光/点击事件记录，埋点属 W8-9 行为层',
      note_revisit_rate: '无详情页个人区回访事件记录，埋点属 W8-9 行为层',
      export_usage: '无导出会话事件记录，埋点属 W8-9 行为层'
    }
  };
}
