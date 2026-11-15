/**
 * maplibre-style.ts —— 底图样式注册表（DR-M2 · StylePort 的 maplibre 真实现 · buildMapStyle 纯函数）。
 *
 * style 全自托管（乙-5 资产零 CDN）：
 * - version 8；sources.countries = { type:'geojson', data: 自托管 GeoJSON 资产 URL, generateId: true }；
 * - layers = background（海洋底色）+ countries-layer（fill 五态染色，five-state.ts）
 *   + country-boundaries（line 国界钢墨线）；
 * - **无 glyphs 字段**（标注走 DOM Marker，决策注释见 labels.ts——symbol 层需要 glyphs
 *   PBF 字体源，与自托管红线冲突面大）；无 sprite；**全文档零外部 URL**（单测断言）。
 * - globe 投影经 style 内嵌 `projection: { type: 'globe' }`（v5+ style spec 正式字段；
 *   Map 构造器 v6 无 projection 选项——GlobeControl 等价启用路径，随 style 走，
 *   setStyle diff 换主题时投影自然保持）。
 *
 * 颜色纪律（MASTER token 单一事实源）：本文件**禁止硬编码任何色值**——全部经 readVar
 * 从 CSS 自定义属性运行时读取。缺省读取器 = getComputedStyle(document.documentElement)
 * （app.css globe token 桥段的作用域 = html[data-theme]，主题态由适配器同步到
 * documentElement）；单测/无 DOM 环境注入 CssVarReader 桩（派工口径「测试时可注入桩」）。
 * 主题 id 只有两个合法值（light/dark，与 registry-theme.ts DEFAULT_THEMES 同集），未知抛错。
 */
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import { buildFillPaint, type DataExpression } from './five-state';

/** GeoJSON 资产同源相对路径（DR-G1 产物，随 vite publicDir 进 dist/static/geo/；乙-5 零外部请求）。 */
export const GEO_ASSET_URL = '/static/geo/countries-110m.json';

/** 合法主题集（与 registry-theme.ts DEFAULT_THEMES 的 id 同集；数组顺序 = 注册表默认序）。 */
export const GLOBE_THEME_IDS = ['light', 'dark'] as const;
export type GlobeThemeId = (typeof GLOBE_THEME_IDS)[number];

/**
 * CSS 自定义属性读取器（token 解析缝）：注入式设计——
 * - 缺省（DOM 可用前提）：getComputedStyle(document.documentElement)；
 * - 测试：注入桩（Record 查表），不触 DOM。
 */
export type CssVarReader = (varName: string) => string;

function defaultCssVarReader(): CssVarReader {
  if (typeof document === 'undefined') {
    throw new Error('[globe-view] buildMapStyle 需要 DOM（getComputedStyle）或注入 CssVarReader（单测传桩）。');
  }
  return (varName) => getComputedStyle(document.documentElement).getPropertyValue(varName);
}

function readToken(read: CssVarReader, varName: string): string {
  const v = read(varName).trim();
  if (v === '') {
    throw new Error(`[globe-view] token ${varName} 解析为空——app.css globe token 桥段缺失？（禁硬编码兜底色，fail loud）`);
  }
  return v;
}

/** 地图 paint 所需的 token 全集（键 = app.css globe token 桥段的变量名）。 */
export interface GlobeStyleTokens {
  '--globe-ocean': string;
  '--globe-land': string;
  '--globe-boundary': string;
  '--globe-accent': string;
}

function readGlobeTokens(read: CssVarReader): GlobeStyleTokens {
  return {
    '--globe-ocean': readToken(read, '--globe-ocean'),
    '--globe-land': readToken(read, '--globe-land'),
    '--globe-boundary': readToken(read, '--globe-boundary'),
    '--globe-accent': readToken(read, '--globe-accent')
  };
}

/** DataExpression → maplibre 表达式（边界 cast：five-state 保纯数据可断言，maplibre 运行时校验合法性）。 */
const asExpression = (e: DataExpression): ExpressionSpecification => e as unknown as ExpressionSpecification;

/**
 * buildMapStyle：主题 id → 自托管 StyleSpecification（纯函数；读色经注入的 CssVarReader）。
 * @param themeId 'light' | 'dark'（未知 id 抛错，与注册表校验同语义）
 * @param readVar 可选 token 读取器（缺省 = documentElement 计算样式；无 DOM 环境必须注入）
 * @param availableIsoCodes 可用性白名单（D4 · geoFeatureKey 同源键：iso_a2 / iso_a3 /
 *        'name:' 前缀 name_en——'-99' 兜底裁决见 five-state.ts）；null = 全部可用
 *        （无 empty 分支）。适配器在白名单异步就绪后以 setStyle diff 重建 paint。
 */
export function buildMapStyle(
  themeId: string,
  readVar?: CssVarReader,
  availableIsoCodes: string[] | null = null
): StyleSpecification {
  if (!(GLOBE_THEME_IDS as readonly string[]).includes(themeId)) {
    throw new Error(`[globe-view] 未知主题 id「${themeId}」——注册表内无此主题。`);
  }
  const read = readVar ?? defaultCssVarReader();
  const t = readGlobeTokens(read);
  const fillPaint = buildFillPaint(availableIsoCodes, { accent: t['--globe-accent'], base: t['--globe-land'] });
  return {
    version: 8,
    name: `musicgraphy-globe-${themeId}`,
    projection: { type: 'globe' },
    sources: {
      countries: {
        type: 'geojson',
        data: GEO_ASSET_URL,
        // 要素无稳定 ISO（110m 五要素 '-99'）：generateId 按要素序自动赋 id，
        // 适配器经 querySourceFeatures 以属性反查 id（不预测 id 值本身）。
        generateId: true
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': t['--globe-ocean'] } },
      {
        id: 'countries-layer',
        type: 'fill',
        source: 'countries',
        paint: {
          'fill-color': asExpression(fillPaint['fill-color']),
          'fill-opacity': asExpression(fillPaint['fill-opacity'])
        }
      },
      {
        id: 'country-boundaries',
        type: 'line',
        source: 'countries',
        paint: { 'line-color': t['--globe-boundary'], 'line-width': 0.7, 'line-opacity': 0.55 }
      }
    ]
  };
}
