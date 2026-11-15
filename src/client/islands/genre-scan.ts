/**
 * 岛屿 genre-scan —— 流派星图扫听（R-109 · S2-27，评审案 docs/design-refs-review.md Q13）：
 * everynoise scan() 同构——逐节点顺序试听代表记录（服务端内联 data-sample = MIN(record id)
 * 确定性取样），当前节点 .gnode-playing 高亮（everynoise ♫ 标记同款思路）。
 * 节点点击仍是筛选主语义（DD3）；扫听 = 独立按钮显式开启，无自动播放零预取（隐私红线）。
 * 预览经 /album/:id/preview 同源代理（Q13），无预览节点诚实跳过（fail-soft 不伪造）。
 */

export function mount(root: HTMLElement): void {
  const nodes = Array.from(root.querySelectorAll<HTMLAnchorElement>('.gnode[data-sample]')).filter(
    (a) => a.dataset.sample !== undefined && a.dataset.sample !== ''
  );
  if (nodes.length === 0) return;

  const bar = document.createElement('div');
  bar.className = 'genre-scan-bar';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-secondary genre-scan-btn';
  btn.textContent = '▶ 扫听我的流派宇宙';
  btn.setAttribute('aria-label', '逐个试听各流派的代表唱片（30 秒预览）');
  const status = document.createElement('span');
  status.className = 'small genre-scan-status';
  status.setAttribute('role', 'status');
  bar.append(btn, status);
  root.parentElement?.insertBefore(bar, root);

  const audio = new Audio();
  audio.preload = 'none';
  let i = -1;
  let scanning = false;

  const clearMark = (): void => {
    for (const n of nodes) n.classList.remove('gnode-playing');
  };

  const stop = (): void => {
    scanning = false;
    audio.pause();
    clearMark();
    btn.textContent = '▶ 扫听我的流派宇宙';
    status.textContent = '';
  };

  const playAt = (idx: number): void => {
    if (!scanning || idx >= nodes.length) {
      stop();
      return;
    }
    clearMark();
    i = idx;
    const node = nodes[idx]!;
    node.classList.add('gnode-playing');
    node.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'auto' });
    status.textContent = `正在试听：${node.textContent ?? ''}（${String(idx + 1)}/${String(nodes.length)}）`;
    audio.src = `/album/${node.dataset.sample ?? ''}/preview`;
    void audio.play().catch(() => {
      // 无预览/解析失败 = 诚实跳过下一节点（fail-soft 不伪造）
      window.setTimeout(() => {
        if (scanning) playAt(i + 1);
      }, 150);
    });
  };

  audio.addEventListener('ended', () => {
    if (scanning) playAt(i + 1);
  });
  audio.addEventListener('error', () => {
    if (scanning) playAt(i + 1);
  });

  btn.addEventListener('click', () => {
    if (scanning) {
      stop();
      return;
    }
    scanning = true;
    btn.textContent = '■ 停止扫听';
    playAt(0);
  });
}
