/**
 * adddialog.ts —— C-ADD 添加弹层的 SSR 标记（FR-1 确认层三件套）。
 *
 * 无 JS 基线（ADR-003 V4）：trigger 是 <a href="/add">（去表单页）；<dialog> 仅在有 JS
 * 时由 add-dialog 岛屿打开——I3「≤3 步/15s」不押在 JS 上。弹层内表单 = 原生 POST /add
 * （与无 JS 表单同通道、同落库路径），默认态 = 完成态：点击「添加」即落库，
 * 补充字段（Favorite/Tag/Note/听期）全部不阻塞关闭。
 */
import { html } from 'hono/html';
import { icon } from '../html';

/** 零输入态提示（最近搜索词/艺术家候选需外部源，DAO 契约无此数据——诚实占位）。 */
const HINT = '粘贴 Spotify / Bandcamp / RYM 链接，或输入艺术家 - 专辑';

export function buildAddDialog(topTags: string[]): ReturnType<typeof html> {
  const year = new Date().getFullYear();
  return html`<div data-island="add-dialog">
  <a class="btn btn-primary" href="/add">${icon('plus')}添加</a>
  <dialog class="dialog" aria-label="记录一张专辑">
    <button class="dialog-close" type="button" data-close aria-label="关闭">${icon('x', 18)}</button>
    <h2>记录一张专辑</h2>
    <div class="form-row">
      <label class="field-label" for="dialog-find">候选（${HINT}）</label>
      <input class="input" id="dialog-find" name="find" type="search" autocomplete="off" placeholder="Radiohead / 2010 年前后听的电子乐…">
    </div>
    <div class="candidate-list" data-candidates aria-live="polite">
      <p class="small" data-zero-input>开始输入以搜索外部候选——或在 <a href="/">Collection</a> 里找回已收录的。</p>
    </div>
    <form method="post" action="/add" data-confirm>
      <input type="hidden" name="source" value="musicbrainz">
      <input type="hidden" name="source_id" value="">
      <input type="hidden" name="title" value="">
      <input type="hidden" name="artist" value="">
      <input type="hidden" name="release_year" value="">
      <input type="hidden" name="cover_url" value="">
      <input type="hidden" name="favorite" value="">
      <input type="hidden" name="listened_year" value="" data-listen-hidden>
      <div class="confirm-snap" data-snap hidden>
        <img class="candidate-cover" data-snap-cover src="" alt="" hidden>
        <div class="candidate-main">
          <div class="snap-title" data-snap-title></div>
          <div class="candidate-sub" data-snap-sub></div>
        </div>
      </div>
      <div class="form-row">
        <span class="field-label">补充线索——全部可跳过（先添加、稍后补）</span>
        <button class="btn btn-secondary fav-btn" type="button" data-fav aria-pressed="false">${icon('heart', 16)} Favorite</button>
      </div>
      <div class="form-row">
        <label class="field-label" for="dialog-tags">Tag（我的属性；自动补全防同义分裂）</label>
        <div class="tag-input-wrap" data-tagbox>
          <input id="dialog-tags" name="tags" class="tag-hidden" value="" aria-label="Tag 列表">
          <span class="tag-suggest" data-tag-chips role="list"></span>
          <input class="tag-suggest" data-tag-input type="text" placeholder="输入添加…" aria-label="输入新 Tag">
        </div>
        ${topTags.length === 0 ? '' : html`<div class="tag-suggest" style="margin-top:6px;" role="list" aria-label="最近使用的 Tag">${topTags.map((t) => html`<button type="button" data-tag-add="${t}">${t}</button> `)}</div>`}
      </div>
      <details class="note-fold form-row">
        <summary>${icon('note', 14)} 为什么留下它？留一句当时……（可跳过）</summary>
        <textarea name="note" placeholder="例：青旅的天台，海边的夏天。"></textarea>
      </details>
      <div class="form-row">
        <span class="field-label">听的时期——大概哪一年？（D1：默认 = 记录时间，可跳过）</span>
        <div class="listen-time" role="radiogroup" aria-label="听的时期">
          <label><input type="radio" name="listen_preset" value="" checked><span class="chip">刚刚</span></label>
          <label><input type="radio" name="listen_preset" value="${String(year)}"><span class="chip">${String(year)}</span></label>
          <label><input type="radio" name="listen_preset" value="${String(year - 1)}"><span class="chip">${String(year - 1)}</span></label>
          <label><input type="radio" name="listen_preset" value="custom"><span class="chip">更早</span></label>
          <input class="input listen-year" data-listen-year type="number" inputmode="numeric" min="1900" max="2100" placeholder="年份" aria-label="更早的年份">
        </div>
      </div>
      <div style="display:flex; gap: var(--space-md); justify-content:flex-end;">
        <button class="btn btn-secondary" type="button" data-close>稍后补</button>
        <button class="btn btn-primary" type="submit" data-add>添加</button>
      </div>
    </form>
  </dialog>
</div>`;
}
