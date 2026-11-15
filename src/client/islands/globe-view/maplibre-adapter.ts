/**
 * maplibre-adapter.ts —— 地图渲染适配器（DR-M2/M3 · 引擎粘合进 DR-M0 端口）。
 *
 * **全仓唯一运行时 `import 'maplibre-gl'` 的文件**（评审案 5db47b4 §6——用户否决引擎裁决
 * 时整体删除/替换本文件即可回滚，端口契约与渲染层 diff = 0，DR-M0 DoD「换实现零改地图」）。
 *
 * 粘合面（设计参考 03 §5.5 波次 2/3 完成态）：
 * - StylePort → setStyle：`setStyle(buildMapStyle(id), { diff: true })`——diff 语义下
 *   source（data URL 未变）与图层 id 保持，仅 paint 更新 = **换主题不重建数据层**、
 *   不重载页面（§2.4 Radiooooo setStyle(diff:false) 语义的本项目等价落实：diff 保留数据层）；
 * - PlaybackPort → setFeatureState：五态表达式预置在 style（five-state.ts），端口状态
 *   变化只 `setFeatureState` 增量切换——「数据不动，状态动」（§2.3），初始全量同步 + 新瓦片
 *   发现补同步（globe 背面要素随相机转动才进 querySourceFeatures，moveend 兜底）；
 * - 标注 = DOM Marker（labels.ts 决策注释）：hover 与选中态各持一枚常驻 Marker 实例
 *   （remove/addTo 复用，零重建），点位 = labels 全量代表点（经 GeoJSONSource.getData()
 *   取未裁剪几何现算，零二次网络请求）。
 *
 * 交互（D3 最小面，DR-M4 再扩展）：hover = feature-state + cursor + 标注；
 * click = 仅 Mock 播放端口（data-playback="mock"）提供 setState 时切换 selected——
 * 演示通道（DR-M0 波次 0「Mock 可切态」验收面），真播放引擎/白名单交互语义归 DR-M4 评审。
 * gesture 禁用对齐 §2.1（dragRotate/touchPitch = false；doubleClickZoom = false；
 * renderWorldCopies = false；maxZoom = 6）。BSD-3 归因 = attributionControl: false，
 * 文案放 /atlas 页脚静态行（评审案 §5 第 2/3 条处置）。
 */
import { MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, MapLayerMouseEvent, MapSourceDataEvent, StyleSpecification } from 'maplibre-gl';
import { buildLabels, geoFeatureKey, type LabelPoint } from './labels';
import { buildMapStyle } from './maplibre-style';
import type { PlayState, PlaybackPort, StylePort } from './ports';
import type { MockPlaybackAdapter } from './adapters/mock-playback';

export interface GlobeMountOptions {
  /** 播放状态源（Null = 无播放引擎地图照常工作；Mock = 演示切态）。 */
  playback: PlaybackPort;
  /** 样式主题源（registry-theme.ts 注册表；descriptor id → buildMapStyle 映射在本适配器完成）。 */
  stylePort: StylePort;
}

/** 常驻标注槽（Marker 实例 + 自有 DOM 元素；显隐 = remove/addTo 复用，零重建）。 */
interface MarkerSlot {
  marker: Marker;
  el: HTMLDivElement;
}

/** 主题态挂载面：documentElement（app.css html[data-theme] token 桥作用域）+ 岛根（SSR 壳样式）。 */
function syncThemeDom(root: HTMLElement, themeId: string): void {
  document.documentElement.setAttribute('data-theme', themeId);
  root.dataset.theme = themeId;
}

export function mountGlobeMap(root: HTMLElement, opts: GlobeMountOptions): () => void {
  const initialTheme = opts.stylePort.getActiveTheme();
  const prevThemeAttr = document.documentElement.getAttribute('data-theme');
  syncThemeDom(root, initialTheme);

  const styleOf = (themeId: string): StyleSpecification => buildMapStyle(themeId);

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

  // —— StylePort 桥：主题切换 = setStyle diff（数据层不重建，§2.4）——
  const offTheme = opts.stylePort.subscribe((themeId) => {
    syncThemeDom(root, themeId);
    map.setStyle(styleOf(themeId), { diff: true });
  });

  // —— PlaybackPort 桥：端口状态 → feature-state 增量染色 ——
  const featureIds = new Map<string, string | number>();
  const labelPoints = new Map<string, LabelPoint>();

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

  /** 标注点装配：source 数据就绪后取全量 FeatureCollection（未裁剪几何）现算代表点（零二次请求）。 */
  const loadLabelPoints = async (): Promise<void> => {
    if (labelPoints.size > 0) return;
    try {
      const src = map.getSource('countries') as GeoJSONSource | undefined;
      if (!src) return;
      const data = await src.getData();
      if (data.type !== 'FeatureCollection') return;
      for (const lp of buildLabels(data)) labelPoints.set(lp.iso, lp);
    } catch {
      /* 标注点是馈赠（P1-1）：装配失败静默——地图照常，仅无国名标注 */
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
  let pinnedKey: string | null = null;

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

  const onMove = (e: MapLayerMouseEvent): void => {
    const f = e.features?.[0];
    if (!f) return;
    const key = geoFeatureKey(f.properties ?? {});
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

  // 选中钉住标注（端口驱动，独立于 hover）：selected 显示；该键离开 selected 即收起
  const offPlaybackPin = opts.playback.subscribe((key, state) => {
    if (state === 'selected') {
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

  // —— click：演示通道（仅 Mock 端口可切态；真播放/白名单语义归 DR-M4 评审）——
  const onClick = (e: MapLayerMouseEvent): void => {
    const f = e.features?.[0];
    if (!f) return;
    const mock = opts.playback as Partial<MockPlaybackAdapter>;
    if (typeof mock.setState !== 'function') return; // Null 端口 = 无状态源，点击不产生播放语义
    const key = geoFeatureKey(f.properties ?? {});
    mock.setState(key, opts.playback.getPlayState(key) === 'selected' ? 'idle' : 'selected');
  };
  map.on('click', 'countries-layer', onClick);

  // —— 资源释放（岛屿重挂/卸载纪律：map.remove() + 全部退订 + 主题态还原）——
  return () => {
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
    map.remove();
    if (prevThemeAttr === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', prevThemeAttr);
  };
}
