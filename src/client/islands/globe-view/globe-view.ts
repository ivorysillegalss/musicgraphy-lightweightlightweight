/**
 * globe-view.ts —— 地球岛屿入口（DR-M3 · 第 6 岛屿，vite 动态 import 懒加载 chunk）。
 *
 * 挂载点契约（main.ts ISLANDS 注册表）：`<div data-island="globe-view">` → mount(root)。
 * 根属性（SSR 壳注入，均可选）：
 * - data-theme：初始主题（'light' | 'dark'，默认 light）——经 RegistryStyleAdapter 校验后
 *   由 maplibre 适配器映射到 buildMapStyle（ThemeDescriptor.id = themeId，映射在适配器）；
 * - data-playback：'mock' = MockPlaybackAdapter（演示五态切态：点击国家切 selected，
 *   DR-M0 波次 0 验收面）；缺省 = NullPlaybackAdapter（无播放引擎地图照常工作）。
 * 资源释放：卸载/重挂（unmount 或再次 mount）→ dispose = map.remove() + 全部退订 +
 * documentElement 主题态还原（见 maplibre-adapter.ts 返回的 cleanup）。
 */
import { MockPlaybackAdapter } from './adapters/mock-playback';
import { NullPlaybackAdapter } from './adapters/null-playback';
import { RegistryStyleAdapter } from './adapters/registry-theme';
import { mountGlobeMap } from './maplibre-adapter';

/** 每根挂载点的清理函数（弱引用不阻碍 GC）。 */
const cleanups = new WeakMap<HTMLElement, () => void>();

export function mount(root: HTMLElement): void {
  cleanups.get(root)?.(); // 重挂防御：先释放旧实例（loader 侧另有 data-island-mounted 哨兵，双保险）
  const initialTheme = root.dataset.theme === 'dark' ? 'dark' : 'light';
  const playback = root.dataset.playback === 'mock' ? new MockPlaybackAdapter() : new NullPlaybackAdapter();
  const stylePort = new RegistryStyleAdapter();
  if (stylePort.getActiveTheme() !== initialTheme) {
    stylePort.setTheme(initialTheme); // 注册表默认第一项 light——岛根 dark 时先校齐再挂载
  }
  cleanups.set(root, mountGlobeMap(root, { playback, stylePort }));
}

export function unmount(root: HTMLElement): void {
  cleanups.get(root)?.();
  cleanups.delete(root);
}
