/**
 * globe-view.ts —— 地球岛屿入口（DR-M3 岛屿 + DR-M4 交互与 URL 接线）。
 *
 * 挂载点契约（main.ts ISLANDS 注册表）：`<div data-island="globe-view">` → mount(root)。
 * 根属性（SSR 壳注入，均可选）：
 * - data-theme：SSR 默认主题（'light' | 'dark'）——URL `?theme=` 优先（分享态覆盖壳默认）；
 * - data-playback：'mock' = MockPlaybackAdapter（点击白名单国家循环 idle→selected→playing
 *   演示五态染色，walking-skeleton 验收动作）；缺省 = NullPlaybackAdapter（无播放引擎
 *   地图照常工作）。
 *
 * URL 即状态（DR-M4 · 乙-1/DD3；序列化语义见 url-state.ts 头注释）：
 * - mount 读 `location.search` 初始化：country → 白名单校验后程序化选中 + 相机聚焦；
 *   theme → StylePort.setTheme（本岛另注入两档主题控件作为切换验收面）；
 * - **history 档位裁决**：国家选中切换 = pushState（后退可回上一国家/清除——对齐
 *   filter-cabin chips 点击的 DD3 push 语义）；主题切换 = replaceState（外观态轻动作，
 *   不污染历史）；统一 300ms 防抖写回（filter-cabin 连点合并同口径）；
 * - popstate：filter-cabin 同款 pathname 守卫 + 全量状态恢复（select/focus/setTheme，
 *   URL 已是新状态故不回写）；
 * - 相机 zoom/center/rotation 不入 URL（过渡态不入链——DR-M4 红线边界）。
 *
 * 可用性白名单（G2 静态替身）：fetchAvailability（availability.ts——G2 真 API 的唯一
 * 替换点）异步注入适配器；失败 fail-open 全部可用（地图永不因白名单不可得而不可用）。
 *
 * 资源释放：卸载/重挂（unmount 或再次 mount）→ dispose = map.remove + 全部退订 +
 * popstate/防抖清理 + 主题态还原（见 maplibre-adapter.ts 返回的 handle）。
 */
import { fetchAvailability } from './availability';
import { MockPlaybackAdapter } from './adapters/mock-playback';
import { NullPlaybackAdapter } from './adapters/null-playback';
import { RegistryStyleAdapter } from './adapters/registry-theme';
import { mountGlobeMap, type GlobeMapHandle } from './maplibre-adapter';
import { parseGlobeQuery, serializeGlobeQuery, withCountry, withTheme, type GlobeUrlState } from './url-state';

/** 每根挂载点的清理函数（弱引用不阻碍 GC）。 */
const cleanups = new WeakMap<HTMLElement, () => void>();

/** URL 写入防抖（filter-cabin 300ms 连点合并同口径——前端拆分方案 §4.2 契约）。 */
const URL_WRITE_DEBOUNCE_MS = 300;

export function mount(root: HTMLElement): void {
  cleanups.get(root)?.(); // 重挂防御：先释放旧实例（loader 侧另有 data-island-mounted 哨兵，双保险）
  const mountPathname = location.pathname;
  const ssrTheme = root.dataset.theme === 'dark' ? 'dark' : 'light';
  const initial = parseGlobeQuery(location.search); // URL 分享态优先于 SSR 壳默认
  const initialTheme = initial.theme ?? ssrTheme;

  const playback = root.dataset.playback === 'mock' ? new MockPlaybackAdapter() : new NullPlaybackAdapter();
  const stylePort = new RegistryStyleAdapter();
  if (stylePort.getActiveTheme() !== initialTheme) {
    stylePort.setTheme(initialTheme); // 注册表默认第一项 light——URL/壳要求 dark 时先校齐再挂载
  }

  // —— URL 镜像账本（写回经 300ms 防抖；popstate 反向恢复时不回写）——
  // theme 保留 null 语义：URL 未携带 = 用户未表态，写回时不额外生成 theme 参数
  let urlState: GlobeUrlState = { country: initial.country, theme: initial.theme };
  // push/replace 档位基准 = 上一条历史条目的国家值（初始条目即 mount 时的 URL 形态）
  let lastPushedCountry: string | null = initial.country;
  let urlTimer: ReturnType<typeof setTimeout> | undefined;

  /** 统一写回入口：国家值相对上一条目变化 → pushState（后退可回）；否则 replaceState。 */
  const writeUrl = (): void => {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      const url = `${mountPathname}${serializeGlobeQuery(urlState)}`;
      if (urlState.country !== lastPushedCountry) {
        history.pushState({}, '', url);
        lastPushedCountry = urlState.country;
      } else {
        history.replaceState({}, '', url);
      }
    }, URL_WRITE_DEBOUNCE_MS);
  };

  const handle: GlobeMapHandle = mountGlobeMap(root, {
    playback,
    stylePort,
    availability: fetchAvailability(),
    initialCountry: initial.country,
    onCountrySelect: (key) => {
      urlState = withCountry(urlState, key);
      writeUrl();
    }
  });

  // —— 主题切换控件（两档最小面；根元素 role="img" 内后代对 AT 不可达，故挂为兄弟节点）——
  const themeBar = document.createElement('div');
  themeBar.className = 'globe-theme';
  themeBar.setAttribute('role', 'group');
  themeBar.setAttribute('aria-label', '地图主题切换');
  const themeButtons = new Map<string, HTMLButtonElement>();
  for (const t of stylePort.getThemes()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t.label;
    b.dataset.themeId = t.id;
    b.addEventListener('click', () => {
      if (stylePort.getActiveTheme() === t.id) return;
      stylePort.setTheme(t.id); // 适配器订阅 → setStyle diff + DOM 主题同步（不重载页面）
      urlState = withTheme(urlState, t.id);
      writeUrl(); // 国家值未变 → replaceState（外观态不进历史——档位裁决）
    });
    themeButtons.set(t.id, b);
    themeBar.appendChild(b);
  }
  const syncThemeButtons = (active: string): void => {
    for (const [id, b] of themeButtons) b.setAttribute('aria-pressed', id === active ? 'true' : 'false');
  };
  syncThemeButtons(stylePort.getActiveTheme());
  const offThemeUi = stylePort.subscribe(syncThemeButtons);
  root.after(themeBar); // 岛根 role="img" 的兄弟节点（地图下方静态流式排布，app.css D4 段）

  // —— popstate 守卫与恢复（filter-cabin 同款：pathname 守卫 + URL→状态单向恢复）——
  const onPopstate = (): void => {
    if (location.pathname !== mountPathname) return; // 历史条目非本页文档——不做状态注入
    const s = parseGlobeQuery(location.search);
    urlState = { country: s.country, theme: s.theme };
    lastPushedCountry = s.country;
    const targetTheme = s.theme ?? ssrTheme; // URL 无 theme 参数 = 回 SSR 壳默认
    if (stylePort.getActiveTheme() !== targetTheme) stylePort.setTheme(targetTheme);
    handle.select(s.country); // 无参数 = 清除选中
    if (s.country !== null) handle.focus(s.country);
  };
  window.addEventListener('popstate', onPopstate);

  cleanups.set(root, () => {
    window.removeEventListener('popstate', onPopstate);
    clearTimeout(urlTimer);
    offThemeUi();
    themeBar.remove();
    handle.dispose();
  });
}

export function unmount(root: HTMLElement): void {
  cleanups.get(root)?.();
  cleanups.delete(root);
}
