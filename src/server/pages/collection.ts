/**
 * collection.ts —— Collection 主页模板（PG-COLLECTION：回响区→筛选舱→状态行→封面墙→分页）。
 *
 * URL 即状态（DD3）：筛选条件全在 query string（q/genre/year/period/fav/tag/color/cursor/flash），
 * chips = <a href="?…">、搜索 = GET form——可分享、可回退，无「应用/重置」按钮（FR-2 最不可返工决策）。
 * 计数 = dao.countAxes（轴排除式：每轴剔除自身筛选，FR-2「其余条件计数立即重算」）。
 */
import { html } from 'hono/html';
import type { Filters } from '../db/sql';
import type { CollectionItem, FacetCount } from '../db/types';
import type { AlbumSearchItem } from '../metadata/search';
import { colorOf, coverCard, coverSrcOf, coverWallCards, echoCard, emptyWall, errorStrip, flashBanner, icon, resultStatus, siteHeader, type FlashKind, type LayoutOptions, layout } from '../html';
import { buildAddDialog } from './adddialog';

export type Esc = ReturnType<typeof html>;

// ---------------------------------------------------------------- URL ↔ 筛选状态（DD3 参数命名）

export interface FilterState {
  q: string | null;
  genre: string | null;
  year: number | null;
  period: string | null; // 听的年份 YYYY（「我听的时期」轴，与发行年份绝不共用控件）
  fav: boolean;
  tag: string | null;
  color: number | null;
}

export const EMPTY_FILTER: FilterState = { q: null, genre: null, year: null, period: null, fav: false, tag: null, color: null };

export function parseFilter(p: URLSearchParams): FilterState {
  const year = Number(p.get('year'));
  const color = Number(p.get('color'));
  const period = p.get('period') ?? '';
  return {
    q: p.get('q')?.trim() || null,
    genre: p.get('genre') || null,
    year: Number.isInteger(year) && year > 0 ? year : null,
    period: /^\d{4}$/.test(period) ? period : null,
    fav: p.get('fav') === '1',
    tag: p.get('tag') || null,
    color: Number.isInteger(color) && color >= 1 && color <= 16 ? color : null
  };
}

export type FilterPatch = Partial<FilterState>;

/** FilterState → href（null/false 省略；cursor 由调用方透传）。 */
export function buildHref(f: FilterState, patch: FilterPatch = {}, cursor?: string | null): string {
  const m = { ...f, ...patch };
  const p = new URLSearchParams();
  if (m.q !== null) p.set('q', m.q);
  if (m.genre !== null) p.set('genre', m.genre);
  if (m.year !== null) p.set('year', String(m.year));
  if (m.period !== null) p.set('period', m.period);
  if (m.fav) p.set('fav', '1');
  if (m.tag !== null) p.set('tag', m.tag);
  if (m.color !== null) p.set('color', String(m.color));
  if (cursor) p.set('cursor', cursor);
  const qs = p.toString();
  return qs === '' ? '/' : `/?${qs}`;
}

/** FilterState → DAO Filters（period → listened 年区间；D1 听的时期 = 年份粒度）。 */
export function toDaoFilters(f: FilterState): Filters {
  return {
    ...(f.q !== null ? { q: f.q } : {}),
    ...(f.genre !== null ? { genre: f.genre } : {}),
    ...(f.year !== null ? { year: f.year } : {}),
    ...(f.period !== null ? { listenedFrom: `${f.period}-01-01T00:00:00Z`, listenedTo: `${f.period}-12-31T23:59:59Z` } : {}),
    ...(f.fav ? { favorite: true } : {}),
    ...(f.tag !== null ? { tag: f.tag } : {}),
    ...(f.color !== null ? { color: f.color } : {})
  };
}

export function hasActiveFilter(f: FilterState): boolean {
  return f.q !== null || f.genre !== null || f.year !== null || f.period !== null || f.fav || f.tag !== null || f.color !== null;
}

// ---------------------------------------------------------------- 筛选舱（chips = <a>；0 隐藏；激活 = 深色可单独移除）

type AxisName = 'genre' | 'year' | 'listened' | 'favorite' | 'tag' | 'color';
export type AxisCounts = Partial<Record<AxisName, FacetCount[]>>;

function chipA(label: string, count: number, href: string, active: boolean, swatchVar?: string): Esc {
  const swatch = swatchVar === undefined ? '' : html`<span class="chip-swatch" style="background:var(--swatch-${swatchVar});"></span>`;
  return html`<a class="chip${active ? ' active' : ''}" href="${href}" aria-pressed="${active ? 'true' : 'false'}" rel="nofollow">${swatch}${label} <span class="count">(${String(count)})</span></a>`;
}

export function cabinSection(f: FilterState, counts: AxisCounts | null): Esc {
  const axis = (label: string, chips: Esc[]): Esc =>
    html`<div class="filter-axis"><span class="axis-label">${label}</span><div class="chip-list">${chips}</div></div>`;

  const facetChips = (facets: FacetCount[] | undefined, activeValue: string | number | null, render: (v: string) => { label: string; href: string; swatch?: string }): Esc[] =>
    (facets ?? [])
      .filter((c) => c.value !== null && (c.count > 0 || String(c.value) === String(activeValue)))
      .map((c) => {
        const v = String(c.value);
        const r = render(v);
        return chipA(r.label, c.count, r.href, v === String(activeValue), r.swatch);
      });

  const genreChips = facetChips(counts?.genre, f.genre, (v) => ({
    label: v,
    href: buildHref(f, { genre: f.genre === v ? null : v })
  }));
  const yearChips = facetChips(counts?.year, f.year, (v) => ({
    label: v,
    href: buildHref(f, { year: f.year === Number(v) ? null : Number(v) })
  }));
  // 命名写全：「发行年份（Release）」与「我听的时期（Listened）」并列、绝不共用控件（A3 修正）
  const periodChips = facetChips(counts?.listened, f.period, (v) => ({
    label: `${v} 年听`,
    href: buildHref(f, { period: f.period === v ? null : v })
  }));
  const tagChips = facetChips(counts?.tag, f.tag, (v) => ({
    label: v,
    href: buildHref(f, { tag: f.tag === v ? null : v })
  }));
  const colorChips = facetChips(counts?.color, f.color, (v) => {
    const c = colorOf(Number(v));
    return { label: c?.label ?? '未知', href: buildHref(f, { color: f.color === Number(v) ? null : Number(v) }), swatch: c?.varName };
  });

  const favCount = (counts?.favorite ?? []).find((c) => Number(c.value) === 1)?.count ?? 0;
  const favChips = favCount === 0 && !f.fav ? [] : [chipA('Favorite', favCount, buildHref(f, { fav: !f.fav }), f.fav)];

  // 已激活条件 = 可单独移除的深色 chip（移除即回流，无「应用/重置」按钮）
  const active: Esc[] = [];
  const pushActive = (label: string, patch: FilterPatch, swatchVar?: string): void => {
    const sw = swatchVar === undefined ? '' : html`<span class="chip-swatch" style="background:var(--swatch-${swatchVar});"></span>`;
    active.push(html`<span class="chip active">${sw}${label}<a class="chip-x" href="${buildHref(f, patch)}" aria-label="移除条件 ${label}">${icon('x', 12)}</a></span>`);
  };
  if (f.genre !== null) pushActive(f.genre, { genre: null });
  if (f.year !== null) pushActive(`${String(f.year)}（发行）`, { year: null });
  if (f.period !== null) pushActive(`${f.period} 年听`, { period: null });
  if (f.fav) pushActive('Favorite', { fav: false });
  if (f.tag !== null) pushActive(f.tag, { tag: null });
  if (f.color !== null) pushActive(colorOf(f.color)?.label ?? '未知', { color: null }, colorOf(f.color)?.varName);

  return html`<div class="filter-cabin" role="group" aria-label="渐进式筛选舱">
  <div class="filter-axes">
    ${axis('Genre', genreChips)}
    ${axis('发行年份（Release）', yearChips)}
    ${axis('我听的时期（Listened）', periodChips)}
    ${axis('Favorite', favChips)}
    ${axis('Tag（我的属性）', tagChips)}
    ${axis('颜色（P1-4）', colorChips)}
  </div>
  ${active.length === 0 && f.q === null ? '' : html`<div class="active-chips-row">
    <span class="axis-label">已选</span>
    ${f.q === null ? '' : html`<span class="chip active">「${f.q}」<a class="chip-x" href="${buildHref(f, { q: null })}" aria-label="移除搜索词">${icon('x', 12)}</a></span>`}
    ${active}
    <a class="btn-text" href="${buildHref(EMPTY_FILTER)}">移除全部条件</a>
  </div>`}
</div>`;
}

// ---------------------------------------------------------------- 结果区（状态行 + 封面墙 + 分页；三态）

export function wallCard(it: CollectionItem): ReturnType<typeof coverCard> {
  return coverCard({
    recordId: it.id,
    title: it.album.title,
    artist: it.album.artist,
    releaseYear: it.album.release_year,
    coverSrc: coverSrcOf(it),
    coverColor: it.cover_color,
    isFavorite: it.is_favorite
  });
}

export function resultsSection(items: CollectionItem[], f: FilterState, meta: { has_next: boolean; next_cursor: string | null }, total: number): Esc {
  if (items.length === 0) {
    return emptyWall(
      hasActiveFilter(f) ? '没有符合条件的专辑——也许线索还不够，试着移除一个条件。' : '档案是空的——听到值得留下的专辑，就把它记下来。',
      hasActiveFilter(f) ? html`<a class="btn-text" href="${buildHref(EMPTY_FILTER)}">移除全部条件</a>` : html`<a class="btn btn-primary" href="/add">记录第一张</a>`
    );
  }
  const next =
    meta.has_next && meta.next_cursor !== null
      ? html`<div class="wall-next"><a class="btn btn-secondary" href="${buildHref(f, {}, meta.next_cursor)}" rel="next" data-next>加载下一页</a></div>`
      : '';
  return html`${resultStatus(total)}${coverWallCards(items.map(wallCard))}${next}`;
}

// ---------------------------------------------------------------- 外部候选（记录意图；no-JS 内嵌表单；已收藏前置标记防重复确认）

export function candidateSection(candidates: AlbumSearchItem[], notice: string | null): Esc {
  if (notice !== null) return html`<p class="error-strip" role="alert" style="margin-bottom: var(--space-lg);">${notice}</p>`;
  if (candidates.length === 0) return html``;
  return html`<section style="margin-bottom: var(--space-2xl);">
  <div class="section-title"><span class="mono">EXTERNAL CANDIDATES · 外部候选（不在档案中）</span></div>
  ${candidates.map(
    (cd) => html`<div class="candidate">
    <div class="candidate-main">
      <div class="candidate-title">${cd.title}</div>
      <div class="candidate-sub">${cd.artist}${cd.release_year === null ? '' : ` · ${String(cd.release_year)}`}</div>
    </div>
    ${cd.in_collection ? html`<span class="in-collection">IN YOUR COLLECTION</span>` : html`<form method="post" action="/add" style="display:inline-flex;">
      <input type="hidden" name="source" value="${cd.source}">
      <input type="hidden" name="source_id" value="${cd.source_id}">
      <input type="hidden" name="title" value="${cd.title}">
      <input type="hidden" name="artist" value="${cd.artist}">
      <input type="hidden" name="release_year" value="${cd.release_year === null ? '' : String(cd.release_year)}">
      <input type="hidden" name="cover_url" value="${cd.cover_url ?? ''}">
      <button class="btn btn-secondary" type="submit" style="min-height:36px; padding:6px 14px;">添加</button>
    </form>`}
  </div>`
  )}
</section>`;
}

// ---------------------------------------------------------------- 页面组装

export interface CollectionPageInput {
  flash: FlashKind;
  dupHref: string | null;
  echo: CollectionItem | null;
  filter: FilterState;
  counts: AxisCounts | null;
  items: CollectionItem[];
  meta: { has_next: boolean; next_cursor: string | null };
  total: number | null; // null = 计数失败 → 状态行降级为本页张数
  candidates: AlbumSearchItem[] | null;
  notice: string | null;
  topTags: string[];
  /** 非 null = 数据区 error 三态（舱壳保留，AGENTS §14；漏抛会变 JSON envelope）。 */
  error: string | null;
}

export function renderCollection(d: CollectionPageInput, layoutOpts: Omit<LayoutOptions, 'body'>): Esc {
  const body = html`${siteHeader(d.filter.q ?? '', buildAddDialog(d.topTags))}
<main>
  ${flashBanner(d.flash, d.dupHref ?? undefined, d.flash === 'duplicate' && d.dupHref !== null ? `${d.dupHref}/relisten` : undefined)}
  ${d.echo === null ? '' : echoCard(d.echo)}
  <div data-island="filter-cabin">
    ${cabinSection(d.filter, d.counts)}
    <div class="results">
      ${d.error !== null ? errorStrip(d.error, buildHref(d.filter)) : resultsSection(d.items, d.filter, d.meta, d.total ?? d.items.length)}
    </div>
  </div>
  ${candidateSection(d.candidates ?? [], d.notice)}
  <p class="small" style="margin-top: var(--space-2xl);">URL 即状态：当前筛选可分享、可回退（DD3）。经典找回路径：Genre「Electronic」→ 我听的时期 → 颜色「蓝」。</p>
</main>`;
  return layout({ ...layoutOpts, body });
}
