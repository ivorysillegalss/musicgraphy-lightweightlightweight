/**
 * crate.ts —— 翻箱页（R-108 · S2-21/S2-22，评审案 docs/design-refs-review.md Q5）。
 * 设计参考 cratedigger.js（S2-10 源码级拆解）：实物感来自「薄盒 + 状态机 + 缓动」而非 3D 精度
 * ——CSS 3D 侧脊陈列（窄裁切封面 / 无封面 = 主色竖排书脊），四态状态机 v1 两态映射
 * （rest 半压微倾 / focused 正立居中），「抽出看正面」= 跳详情页（不建第二套数据）。
 * 无 JS 基线：strip = 原生横向 scroll + `<a>` 链接全可用；crate-flip 岛屿纯增强。
 */
import { html } from 'hono/html';
import { colorOf, coverSrcOf, emptyWall, errorStrip, sensoryToggle, siteHeader, type LayoutOptions, layout } from '../html';
import type { CollectionItem } from '../db/types';

/** 单张侧脊（cratedigger 薄盒的 CSS 翻译：封面窄切片；无封面 = 主色书脊竖排标题——诚实占位） */
function spineCard(it: CollectionItem): ReturnType<typeof html> {
  const color = colorOf(it.cover_color);
  const src = coverSrcOf(it);
  const media =
    src !== null
      ? html`<img class="spine-img" src="${src}" alt="" loading="lazy" decoding="async">`
      : html`<span class="spine-fallback" style="background:linear-gradient(160deg, color-mix(in srgb, var(--swatch-${color?.varName ?? 'gray'}) 72%, #6b6560), color-mix(in srgb, var(--swatch-${color?.varName ?? 'gray'}) 45%, #221f1d));"><span class="spine-vtext">${it.album.title}</span></span>`;
  return html`<a class="spine" data-id="${it.id}" href="/album/${it.id}" title="${it.album.title} · ${it.album.artist}">
  ${media}
  <span class="spine-label">${it.album.title}</span>
</a>`;
}

/** 续箱片段（/fragment/crate：wall-scroll 同族——cursor 服务端顺链，data-next 透传） */
export function crateMoreFragment(items: CollectionItem[], nextCursor: string | null): ReturnType<typeof html> {
  return html`<div class="crate-more" data-next="${nextCursor ?? ''}">${items.map((it) => spineCard(it))}</div>`;
}

export function renderCrate(
  props: {
    items: CollectionItem[];
    hasNext: boolean;
    nextCursor: string | null;
    sensoryOn: boolean;
    error: string | null;
  },
  layoutOpts: Omit<LayoutOptions, 'body'>
): ReturnType<typeof html> {
  const tools = html`<span style="margin-left:auto; display:flex; gap:var(--space-sm); align-items:center;">
    ${props.items.length > 0 ? html`<a class="btn btn-secondary" href="/random" title="随机抽一张——翻箱的遇见感">随机一张</a>` : ''}
    <a class="btn btn-primary" href="/">← Collection</a>
    ${sensoryToggle(props.sensoryOn, '/crate')}
  </span>`;
  const header = html`${siteHeader('', tools)}`;
  if (props.error !== null) {
    return layout({
      ...layoutOpts,
      body: html`${header}<main class="page">${errorStrip(props.error, '/crate')}</main>`
    });
  }
  if (props.items.length === 0) {
    return layout({
      ...layoutOpts,
      body: html`${header}<main class="page">
      ${emptyWall('箱子还是空的——先记录第一张，箱子才有得翻。', html`<a class="btn btn-primary" href="/add">去记录一张</a>`)}
      </main>`
    });
  }
  const body = html`${header}<main class="page">
  <div class="page-intro">
    <h1>这是你自己的箱子</h1>
    <p class="small">翻到的都是你留下来的。← → 翻动 · Enter 抽出细看 · R 随机一张${props.hasNext ? ' · 本箱翻完自动续' : ''}。</p>
  </div>
  <div class="crate-strip" data-island="crate-flip" data-next-cursor="${props.nextCursor ?? ''}" tabindex="0" aria-label="翻箱浏览——方向键翻动，Enter 打开当前唱片">
    ${props.items.map((it) => spineCard(it))}
  </div>
  </main>`;
  return layout({ ...layoutOpts, body });
}
