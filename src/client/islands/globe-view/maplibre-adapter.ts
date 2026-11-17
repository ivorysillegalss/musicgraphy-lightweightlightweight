/**
 * maplibre-adapter.ts —— 地图渲染适配器（DR-M2/M3 + DR-M4 · 引擎粘合进 DR-M0 端口）。
 *
 * **全仓唯一运行时 `import 'maplibre-gl'` 的文件**（评审案 5db47b4 §6——用户否决引擎裁决
 * 时整体删除/替换本文件即可回滚，端口契约与渲染层 diff = 0，DR-M0 DoD「换实现零改地图」）。
 *
 * 粘合面（设计参考 03 §5.5 波次 2/3 完成态 + 波次 4 交互编排）：
 * - StylePort → setStyle：`setStyle(buildMapStyle(id, undefined, availableCodes), { diff: true })`
 *   ——diff 语义下 source（data URL 未变）与图层 id 保持，仅 paint 更新 = **换主题不重建
 *   数据层**、不重载页面（§2.4 Radiooooo setStyle 语义的本项目等价落实：diff 保留数据层）；
 *   D4：可用性白名单异步就绪后同样走 setStyle diff 注入 empty 态染色（§2.2 第 5 条）。
 * - PlaybackPort → setFeatureState：五态表达式预置在 style（five-state.ts），端口状态
 *   变化只 `setFeatureState` 增量切换——「数据不动，状态动」（§2.3），初始全量同步 + 新瓦片
 *   发现补同步（globe 背面要素随相机转动才进 querySourceFeatures，moveend 兜底）。
 * - 标注 = DOM Marker（labels.ts 决策注释）：hover 与选中态各持一枚常驻 Marker 实例
 *   （remove/addTo 复用，零重建），点位 = labels 全量代表点（经 GeoJSONSource.getData()
 *   取未裁剪几何现算，零二次网络请求）。
 *
 * 交互编排（DR-M4 · 设计参考 03 §2.2 交互层同构）：
 * - hover：仅白名单国家换 `cursor:pointer` + feature-state hover（mouseleave 复位，
 *   Radiooooo §2.2 第 6 条同款；白名单未就绪/降级 fail-open 时全部可 hover）；
 * - click 白名单内：相机聚焦（flyTo + 自定义 easing，camera.ts 纯函数；**相机状态不入
 *   URL**——过渡态不入链，评审案 DR-M4 红线边界）+ 业务选中态切换：
 *   idle → selected → playing → idle 循环（Mock 端口 = 五态演示通道，D3 selected 切换的
 *   D4 扩展：补 playing 档使「五态染色（Mock 播放态）」验收链单通道可达）；选中变化经
 *   `onCountrySelect` 回调通知宿主层同步 URL（乙-1：URL 即状态）。
 * - click 白名单外（empty 态国家）：轻量 DOM 通知（复用 app.css 既有 `.toast` 岛屿增强层
 *   样式，零新 CSS 零新依赖；Radiooooo `publish("country.empty")` 同语义）。
 * - 程序化通道 `select()` / `focus()`：URL 初始化与 popstate 恢复入口（globe-view.ts 调用）。
 * - **'-99' 兜底裁决**：白名单匹配键 = geoFeatureKey 同源三档（iso_a2 优先 → iso_a3 →
 *   `'name:' + name_en`）；GPU 侧第三档以 match + concat 表达式落在 five-state.ts（注释
 *   在档）。France/Norway（NE 110m ISO 双 '-99'）以 `name:France` / `name:Norway` 入
 *   mock 白名单；其余三个 -99 要素不入名单 = 恒 empty（诚实呈现「无档案」）。
 *
 * gesture 禁用对齐 §2.1（dragRotate/touchPitch = false；doubleClickZoom = false；
 * renderWorldCopies = false；maxZoom = 6）。BSD-3 归因 = attributionControl: false，
 * 文案放 /atlas 页脚静态行（评审案 §5 第 2/3 条处置）。
 */
import { MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, MapLayerMouseEvent, MapSourceDataEvent, StyleSpecification } from 'maplibre-gl';
import { easeInOutCubic, FOCUS_DURATION_MS, focusViewFromBbox, type FocusView } from './camera';

// v6 worker 显式指路（必须先于任何 Map 构造——模块加载即生效）：
// maplibre v6 默认 worker URL = new URL('./maplibre-gl-worker.mjs', import.meta.url)，非字面量
// 拼接令 vite 无法静态识别 → 构建产物缺 worker 文件 → 运行时 404 → worker 静默失败 →
// 地图永久停摆（/atlas 两主题皆空白，2026-11-17 实跑发现）。修复 = worker 文件经
// scripts/copy-maplibre-worker.mjs（prebuild）自托管进 /static/ + 此处 setWorkerUrl 显式
// 指路（乙-5 自托管同源；升级 maplibre 后文件由 prebuild 自动重拷）。
setWorkerUrl('/static/maplibre-gl-worker.mjs');
import { buildLabels, featureBbox, geoFeatureKey, type GeoFeatureCollectionLike, type LabelPoint } from './labels';
import { buildMapStyle } from './maplibre-style';
import type { PlayState, PlaybackPort, StylePort } from './ports';
import type { MockPlaybackAdapter } from './adapters/mock-playback';

export interface GlobeMountOptions {
  /** 播放状态源（Null = 无播放引擎地图照常工作；Mock = 演示切态）。 */
  playback: PlaybackPort;
  /** 样式主题源（registry-theme.ts 注册表；descriptor id → buildMapStyle 映射在本适配器完成）。 */
  stylePort: StylePort;
  /**
   * 可用性白名单 loader（D4 · availability.ts fetchAvailability——G2 换真 API 仅换宿主层
   * loader 本函数）；resolve null = fail-open「全部可用」。省略 = 白名单不接（D3 基线）。
   */
  availability?: Promise<string[] | null>;
  /** URL 初始国家键（globe-view.ts 解析 location.search；白名单校验后选中 + 聚焦）。 */
  initialCountry?: string | null;
  /** 国家选中态变化回调（宿主层 URL 镜像缝；null = 清除选中）。程序化 select 不触发。 */
  onCountrySelect?: (key: string | null) => void;
}

/** 程序化句柄（URL 初始化 / popstate 恢复入口 + 资源释放）。 */
export interface GlobeMapHandle {
  dispose(): void;
  /** 程序化选中/清除（URL 初始化与 popstate 恢复；不触发 onCountrySelect、不聚焦）。 */
  select(key: string | null): void;
  /** 相机聚焦白名单国家（bbox → flyTo；要素几何未就绪时挂起，source 数据到达后补飞）。 */
  focus(key: string): void;
}

/** 常驻标注槽（Marker 实例 + 自有 DOM 元素；显隐 = remove/addTo 复用，零重建）。 */
interface MarkerSlot {
  marker: Marker;
  el: HTMLDivElement;
}

/** 空态点击通知自消失时长（toast 一次性提示，非阻塞）。 */
const TOAST_MS = 2600;

/** 主题态挂载面：documentElement（app.css html[data-theme] token 桥作用域）+ 岛根（SSR 壳样式）。 */
function syncThemeDom(root: HTMLElement, themeId: string): void {
  document.documentElement.setAttribute('data-theme', themeId);
  root.dataset.theme = themeId;
}

export function mountGlobeMap(root: HTMLElement, opts: GlobeMountOptions): GlobeMapHandle {
  const initialTheme = opts.stylePort.getActiveTheme();
  const prevThemeAttr = document.documentElement.getAttribute('data-theme');
  syncThemeDom(root, initialTheme);

  // —— 可用性白名单（D4）：null = 全部可用（D3 基线 / fail-open / 未接）——
  let availableCodes: Set<string> | null = null;
  let disposed = false;

  const styleOf = (themeId: string): StyleSpecification =>
    buildMapStyle(themeId, undefined, availableCodes === null ? null : [...availableCodes]);

  const map = new MapLibreMap({
    container: root,
    style: styleOf(initialTheme),
    attributionControl: false, // BSD-3 归因 = /atlas 页脚静态文案（评审案 §5 第 2/3 条）
    renderWorldCopies: false, // §2.1 Radiooooo 同款
    maxZoom: 6,
    doubleClickZoom: false,
    dragRotate: false, // 移动端防误触（§2.1 实录）
    touchPitch: false,
    center: [10, 22],
    zoom: 1.4
  });

  // —— StylePort 桥：主题切换 = setStyle diff（数据层不重建，白名单 paint 随 style 走）——
  const offTheme = opts.stylePort.subscribe((themeId) => {
    syncThemeDom(root, themeId);
    map.setStyle(styleOf(themeId), { diff: true });
  });

  // —— 播放/选中账本 ——
  const featureIds = new Map<string, string | number>();
  const labelPoints = new Map<string, LabelPoint>();
  const focusViews = new Map<string, FocusView>();
  let selectedKey: string | null = null;
  let selectedState: PlayState = 'idle';
  let pendingFocusKey: string | null = null;

  const applyPortState = (key: string, state: PlayState): void => {
    const id = featureIds.get(key);
    if (id === undefined) return; // 要素尚未进瓦片查询（globe 背面）——moveend 补同步会追平
    map.setFeatureState({ source: 'countries', id }, { playing: state === 'playing', selected: state === 'selected' });
  };
  const offPlaybackPaint = opts.playback.subscribe(applyPortState);

  /** 瓦片内要素反查 id（generateId 自动赋 id——不预测值本身，按属性 key 建索引）+ 全量补同步。 */
  const syncSourceFeatures = (): void => {
    for (const f of map.querySourceFeatures('countries')) {
      const key = geoFeatureKey(f.properties ?? {});
      if (!featureIds.has(key) && (typeof f.id === 'number' || typeof f.id === 'string')) {
        featureIds.set(key, f.id);
      }
    }
    for (const key of featureIds.keys()) applyPortState(key, opts.playback.getPlayState(key));
  };

  // —— 相机聚焦（DR-M4 · Radiooooo focusByIso 同款；相机态不入 URL）——
  const focusCountry = (key: string): void => {
    const view = focusViews.get(key);
    if (view === undefined) {
      pendingFocusKey = key; // source 几何未就绪（异步）——loadLabelPoints 后补飞
      return;
    }
    map.flyTo({ center: view.center, zoom: view.zoom, duration: FOCUS_DURATION_MS, easing: easeInOutCubic });
  };

  // —— 业务选中态账本统一入口：清旧、立新、镜像进端口（Mock 才有状态源）、可选通知宿主 ——
  const setSelected = (key: string | null, o?: { notify?: boolean; state?: PlayState }): void => {
    const mock = opts.playback as Partial<MockPlaybackAdapter>;
    if (selectedKey !== null && selectedKey !== key && typeof mock.setState === 'function') {
      mock.setState(selectedKey, 'idle'); // 换选国：旧国端口态归零（Radiooooo unHighlight 同语义）
    }
    selectedKey = key;
    selectedState = key === null ? 'idle' : (o?.state ?? 'selected');
    if (key !== null && typeof mock.setState === 'function') mock.setState(key, selectedState);
    if (o?.notify === true) opts.onCountrySelect?.(key);
  };

  /** 标注点 + 聚焦视图装配：source 数据就绪后取全量 FeatureCollection（未裁剪几何）现算（零二次请求）。 */
  const loadLabelPoints = async (): Promise<void> => {
    if (labelPoints.size > 0) return;
    try {
      const src = map.getSource('countries') as GeoJSONSource | undefined;
      if (!src) return;
      const data = await src.getData();
      if (data.type !== 'FeatureCollection') return;
      const fc = data as unknown as GeoFeatureCollectionLike;
      for (const lp of buildLabels(fc)) labelPoints.set(lp.iso, lp);
      // D4：相机聚焦视图（每要素代表环 bbox → center/zoom；与标注点同环同中心，聚焦不跳位）
      for (const f of fc.features) {
        const key = geoFeatureKey(f.properties ?? {});
        const bbox = featureBbox(f.geometry);
        if (bbox !== null && !focusViews.has(key)) focusViews.set(key, focusViewFromBbox(bbox));
      }
      if (pendingFocusKey !== null) {
        const k = pendingFocusKey;
        pendingFocusKey = null;
        focusCountry(k);
      }
    } catch {
      /* 标注/聚焦视图是馈赠（P1-1）：装配失败静默——地图照常，仅无国名标注与聚焦降级 */
    }
  };

  const onSourceData = (e: MapSourceDataEvent): void => {
    if (e.sourceId !== 'countries' || !e.isSourceLoaded) return;
    syncSourceFeatures();
    void loadLabelPoints();
  };
  map.on('sourcedata', onSourceData);
  map.on('moveend', syncSourceFeatures); // globe 背面要素随相机转动才被发现——moveend 补同步

  // —— DOM 标注（hover + 选中钉住；labels.ts 决策注释）——
  const makeSlot = (): MarkerSlot => {
    const el = document.createElement('div');
    el.className = 'globe-label';
    return { marker: new Marker({ element: el }), el };
  };
  const hoverSlot = makeSlot();
  const pinnedSlot = makeSlot();

  const showMarker = (slot: MarkerSlot, lp: LabelPoint, selected: boolean): void => {
    slot.el.textContent = lp.nameZh !== '' ? lp.nameZh : lp.nameEn; // name_zh 缺失退化 name_en（DR-G1 资产保证非空）
    slot.el.className = `globe-label${selected ? ' is-selected' : ''}`;
    slot.marker.setLngLat([lp.lng, lp.lat]).addTo(map);
  };
  const hideMarker = (slot: MarkerSlot): void => {
    slot.marker.remove();
  };

  let hoverKey: string | null = null;

  const setHover = (key: string | null, mapFeatureId: string | number | undefined): void => {
    if (hoverKey !== null) {
      const prevId = featureIds.get(hoverKey) ?? mapFeatureId;
      if (prevId !== undefined) map.setFeatureState({ source: 'countries', id: prevId }, { hover: false });
    }
    hoverKey = key;
    if (key !== null && (typeof mapFeatureId === 'number' || typeof mapFeatureId === 'string')) {
      map.setFeatureState({ source: 'countries', id: mapFeatureId }, { hover: true });
    }
  };

  // —— hover（DR-M4）：仅白名单国家 pointer + hover 态；白名单 null = 全部可用（fail-open）——
  const onMove = (e: MapLayerMouseEvent): void => {
    const f = e.features?.[0];
    if (!f) return;
    const key = geoFeatureKey(f.properties ?? {});
    if (availableCodes !== null && !availableCodes.has(key)) {
      // 空态国家：无 pointer、无 hover、无标注（§2.2「mousemove 仅白名单换 cursor」同款）
      if (hoverKey !== null) {
        setHover(null, undefined);
        hideMarker(hoverSlot);
      }
      map.getCanvas().style.cursor = '';
      return;
    }
    map.getCanvas().style.cursor = 'pointer';
    if (key !== hoverKey) setHover(key, f.id);
    const lp = labelPoints.get(key);
    if (lp !== undefined) showMarker(hoverSlot, lp, opts.playback.getPlayState(key) !== 'idle');
  };

  const onLeave = (): void => {
    map.getCanvas().style.cursor = '';
    setHover(null, undefined);
    hideMarker(hoverSlot);
  };
  map.on('mousemove', 'countries-layer', onMove);
  map.on('mouseleave', 'countries-layer', onLeave);

  // 选中/播放钉住标注（端口驱动，独立于 hover）：selected 或 playing 显示；该键归 idle 即收起
  let pinnedKey: string | null = null;
  const offPlaybackPin = opts.playback.subscribe((key, state) => {
    if (state === 'selected' || state === 'playing') {
      const lp = labelPoints.get(key);
      if (lp !== undefined) {
        showMarker(pinnedSlot, lp, true);
        pinnedKey = key;
      }
      return;
    }
    if (pinnedKey === key) {
      hideMarker(pinnedSlot);
      pinnedKey = null;
    }
  });

  // —— 空态点击通知（复用 app.css 既有 .toast 岛屿增强层样式；零新 CSS 零新依赖）——
  const toastTimers = new Set<ReturnType<typeof setTimeout>>();
  const toasts: HTMLDivElement[] = [];
  const showEmptyToast = (props: Record<string, unknown>): void => {
    const zh = typeof props['name_zh'] === 'string' && props['name_zh'] !== '' ? props['name_zh'] : null;
    const en = typeof props['name_en'] === 'string' && props['name_en'] !== '' ? props['name_en'] : null;
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = `「${zh ?? en ?? '该国家'}」暂无可浏览的专辑`;
    root.appendChild(el);
    toasts.push(el);
    const t = setTimeout(() => {
      el.remove();
      const i = toasts.indexOf(el);
      if (i >= 0) toasts.splice(i, 1);
      toastTimers.delete(t);
    }, TOAST_MS);
    toastTimers.add(t);
  };

  // —— click（DR-M4）：白名单外 = 空态通知；白名单内 = 聚焦 + 选中态循环 + URL 通知 ——
  const onClick = (e: MapLayerMouseEvent): void => {
    const f = e.features?.[0];
    if (!f) return;
    const key = geoFeatureKey(f.properties ?? {});
    if (availableCodes !== null && !availableCodes.has(key)) {
      showEmptyToast(f.properties ?? {});
      return;
    }
    focusCountry(key); // Radiooooo focusByIso 同款（相机态不入 URL）
    if (selectedKey === key) {
      // 同国再点：selected → playing → idle 循环（Mock 端口五态演示通道；D3 切换语义的 D4 扩展）
      const next: PlayState = selectedState === 'selected' ? 'playing' : 'idle';
      if (next === 'idle') setSelected(null, { notify: true });
      else setSelected(key, { notify: true, state: next });
    } else {
      setSelected(key, { notify: true, state: 'selected' });
    }
  };
  map.on('click', 'countries-layer', onClick);

  // —— 可用性白名单注入（异步；G2 替换点见 availability.ts）+ URL 初始国家应用 ——
  const initialCountry = opts.initialCountry ?? null;
  const applyInitialCountry = (): void => {
    if (initialCountry === null) return;
    if (availableCodes === null || availableCodes.has(initialCountry)) {
      setSelected(initialCountry); // URL 初始化：不 notify（宿主已知）、不聚焦（下面单独飞）
      focusCountry(initialCountry);
    } else {
      opts.onCountrySelect?.(null); // 陈旧分享参数（白名单外国家）——宿主抹掉 country 参数
    }
  };
  if (opts.availability !== undefined) {
    void opts.availability.then((codes) => {
      if (disposed) return;
      if (codes !== null) {
        availableCodes = new Set(codes);
        // empty 态染色生效（setStyle diff：source/图层 id 保持仅 paint 更新——数据层零重建）
        map.setStyle(styleOf(opts.stylePort.getActiveTheme()), { diff: true });
        syncSourceFeatures(); // diff 下 feature-state 保留，幂等补同步防御
      }
      applyInitialCountry();
    });
  } else {
    applyInitialCountry();
  }

  // —— 资源释放（岛屿重挂/卸载纪律：map.remove() + 全部退订 + 主题态还原 + toast 清理）——
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      offTheme();
      offPlaybackPaint();
      offPlaybackPin();
      map.off('sourcedata', onSourceData);
      map.off('moveend', syncSourceFeatures);
      map.off('mousemove', 'countries-layer', onMove);
      map.off('mouseleave', 'countries-layer', onLeave);
      map.off('click', 'countries-layer', onClick);
      hideMarker(hoverSlot);
      hideMarker(pinnedSlot);
      for (const t of toastTimers) clearTimeout(t);
      toastTimers.clear();
      for (const el of toasts.splice(0)) el.remove();
      map.remove();
      if (prevThemeAttr === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', prevThemeAttr);
    },
    select: (key) => {
      setSelected(key);
    },
    focus: (key) => {
      focusCountry(key);
    }
  };
}
