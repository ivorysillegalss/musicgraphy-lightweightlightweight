/**
 * album.ts —— 专辑详情（PG-DETAIL）：外部元数据区 / 个人记录区双区（§4 数据二分的视觉执行）。
 * 个人区 = C-MEMO 记忆条（P1-2 第一人称重组，"当时"= 全页唯一 Playfair Italic）+ 补线索表单
 * （FR-1「先添加、稍后补」合法）。DAO null → 404 引语页；异常 → errorStrip 页。
 */
import { html } from 'hono/html';
import type { CollectionDetail } from '../db/types';
import { coverCard, flashBanner, icon, emptyWall, errorStrip, siteHeader, type FlashKind, type LayoutOptions, layout } from '../html';

export type Esc = ReturnType<typeof html>;

function fmtListened(listenedAt: string | null, precision: string | null): string | null {
  if (listenedAt === null) return null;
  return precision === 'year' ? `${listenedAt.slice(0, 4)} 年` : listenedAt.slice(0, 10);
}

function detailBody(d: CollectionDetail, flash: FlashKind, layoutOpts: Omit<LayoutOptions, 'body'>): Esc {
  const r = d;
  const listened = fmtListened(r.listened_at, r.listened_precision);
  const addedMonth = `${r.added_at.slice(0, 4)} 年 ${r.added_at.slice(5, 7)} 月`;
  const memory = html`<p class="memory-strip">
  ${addedMonth}记录<span class="sep">·</span>${listened === null ? '' : html`听的时期：${listened}<span class="sep">·</span>`}
  ${d.tags.length === 0 ? '' : html`Tags：${d.tags.join(' / ')}<span class="sep">·</span>`}
  ${r.note === null ? html`还没有「当时」——补一句，未来的你会感谢现在的你。` : html`当时：${icon('quote', 14)} <span class="when">${r.note}</span>`}
</p>`;
  const year = new Date().getFullYear();
  const body = html`${siteHeader('', html`<a class="btn btn-primary" href="/add">${icon('plus')}添加</a>`)}
<main>
  ${flashBanner(flash, `/album/${r.id}`, flash === 'duplicate' ? `/album/${r.id}/relisten` : undefined)}
  <a href="/" class="small" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:var(--color-muted-foreground);min-height:44px;">${icon('arrow-left', 14)} 返回 Collection</a>
  <div class="detail-layout" style="margin-top: var(--space-lg);">
    <div class="detail-cover">${coverCard({ recordId: r.id, title: r.album.title, artist: r.album.artist, releaseYear: r.album.release_year, coverSrc: r.album.cover_local !== null ? `/covers/${r.album.cover_local}` : r.album.cover_url, coverColor: r.cover_color, isFavorite: r.is_favorite })}</div>
    <div>
      <h1 style="font-family:var(--font-display); font-size:34px; margin-bottom:4px;">${r.album.title}</h1>
      <p style="font-size:16px; color:var(--color-muted-foreground); margin-bottom: var(--space-md);">${r.album.artist}${r.album.release_year === null ? '' : ` · ${String(r.album.release_year)}`}</p>
      <div class="chip-list" style="margin-bottom: var(--space-lg);">
        ${r.album.genres.map((g) => html`<span class="chip" style="cursor:default; border-style:dashed;" title="Genre = 音乐的公共属性">${g}</span>`)}
        <span class="mono" style="margin-left:6px;">VIA ${r.album.source.toUpperCase()}</span>
      </div>
      <div class="zone">
        <div class="mono zone-title" style="color:var(--color-secondary);">PUBLIC METADATA · 外部元数据（可替换，非资产）</div>
        <table class="meta-table">
          <tbody>
            <tr><th>艺术家</th><td>${r.album.artist}</td></tr>
            <tr><th>发行年份</th><td>${r.album.release_year === null ? '—' : String(r.album.release_year)}</td></tr>
            <tr><th>Genre</th><td>${r.album.genres.length === 0 ? '—' : r.album.genres.join(' / ')}</td></tr>
            <tr><th>来源</th><td>${r.album.source}${r.album.source_id === '' ? '' : ` · ${r.album.source_id}`}</td></tr>
            <tr><th>国家</th><td>${r.album.country ?? '—'}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="zone">
        <div class="mono zone-title" style="color:var(--color-accent-text);">PERSONAL RECORD · 个人记录（你的资产 · 全量可导出）</div>
        ${memory}
        <div class="chip-list" style="margin-top: var(--space-lg);">
          <form method="post" action="/album/${r.id}/favorite" style="display:inline;">
            <button class="btn btn-secondary fav-btn" type="submit" aria-pressed="${r.is_favorite ? 'true' : 'false'}">${icon('heart', 16, r.is_favorite)} ${r.is_favorite ? '已收藏' : 'Favorite'}</button>
          </form>
        </div>
        <details class="note-fold form-row" style="margin-top: var(--space-lg); max-width:520px;">
          <summary>${icon('note', 14)} 补线索——Tag / 当时 / 听的时期（先添加、稍后补）</summary>
          <form method="post" action="/album/${r.id}/update" style="padding: 12px 14px; display:grid; gap: var(--space-md);">
            <div>
              <label class="field-label" for="d-tags">Tag（逗号分隔）</label>
              <input class="input" id="d-tags" name="tags" value="${d.tags.join(', ')}" placeholder="夜晚, 通勤">
            </div>
            <div>
              <label class="field-label" for="d-note">当时（Note）</label>
              <textarea class="input" id="d-note" name="note" style="min-height:72px;" placeholder="为什么留下它？留一句当时……">${r.note ?? ''}</textarea>
            </div>
            <div>
              <label class="field-label" for="d-year">听的时期——年份（留空保持不变）</label>
              <input class="input" id="d-year" name="listened_year" inputmode="numeric" placeholder="如 ${String(year - 3)}" style="max-width:160px;">
            </div>
            <div style="display:flex; justify-content:flex-end;">
              <button class="btn btn-primary" type="submit">保存线索</button>
            </div>
          </form>
        </details>
      </div>
    </div>
  </div>
</main>`;
  return layout({ ...layoutOpts, body });
}

export function renderAlbumDetail(d: CollectionDetail, flash: FlashKind, layoutOpts: Omit<LayoutOptions, 'body'>): Esc {
  return detailBody(d, flash, layoutOpts);
}

export function renderAlbumNotFound(id: string, layoutOpts: Omit<LayoutOptions, 'body'>): Esc {
  const body = html`${siteHeader('', html`<a class="btn btn-primary" href="/add">${icon('plus')}添加</a>`)}
<main>
  ${emptyWall('这条记录不存在——它可能已被移除。', html`<a class="btn btn-secondary" href="/">返回 Collection</a>`)}
  <p class="small" style="text-align:center;">查找的 ID：${id}</p>
</main>`;
  return layout({ ...layoutOpts, body });
}

export function renderAlbumError(layoutOpts: Omit<LayoutOptions, 'body'>): Esc {
  const body = html`${siteHeader('', html`<a class="btn btn-primary" href="/add">${icon('plus')}添加</a>`)}
<main>
  ${errorStrip('详情加载失败——档案服务没有回应。', '/')}
</main>`;
  return layout({ ...layoutOpts, body });
}
