/**
 * 岛屿 filter-cabin —— 试错式筛选舱 + 封面墙增强（FR-2 / FR-5 / D-P3，ADR-003 四岛屿之一）。
 *
 * 片段交换：拦截舱内 chips/移除/「移除全部」点击 → 并行 fetch /fragment/cabin + /fragment/wall
 * （同 query string）→ 替换对应容器；AbortController 竞态防护 + 250ms 防抖合并连点；
 * swap 成功后 history.pushState 同步 URL（popstate 反向恢复）——URL 即状态（DD3）。
 * 错误注入：片段 503/网络失败 → 注入 .error-strip（服务端片段自带，禁止吞错）。
 * 事件委托挂 root 级（片段是运行时替换的，禁止对单个 chip 挂监听）。
 * 无限追加（FR-5）：IntersectionObserver 预取「加载下一页」→ 追加封面卡（cursor 服务端给，
 * LIMIT 60 分页不破坏——内存纪律①）；追加不改变 URL（刷新安全）。
 * 无 JS 基线不破坏：所有增强以 addEventListener 叠加，<a href> 原生跳转是兜底。
 */
const NEXT_MARGIN = '480px';

const errorStripHtml =
  '<div class="error-strip" role="alert"><div style="font-weight:600;">筛选加载失败——网络没有回应。</div>' +
  '<div class="small">已记录的数据都在本地，不受影响。</div></div>';

export function mount(root: HTMLElement): void {
  let ctrl: AbortController | null = null;
  let debounceT: ReturnType<typeof setTimeout> | undefined;

  const parts = (): { cabin: HTMLElement | null; results: HTMLElement | null } => ({
    cabin: root.querySelector<HTMLElement>('.filter-cabin'),
    results: root.querySelector<HTMLElement>('.results')
  });

  const announce = (): void => {
    // 计数播报（FR-2「还剩 N 张」）：role=status 已由 SSR 建立，这里把焦点归还结果区
    const status = root.querySelector<HTMLElement>('.result-status');
    if (status !== null) {
      status.tabIndex = -1;
      status.focus({ preventScroll: true });
    }
  };

  const injectError = (results: HTMLElement | null): void => {
    if (results !== null) results.innerHTML = errorStripHtml;
  };

  const fetchText = async (url: string, signal: AbortSignal): Promise<string> => {
    const r = await fetch(url, { signal });
    return r.text(); // 503 响应体本身是 .error-strip——照常注入
  };

  /** 全量交换（chips 导航）：舱 + 墙并行取片段替换；push = 是否写历史。 */
  const swap = async (href: string, push: boolean): Promise<void> => {
    ctrl?.abort();
    ctrl = new AbortController();
    const signal = ctrl.signal;
    root.classList.add('is-loading');
    const q = href === '/' ? '' : qsOf(href); // '' 或 '?genre=…&…'
    try {
      const [cabinHtml, wallHtml] = await Promise.all([fetchText(`/fragment/cabin${q}`, signal), fetchText(`/fragment/wall${q}`, signal)]);
      const { cabin, results } = parts();
      if (cabin !== null) cabin.outerHTML = cabinHtml; // 服务端片段自带 .filter-cabin 容器
      if (results !== null) results.innerHTML = wallHtml;
      if (push) history.pushState({}, '', href);
      announce();
      armNext();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) injectError(parts().results);
    } finally {
      root.classList.remove('is-loading');
    }
  };

  const hrefOf = (a: HTMLAnchorElement): string => a.getAttribute('href') ?? '/';
  const qsOf = (href: string): string => {
    const i = href.indexOf('?');
    return i === -1 ? '' : href.slice(i);
  };

  // root 级事件委托（片段运行时替换安全）
  root.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a') : null;
    if (a === null) return;
    const isChip = a.classList.contains('chip') || a.classList.contains('chip-x') || a.classList.contains('btn-text');
    const isNext = a.hasAttribute('data-next');
    if (!isChip && !isNext) return;
    e.preventDefault();
    if (isNext) {
      void appendNext(a);
      return;
    }
    clearTimeout(debounceT);
    debounceT = setTimeout(() => void swap(hrefOf(a), true), 250); // 连点合并；最后一次生效
  });

  window.addEventListener('popstate', () => {
    clearTimeout(debounceT);
    void swap(`${location.pathname}${location.search}`, false);
  });

  // —— 无限追加（FR-5）：IO 预取下一页封面卡并追加；cursor 由服务端链接给出 ——
  const appendNext = async (link: HTMLAnchorElement): Promise<void> => {
    if (link.getAttribute('aria-busy') === 'true') return;
    link.setAttribute('aria-busy', 'true');
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      const wallHtml = await fetchText(`/fragment/wall${qsOf(hrefOf(link))}`, ctrl.signal);
      const { results } = parts();
      if (results === null) return;
      const tpl = document.createElement('template');
      tpl.innerHTML = wallHtml; // 服务端转义片段（hono/html）
      const frag = tpl.content;
      const nextWall = frag.querySelector('.cover-wall');
      const curWall = results.querySelector('.cover-wall');
      if (nextWall !== null && curWall !== null) {
        for (const card of Array.from(nextWall.children)) curWall.append(card);
      } else {
        results.innerHTML = wallHtml; // 空态/错误态片段整块替换
      }
      const oldNext = results.querySelector('.wall-next');
      const newNext = frag.querySelector('.wall-next');
      if (oldNext !== null) oldNext.remove();
      if (newNext !== null) results.append(newNext);
      armNext();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) injectError(parts().results);
    } finally {
      link.removeAttribute('aria-busy');
    }
  };

  let io: IntersectionObserver | null = null;
  const armNext = (): void => {
    io?.disconnect();
    const link = root.querySelector<HTMLAnchorElement>('[data-next]');
    if (link === null || typeof IntersectionObserver === 'undefined') return;
    io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            io?.disconnect();
            void appendNext(link);
          }
        }
      },
      { rootMargin: NEXT_MARGIN }
    );
    io.observe(link);
  };
  armNext();
}
