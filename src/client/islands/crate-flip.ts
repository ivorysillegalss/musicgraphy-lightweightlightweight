/**
 * 岛屿 crate-flip —— 翻箱键盘流（R-108 · S2-22，评审案 docs/design-refs-review.md Q5）。
 * cratedigger 四态状态机的 CSS 翻译（S2-10 拆解）：rest 半压微倾 / focused 正立居中
 * （类切换；缓动仅在 body[data-sensory="on"]，缺省安静——S2-17 感官层）。
 * 无 JS 基线：strip = 原生横向 scroll + <a> 链接全可用；本岛屿纯增强 = 键盘 ←→/Home/End/R、
 * 焦点管理（Enter 原生跟链）、续箱 fetch（wall-scroll cursor 顺链同族）、URL 即状态 ?at=。
 * 协作边界（keyboard-flow 先例）：谁拥有 DOM 谁处理按键——本岛屿只处理 strip 内按键。
 */

const sensoryOn = (): boolean => {
  const on = /(?:^|;\s*)mg_sensory=on(?:;|$)/.test(document.cookie);
  document.body.dataset.sensory = on ? 'on' : 'off';
  return on;
};

export function mount(root: HTMLElement): void {
  void sensoryOn(); // 初始即写 body dataset（CSS 过渡键）
  const behavior = (): ScrollBehavior => (/mg_sensory=on(?:;|$)/.test(document.cookie) ? 'smooth' : 'auto');
  const list = (): HTMLAnchorElement[] => Array.from(root.querySelectorAll<HTMLAnchorElement>('.spine'));
  let idx = -1;
  let nextCursor: string | null = root.dataset.nextCursor || null;
  let fetching = false;

  const syncUrl = (id: string | undefined): void => {
    if (id === undefined) return;
    const url = new URL(location.href);
    url.searchParams.set('at', id);
    history.replaceState(null, '', url); // 连续浏览位置 = 瞬态：replace 不刷历史（评审案 Q5）
  };

  const apply = (i: number, scroll = true): void => {
    const items = list();
    if (items.length === 0) return;
    idx = Math.max(0, Math.min(i, items.length - 1));
    for (let k = 0; k < items.length; k++) items[k]!.classList.toggle('current', k === idx);
    const el = items[idx]!;
    el.focus({ preventScroll: true }); // DOM 焦点 = Enter 原生跟链（无 JS 同构）
    if (scroll) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: behavior() });
    syncUrl(el.dataset.id);
  };

  const fetchMore = async (): Promise<void> => {
    if (fetching || nextCursor === null) return;
    fetching = true;
    try {
      const res = await fetch(`/fragment/crate?cursor=${encodeURIComponent(nextCursor)}`);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const more = doc.querySelector('.crate-more');
      if (more === null) {
        nextCursor = null;
        return;
      }
      for (const child of Array.from(more.children)) root.appendChild(child);
      const next = more.getAttribute('data-next') ?? '';
      nextCursor = next === '' ? null : next;
      root.dataset.nextCursor = next;
    } catch {
      nextCursor = null; // 失败静默：已有内容照常可用（三态原则，失败不吞错——console 留痕）
      console.error('[crate-flip] 续箱加载失败');
    } finally {
      fetching = false;
    }
  };

  const move = async (delta: number): Promise<void> => {
    const items = list();
    if (items.length === 0) return;
    if (idx + delta >= items.length - 3 && nextCursor !== null) await fetchMore(); // 临近箱尾续箱（wall-scroll 预取同思路）
    apply(idx + delta);
  };

  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      void move(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      void move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      apply(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      void move(list().length);
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      location.href = '/random'; // 随机一张（302 → 详情；遇见感入口，S2-23）
    }
  });

  root.addEventListener('click', (e) => {
    const a = (e.target instanceof Element ? e.target : null)?.closest('.spine');
    if (a === null) return;
    const i = list().indexOf(a as HTMLAnchorElement);
    if (i >= 0) apply(i, false); // 视觉同步；导航仍走原生 <a>
  });

  // 初始定位：?at= 优先（URL 即状态回放），否则第一张
  const at = new URLSearchParams(location.search).get('at');
  const items0 = list();
  const atIdx = at === null ? -1 : items0.findIndex((el) => el.dataset.id === at);
  apply(atIdx >= 0 ? atIdx : 0, false);
}
