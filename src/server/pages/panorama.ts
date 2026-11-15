/**
 * panorama.ts —— 收藏全景页（R-106 · S2-13/S2-14，评审案 docs/design-refs-review.md Q6/Q7）。
 * 设计参考 Album Atlas®（S2-8 产物级拆解）：专辑集合 = 可漫游的空间；载体 = Canvas 2D
 * （Q6 决策：LOD 主色圆点→封面缩略图达成「数千同屏」，零新依赖；InstancedMesh 的性能
 * 问题域由 LOD + 可见区按需取图等效解决）。数据 = /fragment/panorama-data 服务端预计算
 * （S2-12 decade×流派布局）；noscript 诚实降级（Canvas 无 JS 不可用是物理事实，不伪造）。
 * 命名注记：/atlas 已被并行会话 DR globe 页占用（routes/atlas.ts 在制品，19:40）——
 * 本页改称 panorama=收藏全景（评审案 Q1′ 披露），概念仍是 R-106 专辑空间漫游。
 */
import { html } from 'hono/html';
import { emptyWall, errorStrip, sensoryToggle, siteHeader, type LayoutOptions, layout } from '../html';

export function renderPanorama(
  props: { hasRecords: boolean; sensoryOn: boolean; error: string | null },
  layoutOpts: Omit<LayoutOptions, 'body'>
): ReturnType<typeof html> {
  const tools = html`<span style="margin-left:auto; display:flex; gap:var(--space-sm); align-items:center;">
    <a class="btn btn-primary" href="/">← Collection</a>
    ${sensoryToggle(props.sensoryOn, '/panorama')}
  </span>`;
  const header = html`${siteHeader('', tools)}`;
  if (props.error !== null) {
    return layout({
      ...layoutOpts,
      body: html`${header}<main class="page">${errorStrip(props.error, '/panorama')}</main>`
    });
  }
  if (!props.hasRecords) {
    return layout({
      ...layoutOpts,
      body: html`${header}<main class="page">
      ${emptyWall('全景还没有展品——记录的每一张都会在这里找到自己的位置。', html`<a class="btn btn-primary" href="/add">去记录一张</a>`)}
      </main>`
    });
  }
  const body = html`${header}<main class="page">
  <div class="page-intro">
    <h1>你的收藏全景</h1>
    <p class="small">横是年代，纵是流派——拖动漫游，滚轮推近看封面，点一下进详情。</p>
  </div>
  <div class="panorama-stage" data-island="panorama-view" tabindex="0" aria-label="收藏全景——拖动平移，滚轮缩放，点击封面进详情">
    <canvas class="panorama-canvas"></canvas>
    <noscript>
      <div class="panorama-noscript">
        <p>全景漫游需要 JavaScript（Canvas 视图，物理事实不伪造）。</p>
        <p class="small">你的档案一切照旧：<a href="/">回封面墙</a> · <a href="/crate">翻箱</a> · <a href="/genres">流派星图</a> 全程无 JS 可用。</p>
      </div>
    </noscript>
  </div>
  <p class="small panorama-hint">方向键平移 · +/− 缩放 · 点击封面进详情 · 视图位置在地址栏，可分享可后退。</p>
  </main>`;
  return layout({ ...layoutOpts, body });
}
