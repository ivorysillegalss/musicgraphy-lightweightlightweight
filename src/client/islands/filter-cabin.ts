/**
 * 岛屿 filter-cabin —— 试错式筛选舱（FR-2 / D-P3，ADR-003 岛屿之一）。
 *
 * 片段交换：拦截舱内 chips/移除/「移除全部」点击 → 并行 fetch /fragment/cabin + /fragment/wall
 * （同 query string）→ 替换对应容器；AbortController 竞态防护 + 300ms 防抖合并连点；
 * swap 成功后 history.pushState 同步 URL（popstate 反向恢复）——URL 即状态（DD3）。
 * 错误注入：片段 503/网络失败 → 注入 .error-strip（服务端片段自带，禁止吞错）。
 * 事件委托挂 root 级（片段是运行时替换的，禁止对单个 chip 挂监听）。
 * 无限追加（FR-5）已剥离至第 5 岛屿 wall-scroll（ADR-003 评审条款，cursor 服务端下发、
 * LIMIT 60 分页不破坏）：本岛 swap 换墙后由其 MutationObserver 自动重新布防，两岛互不感知。
 * 无 JS 基线不破坏：所有增强以 addEventListener 叠加，<a href> 原生跳转是兜底。
 */

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
    // 「加载下一页」（data-next）不在此拦截——归第 5 岛屿 wall-scroll 管（IO 预取 + 点击兜底）
    const isChip = a.classList.contains('chip') || a.classList.contains('chip-x') || a.classList.contains('btn-text');
    if (!isChip) return;
    e.preventDefault();
    clearTimeout(debounceT);
    debounceT = setTimeout(() => void swap(hrefOf(a), true), 300); // 连点合并（拆分方案 §4.2 契约：300ms 防抖）；最后一次生效
  });

  window.addEventListener('popstate', () => {
    clearTimeout(debounceT);
    // 守卫：历史条目非本页（如经详情页往返后的边界条目）时不做片段交换——
    // 只在 Collection 主页 URL 上恢复，避免把首页舱/墙误注入到其他路径的文档里
    if (location.pathname !== '/') return;
    void swap(`${location.pathname}${location.search}`, false);
  });
}
