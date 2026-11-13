// 封面下载门（IM-22 R3/R4，规格 = 05-系统架构设计/评审案-多用户并发与封面缓存.md）：
// ① single-flight（R3）：同 cover_url 并发请求合并为一次上游 fetch——懒下载路由与
//    onAlbumAdded 钩子两调用点统一经 download() 进入，第二个并发者直接共享在途 Promise。
// ② 独立「串行 ≥1s + 在途 ≤2」门（Q2）：CAA/archive.org 无 30/min 硬规，不占搜索 30/min 窗
//    （串行 = 相邻上游发起间隔 ≥ minIntervalMs，与 MetadataRateLimiter 同语义；在途 = 上游
//    fetch+落盘管线并发上限）。存量回填 5000 张 ≈ 88min 低峰可跑。
// ③ 回填空闲门（R4，Q3 N=10s）：批量回填仅在门空闲（无在途/无在途合并/外部不忙碌）持续
//    > idleMs 时注入下一张；任何交互到达（download() 调用）即重置空闲钟，交互永远优先。
// 与 MetadataRateLimiter（queue.ts）同族：nowFn/sleepFn 注入零网络可测（W1-2 先例）；
// 全部手写零新依赖（G1 运行时依赖 = 2）；缓存只存 url→Promise 引用，无内容驻留（纪律②）。
import { downloadCover, type CoverDownloadOptions } from './covers';

export interface CoverGateOptions {
  /** 相邻两次上游发起的最小间隔 ms（Q2 默认 1000） */
  minIntervalMs?: number;
  /** 同时在途的上游 fetch+落盘管线上限（Q2 默认 2） */
  maxInFlight?: number;
  /** 回填注入所需空闲时长 ms（Q3 默认 10_000） */
  idleMs?: number;
  /** 外部忙碌信号（预留：搜索队列联动接线用；缺省 = 恒不忙碌，门内自足判定） */
  busyProbe?: () => boolean;
  nowFn?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}

export class CoverGate {
  private readonly minIntervalMs: number;
  private readonly maxInFlight: number;
  private readonly idleMs: number;
  private readonly busyProbe: () => boolean;
  private readonly nowFn: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  /** 发起时刻调度链：间隔记账与名额占用在临界区内原子完成（防并发穿透同睡同发起） */
  private schedTail: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private lastStart = -Infinity;
  private readonly slotWaiters: Array<() => void> = [];
  /** R3①：url → 在途下载（含落盘）Promise；settle 后摘除 */
  private readonly single = new Map<string, Promise<string>>();
  /** R4：门最近一次活动时刻（调用到达/发起/结束均刷新）；构造即计时 = 出生即空闲 */
  private lastActivityAt: number;

  constructor(opts: CoverGateOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.maxInFlight = opts.maxInFlight ?? 2;
    this.idleMs = opts.idleMs ?? 10_000;
    this.busyProbe = opts.busyProbe ?? (() => false);
    this.nowFn = opts.nowFn ?? (() => Date.now());
    this.sleepFn = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.lastActivityAt = this.nowFn();
  }

  /** 交互路径（懒下载路由 + onAlbumAdded 钩子统一入口）：single-flight 合并 + 过门 */
  download(opts: CoverDownloadOptions): Promise<string> {
    this.lastActivityAt = this.nowFn();
    const existing = this.single.get(opts.coverUrl);
    if (existing !== undefined) return existing;
    const p = this.runGate(() => downloadCover(opts)).finally(() => {
      if (this.single.get(opts.coverUrl) === p) this.single.delete(opts.coverUrl);
    });
    this.single.set(opts.coverUrl, p);
    return p;
  }

  /** 回填路径（R4）：仅在门空闲持续 > idleMs 后注入下一张，注入后与交互同门排队 */
  async downloadBackfill(opts: CoverDownloadOptions): Promise<string> {
    await this.waitIdle();
    return this.download(opts);
  }

  /** 当前已空闲时长 ms：门内忙碌（在途/在途合并/外部信号）时恒为 0 */
  idleForMs(): number {
    return this.busy() ? 0 : Math.max(0, this.nowFn() - this.lastActivityAt);
  }

  private busy(): boolean {
    return this.inFlight > 0 || this.single.size > 0 || this.busyProbe();
  }

  private async waitIdle(): Promise<void> {
    const step = Math.min(1000, this.idleMs);
    while (this.nowFn() - this.lastActivityAt < this.idleMs || this.busy()) {
      await this.sleepFn(step);
    }
  }

  /** 门体：FIFO 调度——临界区内等发起间隔、记账、占用名额；发起后立即让出调度权，
   *  下载本身并发进行（在途 ≤ maxInFlight，由名额与释放通知约束） */
  private async runGate<T>(fn: () => Promise<T>): Promise<T> {
    for (;;) {
      const prev = this.schedTail;
      let release!: () => void;
      this.schedTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started = false;
      try {
        await prev;
        if (this.inFlight >= this.maxInFlight) {
          // 名额满：让出调度权并挂起，等任一在途结束后重排
          await new Promise<void>((resolve) => this.slotWaiters.push(resolve));
          continue; // finally：未发起 → 让出调度权
        }
        const wait = Math.max(0, this.lastStart + this.minIntervalMs - this.nowFn());
        if (wait > 0) await this.sleepFn(wait);
        this.lastStart = this.nowFn();
        this.lastActivityAt = this.lastStart;
        this.inFlight++;
        started = true;
      } finally {
        if (!started) release();
      }
      release(); // 发起完成即让出调度权：后续下载按间隔排队，不阻塞在途并发
      try {
        return await fn();
      } finally {
        this.inFlight--;
        this.lastActivityAt = this.nowFn();
        this.slotWaiters.shift()?.(); // 名额释放：唤醒一个等待重排者
      }
    }
  }
}
