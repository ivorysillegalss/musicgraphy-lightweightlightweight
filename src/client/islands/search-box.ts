/**
 * 岛屿 search-box —— 搜索框增强（FR-1 零输入候选 / FR-3 检索入口，ADR-003 四岛屿之一）。
 *
 * 双意图单入口（无模式切换器）：普通词 → Enter 原生 GET form 全文检索（基线）；
 * 输入中 → 下拉展示「你的档案命中 + 外部候选」片段（GET /fragment/search-suggest，
 * 服务端转义）；外部候选的「添加」按钮 = [data-mg-add]，点击由 add-dialog 岛屿的
 * document 级委托接管（选中 → 打开弹层确认层）。失败一律静默隐藏候选。
 * 键盘：↑/↓ 移动 aria-selected、Enter（有外部候选时）= 添加首候选、Esc 归还焦点。
 */
const debounce = (fn: () => void, ms: number): (() => void) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
};

export function mount(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>('input[name="q"]');
  if (input === null) return;
  const form = input.closest('form');

  const pop = document.createElement('div');
  pop.className = 'search-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'listbox');
  pop.setAttribute('aria-label', '搜索候选');
  root.append(pop);

  const hide = (): void => {
    pop.hidden = true;
    pop.innerHTML = '';
  };

  let ctrl: AbortController | null = null;
  const refresh = debounce(() => {
    const q = input.value.trim();
    ctrl?.abort();
    if (q.length < 2) {
      hide();
      return;
    }
    ctrl = new AbortController();
    fetch(`/fragment/search-suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => {
        if (html === '') {
          hide();
          return;
        }
        pop.innerHTML = html; // 服务端 hono/html 转义片段；本岛屿不插任何用户数据
        pop.hidden = false;
        mark(0);
      })
      .catch(() => {
        /* 已取消或网络失败：静默隐藏，GET form 基线不受影响 */
      });
  }, 300);

  const options = (): HTMLElement[] => Array.from(pop.querySelectorAll<HTMLElement>('.pop-item'));
  const selected = (): number => options().findIndex((o) => o.getAttribute('aria-selected') === 'true');

  const mark = (i: number): void => {
    const opts = options();
    opts.forEach((o, j) => o.setAttribute('aria-selected', String(j === i)));
  };

  input.addEventListener('input', refresh);
  input.addEventListener('focus', () => {
    if (input.value.trim().length < 2 && pop.hidden) {
      pop.innerHTML = '<div class="pop-empty">搜索你的档案（标题 / 艺术家 / Tag / 一句「当时」），或粘贴链接直接添加。</div>';
      pop.hidden = false;
    }
  });
  input.addEventListener('keydown', (e) => {
    if (pop.hidden) return;
    const opts = options();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = selected();
      const next = e.key === 'ArrowDown' ? Math.min(cur + 1, opts.length - 1) : Math.max(cur - 1, 0);
      mark(next);
      opts[next]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      // 外部候选高亮 → 添加首候选（交给 add-dialog 确认层）；其余情况保持原生检索提交
      const cur = opts[selected()] ?? null;
      const addBtn = cur?.querySelector<HTMLElement>('[data-mg-add]') ?? pop.querySelector<HTMLElement>('[data-mg-add]');
      if (addBtn !== null && (cur === null || cur.contains(addBtn))) {
        e.preventDefault();
        addBtn.click();
        hide();
      }
      return;
    }
    if (e.key === 'Escape') {
      hide();
      input.blur();
    }
  });
  form?.addEventListener('submit', () => hide()); // 提交检索 → 候选失去意义
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target instanceof Node ? e.target : null)) hide();
  });
}
