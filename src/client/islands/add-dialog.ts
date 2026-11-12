/**
 * 岛屿 add-dialog —— 添加弹层增强（FR-1 / C-ADD / P1-8，ADR-003 四岛屿之一）。
 * 无 JS 基线升级为原生 <dialog>（JS 失败回退基线）；候选/补全走 fragment（失败静默）；
 * 落库仍走 POST /add——默认态=完成态；409 → 303 详情页 C-DUP；Enter 添加首候选 / F Favorite。
 */
const debounce = (fn: () => void, ms: number): (() => void) => { let t: ReturnType<typeof setTimeout> | undefined; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
const isTyping = (el: Element | null): boolean => el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);

export function mount(root: HTMLElement): void {
  const $ = <T extends HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
  const dialog = $<HTMLDialogElement>('dialog.dialog');
  const trigger = root.querySelector<HTMLAnchorElement>('a[href="/add"]');
  const find = $<HTMLInputElement>('#dialog-find');
  const list = $('[data-candidates]');
  const form = $('form[data-confirm]');
  const favBtn = $('[data-fav]');
  const tagField = $<HTMLInputElement>('input[name="tags"]');
  const tagChips = $('[data-tag-chips]');
  const tagInput = $<HTMLInputElement>('[data-tag-input]');
  if (dialog === null || trigger === null || find === null || list === null || form === null || favBtn === null) return;
  const zeroHtml = list.innerHTML;

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    dialog.showModal();
    find.focus();
  });
  for (const b of dialog.querySelectorAll('[data-close]')) b.addEventListener('click', () => dialog.close());

  // —— 候选搜索（粘贴识别 / 文本；AbortController 竞态防护；loading = 骨架行）——
  let ctrl: AbortController | null = null;
  const search = debounce(() => {
    const q = find.value.trim();
    ctrl?.abort();
    if (q.length < 2) {
      list.innerHTML = zeroHtml;
      return;
    }
    list.innerHTML = '<div class="skeleton"></div>'.repeat(3);
    ctrl = new AbortController();
    fetch(`/fragment/search-suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
      .then((r) => r.text())
      .then((html) => {
        list.innerHTML = html; // 服务端 hono/html 转义片段
      })
      .catch(() => {}); // 已取消或网络失败：保留当前内容（失败不阻塞记录）
  }, 350);
  find.addEventListener('input', search);

  // —— 候选选择（document 级委托：弹层内片段 + 搜索框下拉共用 [data-mg-add]）——
  const select = (ds: DOMStringMap): void => {
    for (const [k, n] of [['mgAdd', 'source_id'], ['title', 'title'], ['artist', 'artist'], ['year', 'release_year'], ['cover', 'cover_url']] as const) {
      const el = form.querySelector<HTMLInputElement>(`input[name="${n}"]`);
      if (el !== null) el.value = ds[k] ?? '';
    }
    const snap = $('[data-snap]');
    if (snap !== null) {
      snap.hidden = false;
      const t = snap.querySelector('[data-snap-title]');
      const s = snap.querySelector('[data-snap-sub]');
      const img = snap.querySelector<HTMLImageElement>('[data-snap-cover]');
      if (t !== null) t.textContent = ds['title'] ?? '';
      if (s !== null) s.textContent = `${ds['artist'] ?? ''}${ds['year'] ? ` · ${ds['year']}` : ''}`;
      if (img !== null) { img.hidden = (ds['cover'] ?? '') === ''; img.src = ds['cover'] ?? ''; }
    }
    form.querySelector<HTMLButtonElement>('[data-add]')?.focus();
  };
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-mg-add]') : null;
    if (btn === null) return;
    select(btn.dataset);
    if (!dialog.open) dialog.showModal();
    else if (list.contains(btn)) list.innerHTML = zeroHtml;
  });

  // —— Favorite（aria-pressed 驱动样式；提交走隐藏域）——
  const favField = form.querySelector<HTMLInputElement>('input[name="favorite"]');
  favBtn.addEventListener('click', () => {
    const on = favBtn.getAttribute('aria-pressed') !== 'true';
    favBtn.setAttribute('aria-pressed', String(on));
    if (favField !== null) favField.value = on ? '1' : '';
  });

  // —— Tag（最近 tag 点击即挂 + Enter/补全防同义分裂，FR-1；值存放于隐藏域）——
  const tags = (): string[] => (tagField?.value ?? '').split(/[,，]/).map((t) => t.trim()).filter(Boolean);
  const sug = document.createElement('div');
  sug.className = 'tag-suggest';
  tagChips?.after(sug);
  const setTags = (next: string[]): void => {
    if (tagField === null || tagChips === null) return;
    tagField.value = next.join(', ');
    tagChips.replaceChildren(...next.map((t) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = t;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.setAttribute('aria-label', `移除 ${t}`);
      x.addEventListener('click', () => setTags(tags().filter((v) => v !== t)));
      chip.append(x);
      return chip;
    }));
  };
  const tagBtn = (t: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t;
    b.addEventListener('click', () => { setTags([...tags(), t]); if (tagInput !== null) tagInput.value = ''; });
    return b;
  };
  dialog.querySelectorAll('[data-tag-add]').forEach((b) => b.addEventListener('click', () => setTags([...new Set([...tags(), b.getAttribute('data-tag-add') ?? ''].filter(Boolean))])));
  if (tagField !== null && tagChips !== null && tagInput !== null) {
    setTags(tags());
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (tagInput.value.trim() !== '') setTags([...tags(), tagInput.value.trim()]);
        tagInput.value = '';
      }
    });    const suggest = debounce(() => {
      const q = tagInput.value.trim();
      if (q === '') return;
      fetch(`/fragment/tag-suggest?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ data: string[] }>) : { data: [] }))
        .then(({ data }) => sug.replaceChildren(...data.slice(0, 5).filter((t) => !tags().includes(t)).map(tagBtn)))
        .catch(() => {}); // 补全失败静默：本地输入不受阻
    }, 250);
    tagInput.addEventListener('input', suggest);
  }

  // —— 听期（D1：radio 预设 → listened_year；≤2 次点击、可跳过）——
  form.addEventListener('submit', () => {
    const preset = form.querySelector<HTMLInputElement>('input[name="listen_preset"]:checked');
    const out = dialog.querySelector<HTMLInputElement>('[data-listen-hidden]');
    const custom = dialog.querySelector<HTMLInputElement>('[data-listen-year]');
    if (out !== null) out.value = (preset?.value ?? '') === 'custom' ? (custom?.value.trim() ?? '') : (preset?.value ?? '');
  });

  // —— 键盘流（P1-8：Enter 添加首候选 / F 快速 Favorite；Esc 原生）——
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === find) {
      const first = list.querySelector<HTMLElement>('[data-mg-add]');
      if (first !== null) { e.preventDefault(); first.click(); } // Enter = 添加首候选（P1-8）
      return;
    }
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target instanceof Element ? e.target : null)) { e.preventDefault(); favBtn.click(); }
  });
}
