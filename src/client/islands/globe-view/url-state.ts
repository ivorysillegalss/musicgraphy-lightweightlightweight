/**
 * url-state.ts —— globe-view URL 即状态（DR-M4 · 乙-1/DD3）纯函数模块。
 *
 * 业务维度状态 = 国家选中态（country）+ 主题态（theme）：
 *   /atlas?country=FR&theme=dark
 * - country 值 = 白名单匹配键（geoFeatureKey 同源口径）：iso_a2 优先 → iso_a3 →
 *   `'name:' + name_en`（NE 110m France/Norway 等五要素 ISO 槽位为 -99 的兜底，
 *   裁决与实现见 five-state.ts / maplibre-adapter.ts 注释）。URL 经 URLSearchParams
 *   编码（name:France → name%3AFrance），round-trip 无损。
 * - 相机状态（zoom/center/rotation）不入 URL（过渡态不入链——DR-M4 红线边界，
 *   设计参考 03 §5.3 DR-M4「DD3 冲突面」条款）。
 * - 校验容错：非法/陈旧参数 = 丢弃该参数返回 null（分享链接不阻塞页面，不抛错）。
 *
 * history 语义（裁决，提交说明披露）：**国家选中切换 = pushState**（后退可回上一
 * 国家/清除——对齐 filter-cabin chips 点击的 DD3 push 语义）；**主题切换 = replaceState**
 * （外观态轻动作，不污染历史）；两条规则由宿主层 globe-view.ts 落实（本模块只管
 * 序列化，不触 history API——可单测）。
 *
 * 红线：本文件禁止 import maplibre 或任何渲染库（theme 校验经 maplibre-style 的
 * GLOBE_THEME_IDS 常量——其 maplibre-gl import 是纯 type，运行时零加载）。
 */
import { GLOBE_THEME_IDS } from './maplibre-style';

export interface GlobeUrlState {
  /** 国家选中态（白名单匹配键；null = 无选中）。 */
  country: string | null;
  /** 主题态（GLOBE_THEME_IDS 内的 id；null = 未指定，回落 SSR 壳默认）。 */
  theme: string | null;
}

/** ISO 形态国家码（2–3 位字母，大小写归一为大写）；name 兜底形态 = 'name:' 前缀保持原样。 */
function parseCountry(raw: string | null): string | null {
  if (raw === null) return null;
  const v = raw.trim();
  if (v === '') return null;
  if (/^[a-zA-Z]{2,3}$/.test(v)) return v.toUpperCase();
  if (v.startsWith('name:') && v.length > 'name:'.length) return v;
  return null;
}

/** 主题 id 必须在注册表内（与 buildMapStyle/RegistryStyleAdapter 校验同集）。 */
function parseTheme(raw: string | null): string | null {
  if (raw === null) return null;
  const v = raw.trim();
  return (GLOBE_THEME_IDS as readonly string[]).includes(v) ? v : null;
}

/**
 * 解析 location.search（带或不带 '?' 前缀均可）→ URL 状态；未知参数忽略，
 * 非法参数丢弃（对应槽位为 null）。
 */
export function parseGlobeQuery(search: string): GlobeUrlState {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  return {
    country: parseCountry(params.get('country')),
    theme: parseTheme(params.get('theme'))
  };
}

/** 序列化为 query string（country 在前 theme 在后；空态 = ''）。 */
export function serializeGlobeQuery(state: GlobeUrlState): string {
  const params = new URLSearchParams();
  if (state.country !== null) params.set('country', state.country);
  if (state.theme !== null) params.set('theme', state.theme);
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}

/** 派生：替换国家选中态（null = 清除）。 */
export function withCountry(state: GlobeUrlState, country: string | null): GlobeUrlState {
  return { country, theme: state.theme };
}

/** 派生：替换主题态（null = 清除）。 */
export function withTheme(state: GlobeUrlState, theme: string | null): GlobeUrlState {
  return { country: state.country, theme };
}
