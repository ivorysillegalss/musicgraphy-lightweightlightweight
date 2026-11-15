/**
 * html.ts —— SSR 呈现助手（pages 域专用，ADR-003）。
 *
 * 模板 = hono/html 内置 tagged-template（自动转义，复审 V9——不引模板引擎、不自写转义）。
 * 本文件只放**跨页面共享**的呈现件：布局/页头/封面卡/回响卡/三态/flash/图标/主色表。
 * 页面私有片段（筛选舱、详情双区、添加弹层）在 pages/*.ts 组装。
 *
 * 上下文纪律（ADR-003 V9 评审清单）：禁 raw() 插用户数据——raw 仅用于本文件内的
 * 静态 SVG path 与 DOCTYPE；所有插值默认转义；URL 插值仅相对路径。
 *
 * 设计系统 Source of Truth：文档包 07-前端设计包/design-system/musicgraphy/MASTER.md
 * （tokens.css/app.css 为其代码实现；组件规格 = 01-设计系统PRD.md §5 的 C-* 编号）。
 */
import { html, raw } from 'hono/html';
// HtmlEscapedString 类型未从 hono/html re-export（插值含 Promise 时运行时 async 摊平）——从标签派生最稳
type HtmlEscapedString = ReturnType<typeof html>;
import { existsSync } from 'node:fs';
import type { CollectionItem } from './db/types';

// ---------------------------------------------------------------- D3 主色映射

/**
 * CoverColor(1..16) → 色板映射（MASTER.md「封面主色数据色板」）。
 * 有效值 1–15；16 为保留值（渲染按灰兜底，UI 不发明新色）。
 * 存储层只存整数；本表是整数的唯一展示事实源。
 */
const COLOR_TABLE: Record<number, { varName: string; label: string }> = {
  1: { varName: 'red', label: '红' },
  2: { varName: 'orange', label: '橙' },
  3: { varName: 'amber', label: '琥珀' },
  4: { varName: 'yellow', label: '黄' },
  5: { varName: 'lime', label: '黄绿' },
  6: { varName: 'green', label: '绿' },
  7: { varName: 'teal', label: '青' },
  8: { varName: 'blue', label: '蓝' },
  9: { varName: 'indigo', label: '靛' },
  10: { varName: 'purple', label: '紫' },
  11: { varName: 'magenta', label: '品红' },
  12: { varName: 'brown', label: '棕' },
  13: { varName: 'gray', label: '灰' },
  14: { varName: 'black', label: '黑' },
  15: { varName: 'white', label: '白' }
};

export function colorOf(n: number | null): { varName: string; label: string } | null {
  if (n === null) return null;
  return COLOR_TABLE[n] ?? { varName: 'gray', label: '灰' };
}

// ---------------------------------------------------------------- 图标（Lucide SVG 内联，禁 emoji）

const ICON_PATHS: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  quote:
    '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h1c1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h1c1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>',
  note:
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'
};

export function icon(name: string, size = 16, filled = false): HtmlEscapedString {
  const paths = ICON_PATHS[name] ?? '';
  const stroke = filled
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
  return html`<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${raw(stroke)} aria-hidden="true">${raw(paths)}</svg>`;
}

// ---------------------------------------------------------------- 封面来源（流式：/covers/ 磁盘缓存或外部 URL；禁 base64，ADR-005 纪律②③）

export const coverSrcOf = (it: CollectionItem): string | null =>
  it.album.cover_local !== null ? `/covers/${it.album.cover_local}` : it.album.cover_url;

// ---------------------------------------------------------------- 构建产物解析（vite 固定名产物：src/client/main.ts → main.js + assets/main.css）

let assetsReady: boolean | null = null;

/** 未构建时返回 null——页面照常 SSR（无 JS 基线 P0，V4）；构建存在才挂 JS/CSS。 */
function asset(kind: 'js' | 'css'): string | null {
  if (assetsReady === null) assetsReady = existsSync('dist/static/main.js');
  if (!assetsReady) return null;
  return kind === 'js' ? '/static/main.js' : '/static/assets/main.css';
}

// ---------------------------------------------------------------- 布局

export interface LayoutOptions {
  title: string;
  /** body 内容（pages/*.ts 组装）。 */
  body: HtmlEscapedString;
}

export function layout(opts: LayoutOptions): HtmlEscapedString {
  const js = asset('js');
  const css = asset('css');
  return html`${raw('<!DOCTYPE html>')}<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${opts.title}</title>
${css === null ? html`${raw('<!-- [assets] vite 产物缺失：npm run build 后加载样式/岛屿 -->')}` : html`<link rel="stylesheet" href="${css}">`}
</head>
<body>
${opts.body}
${siteFooter()}
<div data-island="keyboard-flow" hidden aria-hidden="true"></div>
${js === null ? '' : html`<script type="module" src="${js}"></script>`}
</body>
</html>`;
}

// ---------------------------------------------------------------- 页脚（P1-3 导出入口 · PRD §6 观察池仪表 · W11 赞助插座；样式内联零 CSS 增量——IM-14 预算观察项）

/**
 * 数据主权入口（永久免费红线）+ 观察池仪表入口（04B §3：自托管匿名计数、可关闭）
 * + 设计参考三视图入口（R-106/R-108/R-109 · S2-16 文案层：第一人称档案馆口吻——「再逛逛你的箱子」）
 * + 赞助插座（W11 批，W10-12-1；04B §4 常设插座：一行字姿态——零打扰、无弹窗、无进度条、无目标金额公示）。
 * ⚠️ 链接 href="#" 为占位：上线前由用户替换为 GitHub Sponsors / 爱发电真实链接（发布物料包登记项，
 * agent 备料不代发——用户 2026-11-14 裁决「landing 上线与全渠道发布 = 用户亲手」同款纪律）。
 */
export function siteFooter(): HtmlEscapedString {
  return html`<footer class="site-footer" style="border-top:1px solid var(--color-border); margin-top:var(--space-2xl); padding:var(--space-lg) var(--space-lg) var(--space-3xl); display:flex; flex-wrap:wrap; gap:var(--space-md); align-items:baseline; color:var(--color-muted-foreground);">
  <span class="small">你的档案，随时带得走（永久免费）：</span>
  <a class="btn-text" href="/api/v1/export?format=json">导出 JSON</a>
  <a class="btn-text" href="/api/v1/export?format=csv">导出 CSV</a>
  <a class="btn-text" href="/api/v1/export?with_covers=1">含封面 zip</a>
  <span class="small" style="margin-left:auto;"><a class="btn-text" href="/metrics">观察池仪表</a></span>
  <span class="small" style="flex-basis:100%;">再逛逛你自己的箱子：<a class="btn-text" href="/crate">翻箱</a> · <a class="btn-text" href="/genres">流派星图</a> · <a class="btn-text" href="/panorama">收藏全景</a></span>
  <span class="small" style="flex-basis:100%;">Musicgraphy 永远免费。如果它帮到了你，<a class="btn-text" href="#" title="上线前由站长配置 GitHub Sponsors / 爱发电链接">请我喝杯咖啡</a>。</span>
</footer>`;
}

// ---------------------------------------------------------------- 感官层开关（S2-17 · R-107，评审案 Q8）

/**
 * 感官层（动效/缓动/未来的声音层）统一开关：mg_sensory cookie，缺省 = 低动静音（隐私+不打扰红线），
 * on = 允许缓动。metrics/toggle 先例同款：无表、POST+303、sameOrigin（路由在 pages.ts）。
 * CSS 过渡全部键在 body[data-sensory="on"] 下（岛屿挂载时写属性；SSR 默认无属性 = 低动）。
 */
export function sensoryToggle(on: boolean, to: string): HtmlEscapedString {
  return html`<form class="sensory-toggle" method="post" action="/settings/sensory">
  <input type="hidden" name="to" value="${to}">
  <input type="hidden" name="action" value="${on ? 'off' : 'on'}">
  <button class="btn btn-secondary sensory-btn" type="submit" title="控制翻箱/全景的缓动过渡与未来的动效/声音层（默认安静）">${on ? '感官层 开·点此调回安静' : '感官层 关·点此开启缓动'}</button>
</form>`;
}

// ---------------------------------------------------------------- 页头（C-SEARCH 双意图 + 添加入口；弹层标记由 pages/adddialog 提供）

export function siteHeader(q: string, addDialog: HtmlEscapedString): HtmlEscapedString {
  return html`<header class="site-header">
  <a class="brand" href="/">Musicgraphy<small>个人音乐线索库</small></a>
  <div class="searchbar" data-island="search-box">
    ${icon('search')}
    <form action="/" method="get" role="search">
      <input class="input" type="search" name="q" value="${q}" placeholder="搜索专辑、艺术家、Tag，或粘贴链接 / 一句当时……" aria-label="搜索（添加或找回）">
    </form>
    <span class="kbd kbd-hint">/</span>
  </div>
  ${addDialog}
</header>`;
}

// ---------------------------------------------------------------- 封面卡（C-COVER：1:1 防 CLS、hover meta、♥/色点 = 个人数据）

export interface CoverCardItem {
  recordId: string;
  title: string;
  artist: string;
  releaseYear: number | null;
  coverSrc: string | null;
  coverColor: number | null;
  isFavorite: boolean;
}

function coverFallback(title: string, varName: string): HtmlEscapedString {
  return html`<div class="cover-fallback" style="background:linear-gradient(160deg, color-mix(in srgb, var(--swatch-${varName}) 72%, #6b6560), color-mix(in srgb, var(--swatch-${varName}) 45%, #221f1d));"><span class="cover-title">${title}</span></div>`;
}

export function coverCard(item: CoverCardItem): HtmlEscapedString {
  const color = colorOf(item.coverColor);
  const media =
    item.coverSrc !== null
      ? html`<img class="cover-img" src="${item.coverSrc}" alt="" loading="lazy" decoding="async">`
      : coverFallback(item.title, color?.varName ?? 'gray');
  return html`<a class="cover-card" href="/album/${item.recordId}" aria-label="${item.title} · ${item.artist}">
  <div class="cover">
    ${media}
    <div class="cover-meta"><span class="cover-title">${item.title}</span><span class="cover-artist">${item.artist}${item.releaseYear === null ? '' : ` · ${String(item.releaseYear)}`}</span></div>
    ${item.isFavorite ? html`<span class="cover-fav">${icon('heart', 16, true)}</span>` : ''}
    ${color === null ? '' : html`<span class="cover-dot" style="background:var(--swatch-${color.varName});" title="封面主色：${color.label}"></span>`}
  </div>
</a>`;
}

export function coverWall(items: CoverCardItem[]): HtmlEscapedString {
  return html`<div class="cover-wall">${items.map((it) => coverCard(it))}</div>`;
}

/** 预渲染卡片的墙（collection.ts wallCard 已是 CoverCardItem → 卡片；最小门禁修复 2026-11-12，元数据域会话） */
export function coverWallCards(cards: HtmlEscapedString[]): HtmlEscapedString {
  return html`<div class="cover-wall">${cards}</div>`;
}

// ---------------------------------------------------------------- C-ECHO 回响卡片（P1-1：单卡、无推送、确定性锚）

export function echoCard(item: CollectionItem): HtmlEscapedString {
  const color = colorOf(item.cover_color);
  const src = coverSrcOf(item);
  const cover =
    src !== null
      ? html`<img class="echo-cover" src="${src}" alt="">`
      : html`<div class="echo-cover" style="background:var(--swatch-${color?.varName ?? 'gray'});"></div>`;
  // ?from=echo = W8-9 点击归因（评审案 docs/telemetry-review.md Q1b；query 不加跳步，P1-1「单入口 ≤1 步」不破坏）
  return html`<a class="echo-card" href="/album/${item.id}?from=echo">
  ${cover}
  <div style="flex:1; min-width:0;">
    <div class="mono echo-date">ON THIS DAY · 一年前的今天</div>
    <div style="font-weight:600;">一年前的今天，你留下了《${item.album.title}》${item.note === null ? '' : html`——「${item.note}」`}</div>
  </div>
  ${icon('chevron-right')}
</a>`;
}

// ---------------------------------------------------------------- C-STATE 三态（FR-6 / D-P5：所有数据区共用）

/** loading：骨架占位，保持布局稳定防 CLS。 */
export function skeletonWall(count = 12): HtmlEscapedString {
  return html`<div class="cover-wall" aria-busy="true">${Array.from({ length: count }, () => html`<div class="skeleton"></div>`)}</div>`;
}

/** empty：引语式（档案馆口吻），附唯一恢复动作。 */
export function emptyWall(hint: string, action?: HtmlEscapedString): HtmlEscapedString {
  return html`<div class="empty-state" style="text-align:center; padding: var(--space-3xl);">
  <p class="empty-quote" style="margin:0 auto var(--space-md);">${hint}</p>
  ${action ?? ''}
</div>`;
}

/** error：内联红条 +「你的数据没丢」+ 重试；失败不阻塞。 */
export function errorStrip(message: string, retryHref?: string): HtmlEscapedString {
  return html`<div class="error-strip" role="alert">
  <div style="font-weight:600;">${message}</div>
  <div class="small">已记录的数据都在本地，不受影响。</div>
  ${retryHref === undefined ? '' : html`<a class="btn btn-secondary" style="margin-top: var(--space-sm);" href="${retryHref}">重试</a>`}
</div>`;
}

/** 结果状态行：带语义 live region（FR-2「还剩 N 张」；读屏播报完整短句）。 */
export function resultStatus(count: number, note = 'RECOGNITION VIEW'): HtmlEscapedString {
  return html`<div class="result-status" role="status" aria-atomic="true"><strong>${String(count)} 张匹配</strong> · ${note}</div>`;
}

// ---------------------------------------------------------------- flash / C-DUP（no-JS 基线的结果反馈）

export type FlashKind = 'added' | 'duplicate' | 'error' | 'merged' | null;

export function flashBanner(kind: FlashKind, duplicateHref?: string, relistenAction?: string): HtmlEscapedString {
  if (kind === 'added') {
    return html`<div class="flash flash-ok" role="status">ADDED · 已落库——先添加、稍后补。</div>`;
  }
  if (kind === 'duplicate') {
    return html`<div class="dup-banner" role="alert">
  <div style="flex:1; min-width:220px;">
    <div style="font-weight:600;">已在你 Collection 中</div>
    <div class="small">集合语义（FR-4 D2）：重复添加不会产生第二条记录。</div>
  </div>
  ${duplicateHref === undefined ? '' : html`<a class="btn btn-secondary" href="${duplicateHref}">去补线索</a>`}
  ${relistenAction === undefined ? '' : html`<form method="post" action="${relistenAction}"><button class="btn btn-secondary" type="submit">又听了一次</button></form>`}
</div>`;
  }
  if (kind === 'error') {
    return html`<div class="flash flash-error" role="alert">添加失败——数据未受影响，可重试。</div>`;
  }
  if (kind === 'merged') {
    return html`<div class="flash flash-ok" role="status">TAGS MERGED · Tag 已合并——旧 Tag 消失，引用全部保留（P1-6）。</div>`;
  }
  return html``;
}
