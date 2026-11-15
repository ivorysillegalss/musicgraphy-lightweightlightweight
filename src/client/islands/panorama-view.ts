/**
 * 岛屿 panorama-view —— 收藏全景 Canvas（R-106 · S2-13/S2-14，评审案 docs/design-refs-review.md Q6/Q7）。
 * Album Atlas® 的零依赖翻译（S2-8 拆解 → Q6 决策）：Canvas 2D LOD——缩远画主色方块（cover_color
 * 数据已在端点里，零额外请求），推近画封面缩略图（/covers 自托管流式；可见区按需加载 ≤12 并发、
 * 缓存上限 320 张）；拖动平移 / 滚轮与双指缩放 / 点击命中 → 详情；方向键与 +/−；
 * URL 即状态 ?x&y&z（replaceState 节流 300ms，可分享可后退，DD3）。
 * 缓动仅在 body[data-sensory="on"]（S2-17 感官层，缺省安静 = 视图即时到位）；渲染循环 = dirty 标志
 * 按需 rAF（空闲零耗电——Radiooooo 拆解 §2.2 同款纪律）。
 */

interface PNode {
  i: string;
  x: number;
  y: number;
  c: number | null;
  u: string | null;
  t: string;
  a: string;
}

interface PData {
  w: number;
  h: number;
  nodes: PNode[];
  stats: { records: number; decades: number; clusters: number };
}

/** 主色 1–15 → token varName（html.ts COLOR_TABLE 对齐；16/未知 = 灰兜底——colorOf 先例） */
const COLOR_VARS: Record<number, string> = {
  1: 'red', 2: 'orange', 3: 'amber', 4: 'yellow', 5: 'lime', 6: 'green', 7: 'teal', 8: 'blue',
  9: 'indigo', 10: 'purple', 11: 'magenta', 12: 'brown', 13: 'gray', 14: 'black', 15: 'white'
};

const sensoryOn = (): boolean => {
  const on = /(?:^|;\s*)mg_sensory=on(?:;|$)/.test(document.cookie);
  document.body.dataset.sensory = on ? 'on' : 'off';
  return on;
};

export function mount(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('.panorama-canvas');
  const ctx = canvas?.getContext('2d') ?? null;
  if (canvas === null || ctx === null) return;
  const smooth = sensoryOn();

  // —— 视图状态（data 空间 0..1000；x/y = 画布中心对应的 data 坐标，s = px/data 单位）——
  const view = { x: 500, y: 500, s: 0.8 };
  const target = { x: 500, y: 500, s: 0.8 };
  let minS = 0.2;
  let maxS = 20;
  let vw = 0;
  let vh = 0;
  let data: PData | null = null;
  let dirty = true;
  let raf = 0;

  // —— token 取色（CSS 变量唯一事实源，不复制色值）——
  const css = getComputedStyle(document.documentElement);
  const bg = css.getPropertyValue('--color-background').trim() || '#faf7f2';
  const colorCache = new Map<number, string>();
  const swatch = (n: number | null): string => {
    const key = n === null || COLOR_VARS[n] === undefined ? 13 : n;
    let v = colorCache.get(key);
    if (v === undefined) {
      v = css.getPropertyValue(`--swatch-${COLOR_VARS[key] ?? 'gray'}`).trim() || '#8a8580';
      colorCache.set(key, v);
    }
    return v;
  };

  // —— 封面缓存（LRU 语义 = Map 插入序；≤12 并发；失败记 null 不重试）——
  const imgs = new Map<string, HTMLImageElement | null>();
  let inflight = 0;
  const pending: string[] = [];
  const pump = (): void => {
    while (inflight < 12 && pending.length > 0) {
      const u = pending.shift()!;
      if (imgs.has(u)) continue;
      inflight++;
      const img = new Image();
      img.onload = () => {
        imgs.set(u, img);
        inflight--;
        dirty = true;
        pump();
      };
      img.onerror = () => {
        imgs.set(u, null);
        inflight--;
        pump();
      };
      img.src = `/covers/${u}`;
    }
  };
  const imgFor = (u: string): HTMLImageElement | null | undefined => {
    const v = imgs.get(u); // D3 最小门禁修复（挡共享 check 的 prefer-const 一行，提交说明披露；归属并行会话文件）
    if (v !== undefined) {
      imgs.delete(u);
      imgs.set(u, v); // 触碰即续期（LRU）
      if (imgs.size > 320) {
        const oldest = imgs.keys().next().value;
        if (typeof oldest === 'string' && oldest !== u) imgs.delete(oldest);
      }
      return v;
    }
    if (!pending.includes(u) && inflight < 12) pending.push(u);
    pump();
    return undefined;
  };

  // —— 尺寸 ——
  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = root.clientWidth;
    vh = root.clientHeight;
    canvas.width = Math.max(1, Math.round(vw * dpr));
    canvas.height = Math.max(1, Math.round(vh * dpr));
    canvas.style.width = `${String(vw)}px`;
    canvas.style.height = `${String(vh)}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    minS = Math.min(vw, vh) / 1100;
    maxS = minS * 60;
    target.s = Math.min(Math.max(target.s, minS), maxS);
    view.s = smooth ? view.s : target.s;
    dirty = true;
  };
  new ResizeObserver(resize).observe(root);
  resize();

  // —— 绘制 ——
  const coverSide = (): number => view.s * 8; // 封面边长（data 单位 × scale）
  const draw = (): void => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, vw, vh);
    if (data === null || data.nodes.length === 0) return;
    const side = coverSide();
    const half = side / 2;
    const dot = Math.max(2.2, Math.min(view.s * 2.4, 9));
    const coverMode = side >= 16;
    for (const n of data.nodes) {
      const sx = (n.x - view.x) * view.s + vw / 2;
      const sy = (n.y - view.y) * view.s + vh / 2;
      if (sx < -side || sx > vw + side || sy < -side || sy > vh + side) continue;
      if (coverMode && n.u !== null) {
        const img = imgFor(n.u);
        if (img !== undefined && img !== null) {
          ctx.drawImage(img, sx - half, sy - half, side, side);
          continue;
        }
      }
      ctx.fillStyle = swatch(n.c);
      const r = coverMode ? half : dot;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
  };
  const tick = (): void => {
    if (smooth) {
      view.x += (target.x - view.x) * 0.2;
      view.y += (target.y - view.y) * 0.2;
      view.s += (target.s - view.s) * 0.2;
      if (Math.abs(target.x - view.x) + Math.abs(target.y - view.y) + Math.abs(target.s - view.s) * 50 > 0.01) dirty = true;
    } else {
      view.x = target.x;
      view.y = target.y;
      view.s = target.s;
    }
    if (dirty) {
      dirty = false;
      draw();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // —— URL 即状态（DD3）：?x&y&z，节流 300ms replaceState ——
  let syncTimer = 0;
  const syncUrl = (): void => {
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      const url = new URL(location.href);
      url.searchParams.set('x', String(Math.round(target.x)));
      url.searchParams.set('y', String(Math.round(target.y)));
      url.searchParams.set('z', String(Math.round(target.s * 1000) / 1000));
      history.replaceState(null, '', url);
    }, 300);
  };
  const q = new URLSearchParams(location.search);
  const qx = Number(q.get('x'));
  const qy = Number(q.get('y'));
  const qz = Number(q.get('z'));
  if (Number.isFinite(qx) && qx > 0 && qx < 1000) target.x = view.x = qx;
  if (Number.isFinite(qy) && qy > 0 && qy < 1000) target.y = view.y = qy;
  if (Number.isFinite(qz) && qz > 0) target.s = view.s = qz;

  // —— 交互 ——
  const zoomAt = (mx: number, my: number, factor: number): void => {
    const ns = Math.min(Math.max(target.s * factor, minS), maxS);
    const wx = target.x + (mx - vw / 2) / target.s;
    const wy = target.y + (my - vh / 2) / target.s;
    target.x = wx - (mx - vw / 2) / ns;
    target.y = wy - (my - vh / 2) / ns;
    target.s = ns;
    if (!smooth) {
      view.x = target.x;
      view.y = target.y;
      view.s = target.s;
    }
    dirty = true;
    syncUrl();
  };
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (prev === undefined) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    if (pointers.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      target.x -= dx / view.s;
      target.y -= dy / view.s;
      if (!smooth) {
        view.x = target.x;
        view.y = target.y;
      }
      dirty = true;
      syncUrl();
    } else if (pointers.size === 2) {
      moved += Math.abs(dx) + Math.abs(dy);
      const pts = [...pointers.values()];
      const d0 = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      const rect = canvas.getBoundingClientRect();
      zoomAt((pts[0]!.x + pts[1]!.x) / 2 - rect.left, (pts[0]!.y + pts[1]!.y) / 2 - rect.top, 1 + dy * 0.002);
      if (d0 !== 0) dirty = true;
    }
  });
  const lift = (e: PointerEvent): void => {
    const had = pointers.delete(e.pointerId);
    if (had && pointers.size === 0 && moved < 4) {
      // 点击命中：最近节点（半径 = max(10px, 封面半边)）
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const half = coverSide() / 2;
      const r = Math.max(10, half);
      let best: PNode | null = null;
      let bestD = Infinity;
      if (data !== null) {
        for (const n of data.nodes) {
          const sx = (n.x - view.x) * view.s + vw / 2;
          const sy = (n.y - view.y) * view.s + vh / 2;
          const d = (sx - mx) * (sx - mx) + (sy - my) * (sy - my);
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
      }
      if (best !== null && bestD <= r * r) location.assign(`/album/${best.i}`);
    }
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false }
  );
  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const pan = 70 / view.s;
    if (e.key === 'ArrowLeft') { e.preventDefault(); target.x -= pan; }
    else if (e.key === 'ArrowRight') { e.preventDefault(); target.x += pan; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); target.y -= pan; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); target.y += pan; }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(vw / 2, vh / 2, 1.25); return; }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(vw / 2, vh / 2, 0.8); return; }
    else return;
    if (!smooth) {
      view.x = target.x;
      view.y = target.y;
    }
    dirty = true;
    syncUrl();
  });

  // —— 数据 ——
  void (async (): Promise<void> => {
    try {
      const res = await fetch('/fragment/panorama-data');
      const j = (await res.json()) as { data: PData };
      data = j.data;
      if (q.get('x') === null) {
        // 初次进入：全域概览（fit）
        const fit = Math.min(vw, vh) / 1050;
        target.x = view.x = 500;
        target.y = view.y = 500;
        target.s = view.s = Math.max(minS, Math.min(fit, maxS));
      }
      dirty = true;
    } catch (err) {
      console.error('[panorama-view] 数据加载失败', err);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, vw, vh);
      ctx.fillStyle = '#6b6560';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('全景数据加载失败——刷新重试（你的数据都在本地）。', vw / 2, vh / 2);
    }
  })();
  void raf;
}
