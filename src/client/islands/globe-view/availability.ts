/**
 * availability.ts —— 可用性白名单加载（DR-M4 · G2 静态替身通道）。
 *
 * ★★ G2 真 API 替换点（派工钦定标注）：`fetchAvailability` 是未来接
 * `/api/v1/geo/availability` 的**唯一改动位置**——把 mock JSON 换成真 API 的
 * envelope 响应（`{ data: { available: [...] } }`）只改本函数体，宿主层与渲染层
 * （globe-view.ts / maplibre-adapter.ts）零改动（DR-M0 端口纪律在可用性维度的延伸）。
 *
 * 资产 = `public/geo/availability.mock.json`（与 countries-110m.json 同路径规则：
 * 随 vite publicDir 进 dist/static/geo/，同源相对路径 fetch——乙-5 零外部请求）。
 *
 * 失败语义 = 返回 null（fail-open）：白名单缺失时宿主层按「全部可用」降级，
 * 与 D3 白名单未接时的全可用基线一致（地图永不因白名单不可得而不可用）。
 *
 * 红线：本文件禁止 import maplibre 或任何渲染库（纯 fetch + 校验，可注入 fetchFn 单测）。
 */

/** Mock 白名单资产同源相对路径（'/static/geo/' 直服规则见 src/server/app.ts）。 */
export const AVAILABILITY_MOCK_URL = '/static/geo/availability.mock.json';

/** Mock 资产最小结构面（comment 字段 = 资产自述，运行时不消费）。 */
interface AvailabilityAsset {
  comment?: string;
  available?: unknown;
}

/**
 * 拉取可用国家键白名单（键 = geoFeatureKey 同源口径：iso_a2 / iso_a3 / 'name:' 前缀）。
 * @param fetchFn 注入缝（单测传桩，不触网）；缺省 = 全局 fetch
 * @returns 键数组（可为空数组 = API 权威回答「当前无可用国家」）；加载失败/形状
 *          不符 = null（fail-open，见文件头）
 */
export async function fetchAvailability(fetchFn: typeof fetch = fetch): Promise<string[] | null> {
  try {
    const res = await fetchFn(AVAILABILITY_MOCK_URL);
    if (!res.ok) return null;
    const body = (await res.json()) as AvailabilityAsset;
    if (!Array.isArray(body.available)) return null;
    return body.available.filter((c): c is string => typeof c === 'string' && c.trim() !== '');
  } catch {
    return null;
  }
}
