/**
 * suggest.ts —— 搜索候选片段（C-SEARCH 双意图的候选呈现，岛屿 search-box 消费）。
 *
 * GET /fragment/search-suggest?q=…：上半 = 你的档案（本地 LIKE 命中，可点进详情）；
 * 下半 = 外部候选（记录意图，data-mg-add 交给 add-dialog 岛屿确认）。
 * 上游失败/限流 → 静默只显示本地组（FR-3 检索不依赖外部源）；全失败 → 占位文案。
 * 注：hono/html 对一切插值自动转义（复审 V9），此处不做手工转义以免双重转义。
 */
import { html } from 'hono/html';
import type { DAO } from '../db/dao';
import { searchAlbums } from '../metadata/search';
import type { SourceChain } from '../metadata/sources';

export type Esc = ReturnType<typeof html>;

const popItem = (coverSrc: string | null, title: string, sub: string, badge: string | null, action: Esc): Esc =>
  html`<div class="pop-item" role="option">
  ${coverSrc === null ? html`<span class="pop-fallback" aria-hidden="true" style="background:var(--swatch-gray);"></span>` : html`<img src="${coverSrc}" alt="" loading="lazy" decoding="async">`}
  <span class="pop-main"><span class="pop-title">${title}</span><br><span class="pop-sub">${sub}</span></span>
  ${badge === null ? '' : html`<span class="pop-badge">${badge}</span>`}
  ${action}
</div>`;

const actionBtn = (href: string): Esc =>
  html`<a class="btn-text" style="min-height:36px; padding:4px 10px;" href="${href}">打开</a>`;

const addBtn = (cd: { source_id: string; title: string; artist: string; release_year: number | null; cover_url: string | null }): Esc =>
  html`<button class="btn-text" style="min-height:36px; padding:4px 10px;" type="button"
  data-mg-add="${cd.source_id}" data-title="${cd.title}" data-artist="${cd.artist}"
  data-year="${cd.release_year === null ? '' : String(cd.release_year)}" data-cover="${cd.cover_url ?? ''}">添加</button>`;

export async function searchSuggestFragment(dao: DAO, chain: SourceChain, q: string): Promise<Esc> {
  if (q.length < 2) return html`<div class="pop-empty">输入至少 2 个字符——或粘贴 Spotify / RYM 链接。</div>`;

  // 本地组（找回意图）：标题/艺术家/Tag/Note LIKE（FR-3 四件套）；DAO 失败 → 组省略
  let local: Esc | null = null;
  try {
    const page = dao.listPage({ filters: { q }, limit: 6 });
    if (page.items.length > 0) {
      const rows = page.items.map((it) =>
        popItem(
          it.album.cover_local !== null ? `/covers/${it.album.cover_local}` : it.album.cover_url,
          it.album.title,
          `${it.album.artist}${it.album.release_year === null ? '' : ` · ${String(it.album.release_year)}`}`,
          it.is_favorite ? 'FAV' : null,
          actionBtn(`/album/${it.id}`)
        )
      );
      local = html`<div class="pop-group"><div class="pop-head mono">你的档案 · ${String(page.items.length)} 张命中</div>${rows}</div>`;
    }
  } catch {
    local = null;
  }

  // 外部组（记录意图）：searchAlbums 落快照 + in_collection 前置标记（FR-1 捷径③）；
  // 限流/上游失败静默省略——找回不被添加意图阻塞。已收藏的不再重复出现（本地组已覆盖）。
  let external: Esc | null = null;
  try {
    const items = (await searchAlbums(dao, chain, q, 6)).filter((cd) => !cd.in_collection);
    if (items.length > 0) {
      const rows = items.map((cd) =>
        popItem(
          cd.cover_local !== null ? `/covers/${cd.cover_local}` : cd.cover_url,
          cd.title,
          `${cd.artist}${cd.release_year === null ? '' : ` · ${String(cd.release_year)}`}${cd.source === 'musicbrainz' ? '' : ` · VIA ${cd.source.toUpperCase()}`}`,
          null,
          addBtn(cd)
        )
      );
      external = html`<div class="pop-group"><div class="pop-head mono">外部候选 · 添加到档案</div>${rows}</div>`;
    }
  } catch {
    external = null;
  }

  if (local === null && external === null) {
    return html`<div class="pop-empty">档案里没有匹配——试着换个词，或按 Enter 全文检索。</div>`;
  }
  return html`${local ?? ''}${external ?? ''}`;
}
