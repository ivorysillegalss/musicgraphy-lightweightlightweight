/**
 * PlaybackPort 的 Mock 实现（DR-M0 · 设计参考 03 §5.5 波次 0「Mock 可切态」）。
 *
 * 内部持 Map<featureId, PlayState>：setState 手动注入状态变化并通知订阅者——
 * 供单元测试与后续演示「点击国家切播放态」（五态染色走端口，渲染层零感知）。
 * 未知 featureId 的 getPlayState 容错返回 'idle'（与 Null 实现同语义）。
 */
import type { PlaybackPort, PlayState } from '../ports';

export class MockPlaybackAdapter implements PlaybackPort {
  private readonly states = new Map<string, PlayState>();
  private readonly listeners = new Set<(featureId: string, state: PlayState) => void>();

  getPlayState(featureId: string): PlayState {
    return this.states.get(featureId) ?? 'idle';
  }

  /** 手动注入状态变化（测试/演示用；非 PlaybackPort 契约面）并通知全部在册订阅者。 */
  setState(featureId: string, state: PlayState): void {
    this.states.set(featureId, state);
    for (const listener of this.listeners) {
      listener(featureId, state);
    }
  }

  subscribe(listener: (featureId: string, state: PlayState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
