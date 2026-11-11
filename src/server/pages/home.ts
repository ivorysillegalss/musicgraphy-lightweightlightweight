// 首页（W1 无 JS 垂直切片，V4 渐进增强基线）：
// 搜索 = 原生 GET form → 候选内嵌添加 = 原生 POST + 303；网格 = SSR 直出。
// 视觉为骨架级；W2 按 07-前端设计包 tokens 重绘。
import { html } from 'hono/html';
import type { Stats } from '../db/types';
import type { CollectionItem } from '../db/types';
import type { AlbumCandidate } from '../metadata/musicbrainz';

export interface HomeItem extends CollectionItem {
  cover_src: string | null;
}

export interface HomePageData {
  stats: Stats;
  q: string | null;
  items: HomeItem[];
  nextCursor: string | null;
  candidates: AlbumCandidate[] | null;
  notice: string | null;
}

const coverCell = (it: HomeItem) => {
  const hue = it.cover_color === null ? 30 : (it.cover_color - 1) * 22.5;
  const cover =
    it.cover_src !== null
      ? html`<img class="cover" src="${it.cover_src}" loading="lazy" alt="${it.album.title}" />`
      : html`<div class="cover ph" style="background:hsl(${hue},32%,46%)">${it.album.title.slice(0, 1)}</div>`;
  return html`
    <div class="cell">
      ${cover}
      <p class="cap">
        ${it.album.title}<br />
        <span class="artist">${it.album.artist}${it.album.release_year === null ? '' : ` · ${String(it.album.release_year)}`}</span>
      </p>
    </div>`;
};

const candidateRow = (cd: AlbumCandidate) =>
  html`
    <div class="cand">
      <p class="cand-meta">
        <strong>${cd.title}</strong> · ${cd.artist}${cd.release_year === null ? '' : ` · ${String(cd.release_year)}`}
        ${cd.in_collection ? html`<span class="badge">已在 Collection</span>` : ''}
      </p>
      ${cd.in_collection
        ? ''
        : html`
      <form method="post" action="/add" class="add-form">
        <input type="hidden" name="source" value="${cd.source}" />
        <input type="hidden" name="source_id" value="${cd.source_id}" />
        <input type="hidden" name="title" value="${cd.title}" />
        <input type="hidden" name="artist" value="${cd.artist}" />
        <input type="hidden" name="release_year" value="${cd.release_year === null ? '' : String(cd.release_year)}" />
        <input type="hidden" name="cover_url" value="${cd.cover_url ?? ''}" />
        <button type="submit">添加</button>
      </form>`}
    </div>`;

export function renderHome(d: HomePageData) {
  const nextHref =
    d.nextCursor === null ? null : `/?cursor=${encodeURIComponent(d.nextCursor)}${d.q === null ? '' : `&q=${encodeURIComponent(d.q)}`}`;
  return html`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Musicgraphy</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; color: #2b2622; padding: 0 1rem; }
    h1 { font-size: 1.4rem; margin: 0; }
    .top { display: flex; align-items: baseline; gap: 1.5rem; flex-wrap: wrap; }
    .stats { color: #8a8078; font-size: .85rem; }
    .search { margin: 1.2rem 0; display: flex; gap: .5rem; }
    .search input { flex: 1; padding: .55rem; border: 1px solid #d8d0c8; border-radius: 8px; font-size: 1rem; }
    .search button, .add-form button { padding: .5rem 1.1rem; border: 1px solid #d8d0c8; background: #fff; border-radius: 8px; cursor: pointer; }
    .notice { background: #fdf3e7; border: 1px solid #ecd9bd; border-radius: 8px; padding: .6rem .9rem; margin: .8rem 0; }
    .cand { display: flex; align-items: center; justify-content: space-between; gap: 1rem; border-bottom: 1px dashed #e5ddd4; padding: .5rem 0; }
    .cand-meta { margin: 0; }
    .badge { background: #eee6da; border-radius: 6px; padding: .1rem .5rem; font-size: .8rem; color: #6b6259; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px; margin-top: 1.4rem; }
    .cover { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; display: block; }
    .ph { display: flex; align-items: center; justify-content: center; font-size: 2.2rem; color: rgba(255,255,255,.9); }
    .cap { font-size: .82rem; margin: .35rem 0 0; line-height: 1.35; }
    .artist { color: #8a8078; }
    .more { display: inline-block; margin: 1.4rem 0 3rem; color: #6b6259; }
  </style>
</head>
<body>
  <header class="top">
    <h1>Musicgraphy</h1>
    <span class="stats">${String(d.stats.records)} 张记录 · ${String(d.stats.favorites)} 收藏 · ${String(d.stats.tags)} 标签</span>
  </header>

  <form class="search" method="get" action="/">
    <input id="global-search" type="search" name="q" value="${d.q ?? ''}" placeholder="搜索专辑 / 艺术家（粘贴识别在 W2）" autocomplete="off" />
    <button type="submit">搜索</button>
  </form>

  ${d.notice === null ? '' : html`<p class="notice">${d.notice}</p>`}
  ${d.candidates === null ? '' : (d.candidates.length === 0 ? html`<p class="notice">没有找到匹配的专辑。</p>` : html`<section>${d.candidates.map(candidateRow)}</section>`)}

  <section class="grid">
    ${d.items.length === 0 ? html`<p class="notice">档案还是空的——用上面的搜索添加第一张专辑。</p>` : d.items.map(coverCell)}
  </section>

  ${nextHref === null ? '' : html`<a class="more" href="${nextHref}">下一页 →</a>`}
  <script src="/static/main.js" defer></script>
</body>
</html>`;
}
