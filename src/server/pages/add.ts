/**
 * add.ts —— GET /add 添加表单页（无 JS 基线，V4 P0：I3「≤3 步/15s」不押在 JS 上）。
 * 弹层（岛屿）是同一 POST /add 通道的增强形态；本页 = JS 不可用时的完整回退路径。
 */
import { html } from 'hono/html';
import { flashBanner, icon, siteHeader, type FlashKind, type LayoutOptions, layout } from '../html';

export function renderAddPage(flash: FlashKind, layoutOpts: Omit<LayoutOptions, 'body'>): ReturnType<typeof layout> {
  const year = new Date().getFullYear();
  const body = html`${siteHeader('', html`<a class="btn btn-primary" href="/add">${icon('plus')}添加</a>`)}
<main>
  ${flashBanner(flash)}
  <div class="section-title"><h1>记录一张专辑</h1><span class="mono">FR-1 · 默认态即完成态</span></div>
  <form action="/add" method="post" style="max-width:520px;">
    <div class="form-row">
      <label class="field-label" for="a-title">专辑标题 *</label>
      <input class="input" id="a-title" name="title" required placeholder="Blue Lines">
    </div>
    <div class="form-row">
      <label class="field-label" for="a-artist">艺术家 *</label>
      <input class="input" id="a-artist" name="artist" required placeholder="Massive Attack">
    </div>
    <div class="form-row">
      <label class="field-label" for="a-source-id">外部 ID（MusicBrainz release ID；手头没有可留空会以标题+艺术家识别）</label>
      <input class="input" id="a-source-id" name="source_id" placeholder="mbid:…">
    </div>
    <div class="form-row">
      <label class="field-label" for="a-year">发行年份</label>
      <input class="input" id="a-year" name="release_year" inputmode="numeric" style="max-width:160px;" placeholder="${String(year)}">
    </div>
    <div class="form-row">
      <label class="field-label" for="a-tags">Tag（逗号分隔）</label>
      <input class="input" id="a-tags" name="tags" placeholder="夜晚, 通勤">
    </div>
    <details class="note-fold form-row">
      <summary>${icon('note', 14)} 为什么留下它？留一句当时……（可跳过）</summary>
      <textarea name="note" placeholder="例：青旅的天台，海边的夏天。"></textarea>
    </details>
    <div class="form-row">
      <label class="field-label" for="a-listened">听的时期——大概哪一年？（可跳过；默认 = 记录时间）</label>
      <input class="input" id="a-listened" name="listened_year" inputmode="numeric" style="max-width:160px;" placeholder="如 ${String(year - 3)}">
    </div>
    <div class="form-row">
      <label style="display:inline-flex; align-items:center; gap:8px; font-weight:600;">
        <input type="checkbox" name="favorite" value="1" style="width:18px; height:18px;"> Favorite
      </label>
    </div>
    <div style="display:flex; gap: var(--space-md); justify-content:flex-end;">
      <a class="btn btn-secondary" href="/">稍后补</a>
      <button class="btn btn-primary" type="submit">添加（默认即完成）</button>
    </div>
  </form>
  <p class="small" style="margin-top: var(--space-lg); max-width:520px;">提示：更快的方式是在顶部搜索框粘贴 Spotify / RYM 链接或输入「艺术家 - 专辑」，从候选一键添加。</p>
</main>`;
  return layout({ ...layoutOpts, body });
}
