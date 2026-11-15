/**
 * atlas.ts —— /atlas 页面模板（DR-M2/M3 宿主验收面 · R-106 Album Atlas 未来落点的机制底稿）。
 *
 * 本页无用户数据——全静态模板（hono/html tagged-template 自动转义照常；html.ts 纪律：
 * raw 仅限其文件内静态 SVG/DOCTYPE，本页零 raw）。globe-view 岛屿 = 渐进增强：
 * 无 JS 时 noscript 回退文案照常可读（main.ts 岛屿加载器失败不拖垮页面的三态原则）。
 * 页脚静态归因 = MapLibre BSD-3-Clause 义务 + Natural Earth 公有领域披露
 * （评审案 5db47b4 §5 第 2/3 条：attributionControl: false，归因文案由本页承载，零外部资源）。
 */
import { html } from 'hono/html';
import { layout, siteHeader, type LayoutOptions } from '../html';

export function renderAtlas(layoutOpts: Omit<LayoutOptions, 'body'>): ReturnType<typeof layout> {
  const body = html`${siteHeader('', html`<a class="btn btn-primary" href="/">← Collection</a>`)}
<main class="atlas-page">
  <h1 style="font-family:var(--font-display); font-size:28px; margin-bottom:6px;">Album Atlas</h1>
  <p class="small" style="color:var(--color-muted-foreground); max-width:640px;">
    地球底图骨架：自托管国家边界（Natural Earth 110m · 177 国）+ 五态染色（feature-state 数据表达式）
    + 主题切换（奶油纸面 / 暗色）。专辑维度接线（产地/国籍/发行地区 → 可用性白名单与 URL 即状态）
    归 R-106 后续评审——本页是机制底稿与验收面。
  </p>
  <div class="globe-view" data-island="globe-view" data-theme="light" role="img" aria-label="专辑地图骨架：自托管国家边界地球"></div>
  <noscript>
    <p class="small" style="color:var(--color-muted-foreground); margin-top:var(--space-md);">
      地图需要 JavaScript（渐进增强岛屿）。你的档案数据不受影响——返回 <a href="/">Collection</a> 继续检索与整理。
    </p>
  </noscript>
  <p class="small atlas-attribution">
    国界数据 © Natural Earth（公有领域）· 渲染引擎 MapLibre GL JS © MapLibre contributors（BSD-3-Clause）
  </p>
</main>`;
  return layout({ ...layoutOpts, body });
}
