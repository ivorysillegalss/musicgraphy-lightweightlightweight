/**
 * camera.ts —— 相机聚焦视图（DR-M4 · 设计参考 03 §2.2「相机层：flyTo/easeTo」同构）。
 *
 * Radiooooo 相机编排（§2.2 第 6 条）：focusByIso/focusByFeature → flyTo/panTo，带
 * padding 与自定义 easing 曲线。本项目等价物 = 纯函数三件（引擎无关、可单测）：
 * - easeInOutCubic：自定义缓动曲线（flyTo easing 选项注入）；
 * - focusZoomForSpan：bbox 跨度 → 目标 zoom（log2 启发式 + 夹取）；
 * - focusViewFromBbox：bbox → { center, zoom }（中心 = bbox 中心，与 labels.ts
 *   代表点同环同中心——点击聚焦落点与标注一致）。
 *
 * 红线：本文件禁止 import maplibre 或任何渲染库；相机状态（center/zoom）不入 URL
 * （过渡态不入链——DR-M4 红线边界，url-state.ts 只承载业务维度状态）。
 */

/** 聚焦动画时长（Radiooooo flyTo 观感量级；DOM 无关常量，测试断言在档）。 */
export const FOCUS_DURATION_MS = 1200;

/** 目标 zoom 夹取区间（大洲级 1.8 下限 / 国家级 5.2 上限；globe 初始 zoom 1.4 参照）。 */
export const FOCUS_ZOOM_RANGE = { min: 1.8, max: 5.2 } as const;

/**
 * 三次缓入缓出（自定义 easing；t∉[0,1] 先夹取）。
 * 性质（测试断言）：f(0)=0、f(0.5)=0.5、f(1)=1、[0,1] 单调、f(t)=f(1-t) 对称。
 */
export function easeInOutCubic(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * bbox 角跨度 → 目标 zoom（log2(360/span) − 0.8 修正，夹取 [1.8, 5.2]）。
 * span ≤ 0（退化 bbox）→ 上限（聚焦到最近）；单调递减于 span（跨度越大 zoom 越小）。
 */
export function focusZoomForSpan(spanDeg: number): number {
  if (!(spanDeg > 0) || !Number.isFinite(spanDeg)) return FOCUS_ZOOM_RANGE.max;
  const z = Math.log2(360 / spanDeg) - 0.8;
  return Math.min(Math.max(z, FOCUS_ZOOM_RANGE.min), FOCUS_ZOOM_RANGE.max);
}

/** 外包矩形（labels.ts featureBbox 产物；本文件不 import labels——类型自持保持引擎无关）。 */
export interface CameraBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface FocusView {
  /** maplibre LngLatLike 形状（[lng, lat]）——数据形状，非引擎类型。 */
  center: [number, number];
  zoom: number;
}

/** bbox → 聚焦视图（中心 = bbox 中心；zoom 取经/纬跨度较大者）。 */
export function focusViewFromBbox(bbox: CameraBbox): FocusView {
  const span = Math.max(bbox.maxLng - bbox.minLng, bbox.maxLat - bbox.minLat);
  return {
    center: [(bbox.minLng + bbox.maxLng) / 2, (bbox.minLat + bbox.maxLat) / 2],
    zoom: focusZoomForSpan(span)
  };
}
