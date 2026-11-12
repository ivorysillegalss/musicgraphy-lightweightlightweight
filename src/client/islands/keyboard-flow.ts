/**
 * 岛屿 keyboard-flow —— 全局键盘流（P1-8，ADR-003 四岛屿之一）。
 *
 * `/` 全局聚焦搜索框（P1-8 高频记录者路径）。弹层内的 Enter/F/Esc 由 add-dialog
 * 岛屿自行处理（协作边界：谁拥有 DOM 谁处理按键），本岛屿不碰对方 DOM。
 * 浏览器默认行为不劫持（除 `/`）；输入框聚焦时不触发。
 */
function isTypingTarget(el: Element | null): boolean {
  if (el === null) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function mount(root: HTMLElement): void {
  const focusSearch = (): HTMLInputElement | null => {
    const bar = document.querySelector<HTMLElement>('[data-island="search-box"]');
    return bar?.querySelector<HTMLInputElement>('input[name="q"]') ?? null;
  };

  // 挂载点自身为 hidden 占位（布局内无视觉形态），键盘监听挂 document
  void root;
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target instanceof Element ? e.target : null)) return;
    if (document.querySelector('dialog[open]') !== null) return; // 弹层打开时不抢按键
    const input = focusSearch();
    if (input !== null) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}
