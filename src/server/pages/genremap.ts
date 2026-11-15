/**
 * genremap.ts —— 流派星图页（R-109 · S2-25/S2-26，评审案 docs/design-refs-review.md Q3/Q4）。
 * 设计参考 Every Noise at Once（S2-11 拆解）：服务端预计算布局 + 纯 DOM 绝对定位标签 +
 * 零框架客户端——SSR HTML 即完整产品，无 JS 可用性 100%（每节点 = 原生 <a>，键盘 Tab 可达）。
 * 直达接线 = chips 同语义（/?genre=…、/?tag=…，DD3 URL 即状态零新机制）。
 */
import { html } from 'hono/html';
import { emptyWall, sensoryToggle, siteHeader, type LayoutOptions, layout } from '../html';
import { nodeFontSize, type GenreMap } from '../db/genremap';

export function renderGenreMap(
  props: { map: GenreMap | null; sensoryOn: boolean; focusGenre: string | null; focusTag: string | null },
  layoutOpts: Omit<LayoutOptions, 'body'>
): ReturnType<typeof html> {
  const tools = html`<span style="margin-left:auto; display:flex; gap:var(--space-sm); align-items:center;">
    <a class="btn btn-primary" href="/">← Collection</a>
    ${sensoryToggle(props.sensoryOn, '/genres')}
  </span>`;
  const header = html`${siteHeader('', tools)}`;
  if (props.map === null) {
    return layout({
      ...layoutOpts,
      body: html`${header}<main class="page">${errorStripLike()}</main>`
    });
  }
  const { map } = props;
  if (map.nodes.length === 0) {
    return layout({
      ...layoutOpts,
      body: html`${header}<main class="page">
      ${emptyWall('你的流派宇宙还没有坐标——先给专辑挂上第一个 Tag，或记录第一张专辑。', html`<a class="btn btn-primary" href="/add">去记录一张</a>`)}
      </main>`
    });
  }
  const nodes = map.nodes.map((n) => {
    const fs = nodeFontSize(n.count, map.stats.maxCount);
    const href = n.kind === 'genre' ? `/?genre=${encodeURIComponent(n.name)}` : `/?tag=${encodeURIComponent(n.name)}`;
    const current = (n.kind === 'genre' && props.focusGenre === n.name) || (n.kind === 'tag' && props.focusTag === n.name);
    return html`<a role="listitem" class="gnode ${n.kind === 'genre' ? 'gnode-genre' : 'gnode-tag'}${current ? ' gnode-current' : ''}"
      style="left:${String(n.x)}%; top:${String(n.y)}%; font-size:${String(fs)}px;"
      href="${href}" data-sample="${n.sample ?? ''}" title="${String(n.count)} 张 · ${n.kind === 'genre' ? '流派' : 'Tag'}——点按筛选">${n.name}</a>`;
  });
  const body = html`${header}<main class="page">
  <div class="page-intro">
    <h1>你的流派宇宙</h1>
    <p class="small">${String(map.stats.genres)} 个流派 · ${String(map.stats.tags)} 个 Tag · ${String(map.stats.edges)} 条共现——贴得近的，总是一起出现在你的收藏里。点一下，回到那些唱片。</p>
  </div>
  <div class="gmap" role="list" aria-label="我的流派星图">
    ${nodes}
  </div>
  </main>`;
  return layout({ ...layoutOpts, body });
}

function errorStripLike(): ReturnType<typeof html> {
  return html`<div class="error-strip" role="alert">
  <div style="font-weight:600;">星图计算失败——档案服务没有回应。</div>
  <div class="small">已记录的数据都在本地，不受影响。</div>
  <a class="btn btn-secondary" style="margin-top: var(--space-sm);" href="/genres">重试</a>
</div>`;
}
