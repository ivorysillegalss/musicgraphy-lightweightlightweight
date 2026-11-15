/**
 * metrics.ts —— 观察池仪表页（PRD §6 六埋点 · 02 §4 metrics 行；PM §4 W8「观察池仪表，匿名化可关闭」）。
 *
 * 口径（PRD §5 + 04B §3）：统计极简 = 自托管匿名计数（可关闭），不用付费分析栈；
 * 匿名化 = 仅聚合比率、无个人标识符；数据全部本地派生、无任何外发。
 * 「可关闭」= 呈现级开关（POST /metrics/toggle → cookie mg_metrics）：关闭隐藏本页数字呈现；
 * coverage 北极星为档案数据直接聚合（非行为埋点）；行为类四项自 W8-9 立项（2026-11-15，
 * 评审案 docs/telemetry-review.md）起近 28 天窗口实算——窗口内无样本如实 null（勿伪造数字）。
 * 无 JS 基线：开关 = 原生 form POST + 303。
 */
import { html } from 'hono/html';
import type { MetricsCoverage } from '../db/types';
import { emptyWall, errorStrip, siteHeader, type LayoutOptions, layout } from '../html';

export type Esc = ReturnType<typeof html>;

const METRIC_LABELS: Array<{ key: keyof Omit<MetricsCoverage, 'generated_at' | 'notes'>; label: string; hint: string }> = [
  { key: 'coverage', label: '线索覆盖率', hint: '北极星：携带 ≥1 根个人线索（Note/Tag/听期）的记录占比' },
  { key: 'search_fail_rate', label: '搜索失败率', hint: '无结果搜索会话占比——手动建卡是否出观察池' },
  { key: 'named_view_rate', label: '命名视图创建密度', hint: '周人均新建数——Era 语言 / P1-10 价值' },
  { key: 'echo_ctr', label: '回响卡片点击率', hint: '卡片曝光 → 点击——Review 触发器有效性' },
  { key: 'note_revisit_rate', label: '「为什么」回访率', hint: '详情页个人区回访占比——编码价值验证' },
  { key: 'export_usage', label: '导出使用率', hint: '导出会话占比——信任资产；A 方案付费意向代理' }
];

const pct = (v: number): string => `${Math.round(v * 1000) / 10}%`;

function metricCard(m: (typeof METRIC_LABELS)[number], data: MetricsCoverage): Esc {
  const value = data[m.key];
  const note = m.key === 'coverage' ? '' : (value === null ? (data.notes[m.key] ?? '') : '');
  return html`<div class="zone" style="min-width:240px; flex:1;">
  <div class="small" style="color:var(--color-muted-foreground);">${m.label}</div>
  <div style="font-family:var(--font-display); font-size:30px; margin:4px 0;">${
    value === null ? html`<span class="mono" style="font-size:16px; color:var(--color-muted-foreground);">— 暂无数据</span>` : html`${pct(value)}`
  }</div>
  <div class="small" style="color:var(--color-muted-foreground);">${m.hint}${note === '' ? '' : html`<br><span class="mono">${note}</span>`}</div>
</div>`;
}

export function renderMetrics(d: { data: MetricsCoverage | null; closed: boolean }, layoutOpts: Omit<LayoutOptions, 'body'>): Esc {
  const toggleForm = (action: 'open' | 'close', label: string): Esc =>
    html`<form method="post" action="/metrics/toggle" style="display:inline;">
  <input type="hidden" name="action" value="${action}">
  <button class="btn btn-secondary" type="submit">${label}</button>
</form>`;

  const body = html`${siteHeader('', html`<a class="btn btn-primary" href="/">${'← Collection'}</a>`)}
<main>
  <h1 style="font-family:var(--font-display); font-size:28px; margin-bottom:6px;">观察池仪表</h1>
  <p class="small" style="color:var(--color-muted-foreground); max-width:640px;">
    观察池条目只有触发条件、没有日历日期——本页是立项证据来源（PRD §6）。口径：自托管匿名计数（可关闭），
    不用付费分析栈（04B §3）；仅聚合比率、无个人标识符；全部数据本地派生、无任何外发。
  </p>
  ${
    d.closed
      ? html`<div style="margin-top:var(--space-2xl);">
      ${emptyWall('观察池仪表已关闭——统计从未外发，关闭仅隐藏本页的数字呈现。', toggleForm('open', '重新打开'))}
    </div>`
      : d.data === null
        ? html`<div style="margin-top:var(--space-2xl);">${errorStrip('仪表聚合失败——档案服务没有回应。', '/metrics')}</div>`
        : html`<div class="mono small" style="margin-top:var(--space-lg); color:var(--color-muted-foreground);">GENERATED AT · ${d.data.generated_at}</div>
      <div style="display:flex; flex-wrap:wrap; gap:var(--space-md); margin-top:var(--space-md);">
        ${METRIC_LABELS.map((m) => metricCard(m, d.data as MetricsCoverage))}
      </div>
      <div style="margin-top:var(--space-2xl);">${toggleForm('close', '关闭仪表（本页不再显示数字呈现）')}</div>`
  }
</main>`;
  return layout({ ...layoutOpts, body });
}
