/**
 * topster.ts —— Topster 策展页（W10-12-1 W10 批；评审案 docs/topster-review.md Q5/Q6/Q7，用户 2026-11-14 批准实现）。
 * Topster = Collection 的一种 View（PRD §4 方案 B 调整 1，禁第二套数据）：成员渲染实时取自 collection_record，
 * 清单只表达「顺序 + 副标题」的策展语义（案 2 底线；禁自由画布）。无 JS 基线：全部交互 = GET form / POST+303，
 * 顺序编辑 = ↑↓ form（经典无 JS 重排）。渲染先例 = pages/metrics.ts（渲染函数独立文件，路由接线在 routes/pages.ts）。
 */
import { html } from 'hono/html';
import { parseItemOrder, type TopsterMeta } from '../db/topster';
import type { CollectionItem } from '../db/types';
import { coverWallCards, emptyWall, errorStrip, siteHeader, type LayoutOptions, layout } from '../html';
import { wallCard } from './collection';
import { topsterSvgSignature } from './topster-svg';

export type Esc = ReturnType<typeof html>;

const actionForm = (action: string, hidden: Record<string, string>, label: string, cls = 'btn-text'): Esc =>
  html`<form method="post" action="${action}" style="display:inline;">${Object.entries(hidden).map(
    ([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`
  )}<button class="${cls}" type="submit">${label}</button></form>`;

/** 列表页：我的策展（新建 form + 每项 查看/删除）。topsters=null → error 三态。 */
export function renderTopsterList(
  d: { topsters: TopsterMeta[] | null; flash: 'error' | null },
  layoutOpts: Omit<LayoutOptions, 'body'>
): Esc {
  const body = html`${siteHeader('', html`<a class="btn btn-primary" href="/">← Collection</a>`)}
<main>
  <h1 style="font-family:var(--font-display); font-size:28px; margin-bottom:6px;">Topster · 我的策展</h1>
  <p class="small" style="color:var(--color-muted-foreground); max-width:640px;">
    从你的 Collection 里选一组专辑，排成一个顺序、写一句副标题——顺序即叙事（案 2 底线）。
    策展只是档案的一种 View：成员实时取自 Collection，不复制数据；容量 ≤60 张。
  </p>
  ${d.flash === 'error' ? errorStrip('操作未生效——标题必填，或该记录已不在档案。') : ''}
  <form method="post" action="/topsters" style="display:flex; flex-wrap:wrap; gap:var(--space-md); align-items:flex-end; margin:var(--space-lg) 0;">
    <label class="small" style="display:flex; flex-direction:column; gap:4px;">标题<input name="title" required maxlength="80" style="min-width:220px;"></label>
    <label class="small" style="display:flex; flex-direction:column; gap:4px;">副标题（可选）<input name="subtitle" maxlength="120" style="min-width:320px;"></label>
    <button class="btn btn-primary" type="submit">新建策展</button>
  </form>
  ${
    d.topsters === null
      ? errorStrip('策展列表读取失败——档案服务没有回应。', '/topsters')
      : d.topsters.length === 0
        ? emptyWall('还没有策展。新建一个，把「这一年最常听的 25 张」排成顺序。')
        : html`<div style="display:flex; flex-direction:column; gap:var(--space-md); margin-top:var(--space-lg);">
        ${d.topsters.map((t) => {
          const count = (parseItemOrder(t.item_order) ?? []).length;
          return html`<div class="zone" style="display:flex; flex-wrap:wrap; gap:var(--space-md); align-items:baseline;">
            <a href="/topsters/${t.id}" style="font-weight:600;">${t.title}</a>
            ${t.subtitle === null ? '' : html`<span class="small" style="color:var(--color-muted-foreground);">${t.subtitle}</span>`}
            <span class="mono small" style="color:var(--color-muted-foreground);">${String(count)} 张 · ${t.created_at.slice(0, 10)}</span>
            <span style="flex:1;"></span>
            <a class="btn-text" href="/topsters/${t.id}">查看</a>
            ${actionForm('/topsters/delete', { topster_id: t.id }, '删除')}
          </div>`;
        })}
      </div>`
  }
</main>`;
  return layout({ ...layoutOpts, body });
}

/** 策展详情页：按序网格 + 成员编辑区（↑↓/移除）+ 搜索加入区（本地档案检索，不调上游）。 */
export function renderTopsterDetail(
  d: {
    t: TopsterMeta;
    items: CollectionItem[];
    missing: number;
    addCandidates: CollectionItem[];
    addNotice: string | null;
    flash: 'error' | null;
  },
  layoutOpts: Omit<LayoutOptions, 'body'>
): Esc {
  const byId = new Map(d.items.map((it) => [it.id, it] as const));
  const ids = (parseItemOrder(d.t.item_order) ?? []).filter((rid, i, arr) => arr.indexOf(rid) === i); // 去重防御
  const base = `/topsters/${d.t.id}`;

  const memberRows = ids.map((rid, i) => {
    const it = byId.get(rid);
    const first = i === 0;
    const last = i === ids.length - 1;
    return html`<div style="display:flex; flex-wrap:wrap; gap:var(--space-sm); align-items:baseline; padding:6px 0; border-bottom:1px solid var(--color-border);">
      <span class="mono small" style="color:var(--color-muted-foreground); min-width:24px;">${String(i + 1)}</span>
      ${
        it === undefined
          ? html`<span class="small" style="color:var(--color-muted-foreground);">（此记录已不在档案）</span>`
          : html`<a href="/album/${it.id}">${it.album.title}</a><span class="small" style="color:var(--color-muted-foreground);">${it.album.artist}</span>`
      }
      <span style="flex:1;"></span>
      ${first ? '' : actionForm(`${base}/move`, { record_id: rid, dir: 'up' }, '↑')}
      ${last ? '' : actionForm(`${base}/move`, { record_id: rid, dir: 'down' }, '↓')}
      ${actionForm(`${base}/remove`, { record_id: rid }, '移除')}
    </div>`;
  });

  const body = html`${siteHeader('', html`<a class="btn btn-primary" href="/topsters">← 我的策展</a>`)}
<main>
  <h1 style="font-family:var(--font-display); font-size:28px; margin-bottom:2px;">${d.t.title}</h1>
  ${d.t.subtitle === null ? '' : html`<p style="color:var(--color-muted-foreground); margin:0 0 6px;">${d.t.subtitle}</p>`}
  <p class="mono small" style="color:var(--color-muted-foreground);">ORDER IS THE STORY · ${String(ids.length)}/60 张${d.missing > 0 ? html` · 清单中 ${String(d.missing)} 处引用的记录已不在档案` : ''}</p>
  ${
    ids.length === 0
      ? ''
      : html`<p class="small" style="margin:0 0 6px;"><a class="btn-text" href="${base}/export.svg">导出 SVG 图片</a> · <a class="btn-text" href="${base}/poster">海报页（截图即成图）</a><span class="small" style="color:var(--color-muted-foreground);">——分享的是作品图，署名已内嵌</span></p>`
  }
  ${d.flash === 'error' ? errorStrip('操作未生效——容量已满（60 张）、记录已不在档案或已在策展中。') : ''}

  ${
    ids.length === 0
      ? emptyWall('空策展。在下方搜索你的档案，把第一张加进来。')
      : html`<div style="margin-top:var(--space-lg);">${coverWallCards(d.items.map((it) => wallCard(it)))}</div>`
  }

  <div class="zone" style="margin-top:var(--space-2xl);">
    <h2 class="small mono" style="margin-top:0;">EDIT · 顺序与成员</h2>
    ${memberRows.length === 0 ? '' : html`<div>${memberRows}</div>`}
    <form method="get" action="${base}" style="display:flex; flex-wrap:wrap; gap:var(--space-md); align-items:flex-end; margin-top:var(--space-lg);">
      <label class="small" style="display:flex; flex-direction:column; gap:4px;">从档案中加入成员（标题/艺术家）<input name="add_q" minlength="1" style="min-width:260px;"></label>
      <button class="btn btn-secondary" type="submit">搜索</button>
    </form>
    ${
      d.addNotice !== null
        ? html`<p class="small" style="color:var(--color-muted-foreground);">${d.addNotice}</p>`
        : d.addCandidates.length > 0
          ? html`<div style="margin-top:var(--space-md);">${d.addCandidates.map((it) => html`<div style="display:flex; gap:var(--space-md); align-items:baseline; padding:6px 0; border-bottom:1px solid var(--color-border);">
              <a href="/album/${it.id}">${it.album.title}</a><span class="small" style="color:var(--color-muted-foreground);">${it.album.artist}</span>
              <span style="flex:1;"></span>${actionForm(`${base}/members`, { record_id: it.id }, '加入', 'btn-text')}
            </div>`)}</div>`
          : ''
    }
  </div>

  <div class="zone" style="margin-top:var(--space-lg);">
    <h2 class="small mono" style="margin-top:0;">META · 标题与副标题</h2>
    <form method="post" action="${base}/update" style="display:flex; flex-wrap:wrap; gap:var(--space-md); align-items:flex-end;">
      <label class="small" style="display:flex; flex-direction:column; gap:4px;">标题<input name="title" required maxlength="80" value="${d.t.title}" style="min-width:220px;"></label>
      <label class="small" style="display:flex; flex-direction:column; gap:4px;">副标题（可选）<input name="subtitle" maxlength="120" value="${d.t.subtitle ?? ''}" style="min-width:320px;"></label>
      <button class="btn btn-secondary" type="submit">保存</button>
    </form>
    <div style="margin-top:var(--space-md);">${actionForm('/topsters/delete', { topster_id: d.t.id }, '删除此策展', 'btn-text')}</div>
  </div>
</main>`;
  return layout({ ...layoutOpts, body });
}

/**
 * 海报页（W11 批案 C，评审案 §3，用户批准 A+C 组合）：cover-first 大网格 + 标题/副标题 + 署名页脚，
 * 无编辑区——用户全屏截图/系统打印即成图（主流平台不收 SVG 上传的现实分享路径补位，零依赖）。
 */
export function renderTopsterPoster(
  d: { t: TopsterMeta; items: CollectionItem[] },
  layoutOpts: Omit<LayoutOptions, 'body'>
): Esc {
  const body = html`<main style="max-width:1040px; margin:0 auto; padding-top:var(--space-xl);">
  <h1 style="font-family:var(--font-display); font-size:34px; margin-bottom:2px;">${d.t.title}</h1>
  ${d.t.subtitle === null ? '' : html`<p style="font-size:18px; color:var(--color-muted-foreground); margin:0 0 4px;">${d.t.subtitle}</p>`}
  <p class="mono small" style="color:var(--color-muted-foreground);">ORDER IS THE STORY · ${String(d.items.length)} 张</p>
  ${
    d.items.length === 0
      ? emptyWall('空策展——先回策展页加几张专辑再来导出。')
      : html`<div style="margin-top:var(--space-lg);">${coverWallCards(d.items.map((it) => wallCard(it)))}</div>`
  }
  <p class="small" style="color:var(--color-muted-foreground); margin-top:var(--space-xl);">${topsterSvgSignature}</p>
</main>`;
  return layout({ ...layoutOpts, body });
}

/**
 * 内容说明页（R-101 · S2-1，评审案 docs/iteration-batch3-review.md Q1）：Topster 是什么 / 怎么建 /
 * 分享价值。内容口径 = 02-变现文档包 04B 引擎一「分享的是作品图，不是产品」+ 海报页/SVG 导出链路的
 * 诚实边界（主流平台不收 SVG 上传 → 海报页补位）。背景 = 2026-11-15 全站入口普查：/topsters 系列
 * 四页 0 处 UI 入口且无功能说明——本页 + 页脚入口行（siteFooter）一并闭环；列表页空态文案已在档不改。
 */
export function renderTopsterAbout(layoutOpts: Omit<LayoutOptions, 'body'>): Esc {
  const body = html`${siteHeader('', html`<a class="btn btn-primary" href="/topsters">← 我的策展</a>`)}
<main style="max-width:720px;">
  <div class="page-intro">
    <h1>Topster · 把你的 Collection 排成一张图</h1>
    <p>Topster 是你档案的策展视图：从 Collection 里挑一组专辑，排成一个顺序、写一句副标题——<strong>顺序即叙事</strong>。
    它不是新的数据，只是档案的另一种看法：成员实时取自 Collection，删掉记录它就如实空着，容量 ≤60 张。</p>
  </div>
  <section style="margin-bottom: var(--space-xl);">
    <h2 class="small mono" style="margin-top:0;">HOW · 三步建一张</h2>
    <ol style="line-height:2; margin:0; padding-left:20px;">
      <li>在 <a href="/topsters">我的策展</a> 新建一个策展——标题必填，副标题可选（如「这一年最常听的 25 张」）。</li>
      <li>在策展页搜索<strong>你自己的档案</strong>把专辑加进来（只加你已记录的，不调外部服务）。</li>
      <li>用 ↑ ↓ 调顺序，改标题副标题——你怎么排，它就怎么说。</li>
    </ol>
  </section>
  <section style="margin-bottom: var(--space-xl);">
    <h2 class="small mono" style="margin-top:0;">SHARE · 分享的是作品图，不是产品</h2>
    <p>两张导出链路都在策展详情页（有成员才显示）：</p>
    <p><strong>导出 SVG 图片</strong>——矢量图下载即得，封面走你档案的本地缓存，角落一行「made with Musicgraphy」署名内嵌。<span class="small" style="color:var(--color-muted-foreground);">诚实边界：主流社交平台一般不收 SVG 上传。</span></p>
    <p><strong>海报页</strong>——干净的大网格 + 标题副标题 + 署名，全屏截图或系统打印即成图，是那条
    诚实的补位路。</p>
    <p>你的表达在前，Musicgraphy 只是角落的署名——分享发生在平台外、你的手里。</p>
  </section>
  <p>
    <a class="btn btn-primary" href="/topsters">去我的策展</a>
    <a class="btn btn-secondary" href="/">← 回 Collection</a>
  </p>
</main>`;
  return layout({ ...layoutOpts, body });
}
