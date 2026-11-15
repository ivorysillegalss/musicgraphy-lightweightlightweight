/**
 * 岛屿 wall-scroll —— 封面墙受限追加（FR-5 + R-104；ADR-003 第 5 岛屿）。
 *
 * ADR-003 第 5 岛屿评审条款：原决策登记四岛屿；htmx 触发条件 = 「局部刷新形态增多
 * （非岛屿数）」——本岛不新增刷新形态（仍为片段替换 + 事件委托），故不引入 htmx，
 * 按复审 V4 自写 swap 规格执行：AbortController 竞态防护 + 错误片段注入 + 无 JS 基线。
 *
 * 职责（从 filter-cabin 岛屿剥离——舱岛管筛选全量交换，本岛只管墙追加，零交集）：
 * IntersectionObserver 预取「加载下一页」→ fetch /fragment/wall?cursor=…（cursor 只用
 * 服务端下发值——分页链接 href 原样透传，禁自造分页）→ 追加封面卡到 .cover-wall；
 * fetch 失败注入 .error-strip（禁吞错、禁 alert）。在途防护：fetch 期间舱岛换墙
 * （chips swap）→ 旧页 isConnected 判废丢弃。
 * R-104 下拉限制（评审案 docs/iteration-batch3-review.md Q3，a+b 组合）：
 * - a）自动追加 3 页后转手动「加载更多（手动）」——IO 停止观察，点击/原生链接继续逐页；
 *     配额 = 筛选会话语义：MutationObserver 识别舱岛换墙（新 .cover-wall/.result-status）
 *     即重置。服务端分页链路（cursor 顺链 / LIMIT 60）零改动。
 * - b）has_next=false：服务端 SSR 已渲染 .wall-end 到底条（无 JS 同权）；片段上墙时
 *     原样并入，缺失时兜底注入同款常量。回到顶部 = 纯原生 <a href="#mg-top">（零 JS）。
 * 无 JS 基线不破坏：所有增强以 addEventListener 叠加，<a href="?cursor=…"> 原生跳转是兜底。
 * 挂载点 = .results（SSR data-island="wall-scroll"）；舱岛换内容后由 MutationObserver
 * 自动重新布防，两岛无需互相知晓。
 */
const NEXT_MARGIN = '480px';
const AUTO_APPEND_MAX = 3; // R-104 a：自动追加页数上限（其后转手动；SSR 首屏 60 + 3×60 = 240 张后停止自动取页）

const WALL_END_HTML =
  '<div class="wall-end" role="status">已到底 · 匹配的专辑都在这了 <a class="btn-text" href="#mg-top">回到顶部</a></div>'; // 兜底（服务端 resultsSection 同款）

const errorStripHtml =
  '<div class="error-strip" role="alert"><div style="font-weight:600;">封面墙加载失败——网络没有回应。</div>' +
  '<div class="small">已记录的数据都在本地，不受影响。</div></div>';

export function mount(root: HTMLElement): void {
  let ctrl: AbortController | null = null;
  let io: IntersectionObserver | null = null;
  let autoLeft = AUTO_APPEND_MAX; // R-104 a：本次筛选会话剩余的自动追加页数
  let manual = false; // true = 自动额度用尽，只响应点击/原生链接（IO 停）

  const qsOf = (href: string): string => {
    const i = href.indexOf('?');
    return i === -1 ? '' : href.slice(i); // 含服务端下发的 cursor，原样透传
  };

  const injectError = (html: string): void => {
    root.innerHTML = html;
  };

  /** 追加下一页：fetch 片段 → 封面卡并入 .cover-wall → .wall-next 换新 → 重新布防。 */
  const appendNext = async (link: HTMLAnchorElement): Promise<void> => {
    if (link.getAttribute('aria-busy') === 'true') return; // IO 预取与点击竞态：一次在途
    link.setAttribute('aria-busy', 'true');
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      const r = await fetch(`/fragment/wall${qsOf(link.getAttribute('href') ?? '/')}`, { signal: ctrl.signal });
      const text = await r.text();
      if (!link.isConnected) return; // 在途期间舱岛已换墙——旧筛选的页作废（V4 竞态防护）
      if (!r.ok) {
        injectError(text); // 503 响应体本身是 .error-strip——照常注入
        return;
      }
      if (text.trim() === '') {
        injectError(errorStripHtml); // 空响应禁上墙（防白屏）
        return;
      }
      const tpl = document.createElement('template');
      tpl.innerHTML = text; // 服务端转义片段（hono/html），禁再加工
      const frag = tpl.content;
      const nextWall = frag.querySelector('.cover-wall');
      const curWall = root.querySelector('.cover-wall');
      if (nextWall !== null && curWall !== null) {
        for (const card of Array.from(nextWall.children)) curWall.append(card);
      } else {
        root.innerHTML = text; // 空态/错误态片段整块替换
      }
      root.querySelector('.wall-next')?.remove();
      const newNext = frag.querySelector('.wall-next');
      const endStrip = frag.querySelector('.wall-end');
      if (newNext !== null) {
        root.append(newNext);
        if (autoLeft > 0) autoLeft--; // R-104 a：自动额度按成功追加递减（手动态追加不再消耗）
        if (autoLeft === 0 && !manual) manual = true; // 额度用尽转手动
        if (manual) {
          const l = root.querySelector<HTMLAnchorElement>('[data-next]');
          if (l !== null) l.textContent = '加载更多（手动）'; // 增强层文案如实改（服务端原文/无 JS 视角不动）
        }
      } else if (endStrip !== null) {
        root.append(endStrip); // R-104 b：服务端 .wall-end 权威标记原样上墙
      } else {
        root.insertAdjacentHTML('beforeend', WALL_END_HTML); // 兜底：片段缺到底条时注入同款（防御性）
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) injectError(errorStripHtml);
    } finally {
      if (link.isConnected) link.removeAttribute('aria-busy');
      armNext();
    }
  };

  /** 布防「加载下一页」：无链接（has_next=false）/手动态（R-104 a）/环境无 IO → disconnect 即解除观察。 */
  const armNext = (): void => {
    io?.disconnect();
    const link = root.querySelector<HTMLAnchorElement>('[data-next]');
    if (link === null || manual || typeof IntersectionObserver === 'undefined') return;
    io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            io?.disconnect();
            void appendNext(link);
            break;
          }
        }
      },
      { rootMargin: NEXT_MARGIN }
    );
    io.observe(link);
  };

  // 点击兜底：IO 预取未命中时（如直接点链接），原地追加而非整页跳转
  root.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('[data-next]') : null;
    if (a === null) return;
    e.preventDefault();
    void appendNext(a);
  });

  // 舱岛 swap/错误注入会整块换掉本岛内容——内容变化后自动重新布防（两岛解耦）。
  // R-104：识别「新筛选的新墙」（addedNodes 含 .cover-wall/.result-status）→ 自动配额重置
  // （autoLeft/manual = 筛选会话语义，非页面生命周期语义）；本岛自追加只动墙内部
  // （卡片节点无这两类名）与新分页链接/到底条（亦无）→ 不误触。
  new MutationObserver((muts) => {
    const swapped = muts.some((m) =>
      Array.from(m.addedNodes).some((n) => n instanceof Element && (n.classList.contains('cover-wall') || n.classList.contains('result-status')))
    );
    if (swapped) {
      autoLeft = AUTO_APPEND_MAX;
      manual = false;
    }
    armNext();
  }).observe(root, { childList: true, subtree: true });

  armNext();
}
