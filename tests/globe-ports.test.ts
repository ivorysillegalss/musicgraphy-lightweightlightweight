// globe-view 端口契约单测（DR-M0 · 设计参考 03 §5.5 波次 0「契约可编译、Mock 可切态」）
// 覆盖：PlaybackPort Null/Mock（getPlayState 默认值、setState 触发订阅、退订后不再通知、
// 未知语义容错）+ StylePort registry（默认两主题、setTheme 未知 id 抛错、subscribe/退订）。
// 红线：契约引擎无关（ports.ts 零 import）——换实现零改地图（DoD）。
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MockPlaybackAdapter } from '../src/client/islands/globe-view/adapters/mock-playback';
import { NullPlaybackAdapter } from '../src/client/islands/globe-view/adapters/null-playback';
import { RegistryStyleAdapter } from '../src/client/islands/globe-view/adapters/registry-theme';
import type { PlayState, ThemeDescriptor } from '../src/client/islands/globe-view/ports';

describe('PlaybackPort Null 实现（DR-M0：无播放引擎时地图照常工作）', () => {
  test('getPlayState 恒 idle：任意 featureId（含未知/空串/特殊字符）容错不抛错', () => {
    const port = new NullPlaybackAdapter();
    for (const id of ['FR', 'unknown-id', '', '国家面#01', '{"iso":"CN"}']) {
      assert.equal(port.getPlayState(id), 'idle');
    }
  });

  test('subscribe 登记返回退订函数；本实现无状态变化路径，订阅者零通知', () => {
    const port = new NullPlaybackAdapter();
    let calls = 0;
    const off = port.subscribe(() => {
      calls += 1;
    });
    assert.equal(typeof off, 'function');
    off(); // 退订（幂等安全）
    off();
    assert.equal(calls, 0);
  });
});

describe('PlaybackPort Mock 实现（DR-M0 波次 0：Mock 可切态，演示点击国家切播放态）', () => {
  test('未知 featureId 容错：默认 idle（与 Null 同语义）', () => {
    const port = new MockPlaybackAdapter();
    assert.equal(port.getPlayState('never-set'), 'idle');
  });

  test('setState 切态并通知订阅者（featureId + 最新状态）', () => {
    const port = new MockPlaybackAdapter();
    const seen: Array<[string, PlayState]> = [];
    port.subscribe((id, state) => seen.push([id, state]));
    port.setState('FR', 'selected');
    port.setState('FR', 'playing');
    assert.equal(port.getPlayState('FR'), 'playing');
    assert.deepEqual(seen, [
      ['FR', 'selected'],
      ['FR', 'playing']
    ]);
  });

  test('退订后不再收到通知；在册订阅者不受影响', () => {
    const port = new MockPlaybackAdapter();
    const a: string[] = [];
    const b: string[] = [];
    const offA = port.subscribe((id) => a.push(id));
    port.subscribe((id) => b.push(id));
    port.setState('CN', 'selected');
    offA();
    port.setState('CN', 'playing');
    assert.deepEqual(a, ['CN']); // 退订后不再增长
    assert.deepEqual(b, ['CN', 'CN']); // 在册照常
    assert.equal(port.getPlayState('CN'), 'playing');
  });

  test('同一 featureId 多次 setState：通知按序携带每次新值', () => {
    const port = new MockPlaybackAdapter();
    const states: PlayState[] = [];
    port.subscribe((_id, state) => states.push(state));
    port.setState('JP', 'idle');
    port.setState('JP', 'selected');
    port.setState('JP', 'playing');
    port.setState('JP', 'idle');
    assert.deepEqual(states, ['idle', 'selected', 'playing', 'idle']);
  });
});

describe('StylePort Registry 实现（DR-M0：主题 id 账本，视觉落实归 D3 适配器）', () => {
  test('默认两主题（light 奶油纸面 / dark 暗色），active = 注册表第一项', () => {
    const port = new RegistryStyleAdapter();
    assert.deepEqual(port.getThemes(), [
      { id: 'light', label: '奶油纸面' },
      { id: 'dark', label: '暗色' }
    ]);
    assert.equal(port.getActiveTheme(), 'light');
  });

  test('setTheme 未知 id 抛错，active 保持不变', () => {
    const port = new RegistryStyleAdapter();
    assert.throws(() => port.setTheme('vintage'), /未知主题 id/);
    assert.equal(port.getActiveTheme(), 'light');
  });

  test('setTheme 切换成功并通知订阅者；getThemes 返回副本（外部改动不串扰注册表）', () => {
    const port = new RegistryStyleAdapter();
    const seen: string[] = [];
    port.subscribe((id) => seen.push(id));
    port.setTheme('dark');
    assert.equal(port.getActiveTheme(), 'dark');
    assert.deepEqual(seen, ['dark']);
    const themes = port.getThemes();
    themes.length = 0; // 外部破坏副本
    assert.equal(port.getThemes().length, 2);
  });

  test('subscribe 退订后不再收到通知', () => {
    const port = new RegistryStyleAdapter();
    const seen: string[] = [];
    const off = port.subscribe((id) => seen.push(id));
    off();
    port.setTheme('dark');
    assert.deepEqual(seen, []);
    assert.equal(port.getActiveTheme(), 'dark'); // 切换本身不受退订影响
  });

  test('构造传入自定义注册表：描述符可带扩展字段（索引签名放行，D3 maplibre 适配器扩展位）', () => {
    const custom: ThemeDescriptor[] = [
      { id: 'paper', label: '纸面', styleUrl: '/static/geo/styles/paper.json' },
      { id: 'ink', label: '暗墨', styleUrl: '/static/geo/styles/ink.json' }
    ];
    const port = new RegistryStyleAdapter(custom);
    assert.equal(port.getThemes()[0]?.label, '纸面');
    assert.equal(port.getActiveTheme(), 'paper');
    port.setTheme('ink');
    assert.equal(port.getActiveTheme(), 'ink');
  });
});
