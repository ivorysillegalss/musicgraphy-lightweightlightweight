/**
 * 岛屿 audio-viz —— 详情页听觉可视化（R-107 · S2-19，评审案 docs/design-refs-review.md Q14）：
 * 低依赖替代（07 包 03 号 Radiooooo 拆解 §2.2 同款）= AnalyserNode + Canvas 2D 时域示波器，
 * 零新依赖零 WebGL。依赖 Q13 同源代理流（跨源媒体 AnalyserNode 取样恒零——物理限制），
 * 因此本岛与 /album/:id/preview 代理互为前提、同批落地。
 * 播放中 rAF 画 getByteTimeDomainData 波形；暂停/结束 cancelAnimationFrame（dirty 按需纪律）。
 */

export function mount(root: HTMLElement): void {
  const audioId = root.dataset.audio ?? '';
  const audio = audioId === '' ? null : document.getElementById(audioId);
  const canvas = root.querySelector<HTMLCanvasElement>('canvas');
  const ctx = canvas?.getContext('2d') ?? null;
  if (audio === null || !(audio instanceof HTMLAudioElement) || ctx === null || canvas === null) return;

  let actx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let raf = 0;

  const accent =
    getComputedStyle(document.documentElement).getPropertyValue('--color-accent-text').trim() || '#b4632c';
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-card').trim() || '#fffdf8';

  const draw = (): void => {
    if (analyser === null) return;
    const w = canvas.width;
    const h = canvas.height;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const step = w / buf.length;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i]! / 128 - 1;
      const y = h / 2 + v * (h / 2 - 2);
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(i * step, y);
    }
    ctx.stroke();
    if (audio !== null && !audio.paused) raf = requestAnimationFrame(draw);
  };

  const stop = (): void => {
    cancelAnimationFrame(raf);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  audio.addEventListener('play', () => {
    try {
      if (actx === null) {
        actx = new AudioContext();
        const source = actx.createMediaElementSource(audio); // 每元素仅可一次（同源流无 CORS 污染）
        analyser = actx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);
        analyser.connect(actx.destination);
      }
      if (actx.state === 'suspended') void actx.resume();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    } catch {
      stop(); // WebAudio 不可用 = 诚实降级为无声波（试听本身不受影响）
    }
  });
  audio.addEventListener('pause', stop);
  audio.addEventListener('ended', stop);
  void raf;
}
