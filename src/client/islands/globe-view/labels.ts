/**
 * labels.ts —— 国家面标注点生成（DR-M3 · 纯函数）。
 *
 * 标注渲染决策（已裁决，代码注释披露）：**不使用 maplibre symbol 层**——symbol 文本需要
 * glyphs PBF 字体源，自托管成本与乙-5 红线冲突面大（评审案 5db47b4 §5 第 7 条二选一，
 * 取方案②）；改用 **DOM 标注**：hover/选中时在对应位置挂 maplibre `Marker`（DOM 元素，
 * 样式走 app.css globe 追加段），与 Radiooooo 的地图 DOM 标注（设计参考 03 §2.2）同款
 * 思路。本文件因此只产出「点位 + 国名」纯数据，零渲染依赖。
 * （DR-I1 红线审计注：本目录全部源码禁外部服务字面量，豁免清单为空——注释措辞已随之收敛。）
 *
 * 红线：本文件禁止 import maplibre 或任何渲染库（标注点 = 纯数据，可单测断言）。
 */

/** GeoJSON 最小结构面（只取本模块需要的形状；不引 geojson 类型包——零依赖纪律）。 */
export interface GeoGeometryLike {
  type: string;
  coordinates: unknown;
}

export interface GeoFeatureLike {
  id?: string | number;
  properties?: Record<string, unknown> | null;
  geometry: GeoGeometryLike | null;
}

export interface GeoFeatureCollectionLike {
  type: string;
  features: GeoFeatureLike[];
}

/** 标注点（iso = 地图要素标识键，与 maplibre-adapter 的 featureId 语义一致）。 */
export interface LabelPoint {
  iso: string;
  nameZh: string;
  nameEn: string;
  lng: number;
  lat: number;
}

/** ISO 槽位有效性：NE 110m 用 '-99'（及负值族）标记无 ISO 的要素——视为无效。 */
function validIso(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null;
  if (/^-\d+$/.test(v)) return null;
  return v;
}

/**
 * 地图要素标识键（adapter 定义 featureId 语义的权威实现，播放态/标注共用）：
 * 优先 iso_a2，退化 iso_a3，再退化 `name:${name_en}`（NE 110m France/Norway 等
 * ISO 槽位为 -99 的要素走 name 兜底；D4 白名单接入时以本函数同源口径匹配）。
 */
export function geoFeatureKey(props: Partial<Record<string, unknown>> | null | undefined): string {
  const p = props ?? {};
  const isoA2 = validIso(p['iso_a2']);
  if (isoA2 !== null) return isoA2;
  const isoA3 = validIso(p['iso_a3']);
  if (isoA3 !== null) return isoA3;
  const nameEn = typeof p['name_en'] === 'string' ? p['name_en'] : '';
  return `name:${nameEn}`;
}

type Ring = number[][];

/** 外环鞋带面积（绝对值；仅用于 MultiPolygon 代表多边形挑选）。 */
function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    sum += (a[0] ?? 0) * (b[1] ?? 0) - (b[0] ?? 0) * (a[1] ?? 0);
  }
  return Math.abs(sum / 2);
}

/** 外环外包矩形质心（§派工口径：外包矩形质心——确定性高、可单测；代表多边形 = 面积最大者）。 */
function ringBboxCenter(ring: Ring): { lng: number; lat: number } | null {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const pos of ring) {
    if (!Array.isArray(pos) || typeof pos[0] !== 'number' || typeof pos[1] !== 'number') continue;
    if (pos[0] < minLng) minLng = pos[0];
    if (pos[0] > maxLng) maxLng = pos[0];
    if (pos[1] < minLat) minLat = pos[1];
    if (pos[1] > maxLat) maxLat = pos[1];
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 };
}

/** 代表多边形外环：Polygon 取外环；MultiPolygon 取面积最大的外环。 */
function largestOuterRing(geometry: GeoGeometryLike | null): Ring | null {
  if (geometry === null) return null;
  const coords: unknown = geometry.coordinates;
  if (geometry.type === 'Polygon' && Array.isArray(coords) && Array.isArray(coords[0])) {
    return coords[0] as Ring;
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(coords)) {
    let best: Ring | null = null;
    let bestArea = -1;
    for (const poly of coords as unknown[]) {
      const outer = Array.isArray(poly) && Array.isArray(poly[0]) ? (poly[0] as Ring) : null;
      if (outer === null) continue;
      const area = ringArea(outer);
      if (area > bestArea) {
        bestArea = area;
        best = outer;
      }
    }
    return best;
  }
  return null;
}

/** 单要素代表点（外包矩形质心；几何无效返回 null）。 */
export function featureLabelPoint(geometry: GeoGeometryLike | null): { lng: number; lat: number } | null {
  return ringBboxCenter(largestOuterRing(geometry) ?? []);
}

/** 外包矩形（相机聚焦用；DR-M4 camera.ts focusViewFromBbox 的输入形状）。 */
export interface GeoBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/**
 * 单要素外包矩形：取**代表多边形（最大外环）**的 bbox——与代表点同环，
 * 聚焦中心恒等于标注点位（点击聚焦不跳位）；无有效坐标返回 null。
 */
export function featureBbox(geometry: GeoGeometryLike | null): GeoBbox | null {
  const ring = largestOuterRing(geometry);
  if (ring === null) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const pos of ring) {
    if (!Array.isArray(pos) || typeof pos[0] !== 'number' || typeof pos[1] !== 'number') continue;
    if (pos[0] < minLng) minLng = pos[0];
    if (pos[0] > maxLng) maxLng = pos[0];
    if (pos[1] < minLat) minLat = pos[1];
    if (pos[1] > maxLat) maxLat = pos[1];
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return { minLng, minLat, maxLng, maxLat };
}

/** 坐标降密至 5 位小数（与 DR-G1 资产精度纪律一致）。 */
function round5(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}

/**
 * 由 FeatureCollection 生成标注点：每要素一个代表点，容差去重
 * （默认 0.05° ≈ 5km——吸收同一位置重复代表点，不吞并相邻小国）。
 * 输出顺序 = 输入要素顺序（去重只丢弃后续同格点，保持确定性）。
 */
export function buildLabels(fc: GeoFeatureCollectionLike, toleranceDeg = 0.05): LabelPoint[] {
  if (toleranceDeg <= 0) throw new Error('[globe-view] 去重容差必须为正数。');
  const seen = new Set<string>();
  const out: LabelPoint[] = [];
  for (const f of fc.features) {
    const point = featureLabelPoint(f.geometry);
    if (point === null) continue;
    const cell = `${Math.round(point.lng / toleranceDeg)}:${Math.round(point.lat / toleranceDeg)}`;
    if (seen.has(cell)) continue;
    seen.add(cell);
    const props = f.properties ?? {};
    const nameEn = typeof props['name_en'] === 'string' ? props['name_en'] : '';
    const nameZh = typeof props['name_zh'] === 'string' ? props['name_zh'] : '';
    out.push({ iso: geoFeatureKey(props), nameZh, nameEn, lng: round5(point.lng), lat: round5(point.lat) });
  }
  return out;
}
