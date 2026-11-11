// W0 最小岛屿：全局键盘流（'/' 聚焦搜索，PRD FR-2 演示路径之一）。
// 无框架、无 hydration（ADR-003）；后续岛屿：添加弹层 / 筛选舱 / 键盘流扩展。

function isTypingTarget(el: Element | null): boolean {
  if (el === null) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(e.target instanceof Element ? e.target : null)) return;
  const input = document.querySelector<HTMLInputElement>('#global-search');
  if (input !== null) {
    e.preventDefault();
    input.focus();
  }
});
