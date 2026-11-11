// 元数据上游全局串行限流（复审 V2）：
// ① 相邻上游请求 ≥ minIntervalMs（MusicBrainz 官方政策 = 平均 1 req/s，超速 100% 拒绝）
// ② 滑动 60s 窗口 ≤ maxPerMinute（自我防线，30/min）
// ③ 窗口满 → 本地直接 LocalRateLimitError（路由映射 429 + Retry-After），不打上游、不排队一分钟
// 单请求 per-IP 限流弃用（复审 V2）：单机部署后"每 IP"即用户自己，无防护意义。
export class LocalRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super('rate_limited');
  }
}

export interface LimiterOptions {
  minIntervalMs?: number;
  maxPerMinute?: number;
  /** 排队等待超过该阈值即本地 429（而非傻等），默认 3s */
  localRejectAfterMs?: number;
  nowFn?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}

export class MetadataRateLimiter {
  private chain: Promise<void> = Promise.resolve();
  private stamps: number[] = [];
  private readonly minIntervalMs: number;
  private readonly maxPerMinute: number;
  private readonly localRejectAfterMs: number;
  private readonly nowFn: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(opts: LimiterOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 1050;
    this.maxPerMinute = opts.maxPerMinute ?? 30;
    this.localRejectAfterMs = opts.localRejectAfterMs ?? 3000;
    this.nowFn = opts.nowFn ?? (() => Date.now());
    this.sleepFn = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** 全局串行执行：调用即排队，间隔/窗口约束在轮到自己时结算 */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    let issued = false;
    try {
      await prev;
      const wait = this.settledWaitMs();
      if (wait > this.localRejectAfterMs) throw new LocalRateLimitError(wait);
      if (wait > 0) await this.sleepFn(wait);
      issued = true;
      return await fn();
    } finally {
      // 本地拒绝不占上游窗口；真实发起才记时间戳
      if (issued) this.stamps.push(this.nowFn());
      release();
    }
  }

  /** 轮到本次时的等待毫秒数：串行间隔约束 与 60s 滑窗约束 取大者 */
  private settledWaitMs(): number {
    const t = this.nowFn();
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    const first = this.stamps[0];
    const windowWait = first !== undefined && this.stamps.length >= this.maxPerMinute ? first + 60_000 - t : 0;
    const last = this.stamps.at(-1);
    const gapWait = last === undefined ? 0 : Math.max(0, this.minIntervalMs - (t - last));
    return Math.max(windowWait, gapWait);
  }
}
