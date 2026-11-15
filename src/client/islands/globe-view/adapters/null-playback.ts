/**
 * PlaybackPort 的 Null 实现（DR-M0 · 设计参考 03 §5.5 波次 0）。
 *
 * Null 语义：无播放引擎时地图照常工作——所有 featureId 恒返回 'idle'。本适配器自身
 * 不产生任何状态变化（无内部状态存储），因此订阅者不会被自动通知；通知只可能因
 * 「手动注入状态变化」发生——即换成 MockPlaybackAdapter/真实现之后的事（§5.5：
 * 预留接口 = 在数据流上留插座，不是在 UI 上留空按钮）。
 * subscribe 照常登记（登记/退订通路与真实现同构），保证「换实现零改地图」（DoD）。
 */
import type { PlaybackPort, PlayState } from '../ports';

export class NullPlaybackAdapter implements PlaybackPort {
  /** 监听登记表（本实现从不触发——仅维持登记/退订通路同构）。 */
  private readonly listeners = new Set<(featureId: string, state: PlayState) => void>();

  getPlayState(_featureId: string): PlayState {
    return 'idle';
  }

  subscribe(listener: (featureId: string, state: PlayState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
