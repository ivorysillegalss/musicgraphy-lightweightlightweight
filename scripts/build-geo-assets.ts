/**
 * DR-G1 · 国家边界 GeoJSON 资产生产（设计参考 03 §5.3 DR-G1 · §5.5 波次 1「数据与裁决并行」）。
 *
 * 数据源与许可：Natural Earth 110m admin-0 countries —— **公有领域（Public Domain）**
 * （naturalearthdata.com 官方条款：无版权、无使用限制）。本仓产物（public/geo/countries-110m.json）
 * 由本脚本生成，实测最终来源（2026-11-15，主源命中）：
 *   https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
 * 备用镜像（主源不可达时按序尝试）：jsdelivr gh 镜像同路径。全部不可达则报错退出，不落半成品。
 *
 * 归一规则：
 *  - properties 只保留 { iso_a2, iso_a3, name_en, name_zh }（NE 原属性 168 键 → 4 键）；
 *    name_en 取 NAME_EN（缺失退 NAME，再缺失为空串）；
 *  - NAME_ZH 缺失退化为空字符串（本批次实测 177/177 全覆盖，无缺失——如实披露，未见退化）；
 *  - ISO_A2 = '-99' 的条目照实保留原值（NE 已知怪癖，实测 5 条：Norway/France/N. Cyprus/
 *    Somaliland/Kosovo；DR-G2 白名单兜底不在本脚本范围）；
 *  - geometry 结构不变；坐标降密至 5 位小数（≈1.1m，远高于 110m 数据自身精度，显示无损；
 *    首尾闭合点同函数取整，环闭合性保持），处理前后体积在末尾如实披露。
 *
 * 输出：public/geo/countries-110m.json（紧凑 JSON 无缩进）。vite 默认 publicDir 会把
 * public/** 拷进 outDir dist/static/**——构建后 /static/geo/countries-110m.json 可达，
 * 满足乙-5 资产自托管零 CDN。末尾打印产物体积与要素数；脚本可重跑（幂等覆盖）。
 *
 * 用法：npx tsx scripts/build-geo-assets.ts（Node ≥26，零新增依赖：全局 fetch + node:fs）
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** NE 原始属性（168 键的超集形状，索引签名即可）。 */
interface NesProps {
  [key: string]: unknown;
}
interface NesGeometry {
  type: string;
  coordinates: unknown;
}
interface NesFeature {
  type: string;
  properties: NesProps | null;
  geometry: NesGeometry | null;
}
interface NesCollection {
  type: string;
  features: NesFeature[];
}

/** 归一后的要素属性（本仓地理资产唯一形状；下游 DR-G2/G3 消费）。 */
interface NormProps {
  iso_a2: string;
  iso_a3: string;
  name_en: string;
  name_zh: string;
}
interface NormFeature {
  type: 'Feature';
  properties: NormProps;
  geometry: NesGeometry;
}
interface NormCollection {
  type: 'FeatureCollection';
  features: NormFeature[];
}

/** 数据源候选（按序尝试，第一个成功者胜出；两者同为 nvkelso/natural-earth-vector 的同一文件）。 */
const SOURCES = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson'
] as const;

/** 输出落点（repo 内 public/geo/；不进 src，由 vite publicDir 拷贝分发）。 */
const OUT = resolve(import.meta.dirname, '../public/geo/countries-110m.json');

/** 坐标降密：经纬度保留 5 位小数（110m 精度之上无损）。 */
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;

/** 递归取整坐标树：叶子（数字数组）= Position，只取整前二维（经纬度），更高维原样。 */
function roundCoords(node: unknown): unknown {
  if (!Array.isArray(node)) return node;
  if (typeof node[0] === 'number') {
    return (node as number[]).map((v, i) => (i < 2 ? round5(v) : v));
  }
  return node.map(roundCoords);
}

async function fetchSource(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: { 'user-agent': 'musicgraphy-build/DR-G1 (Natural Earth asset production)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---- 1. 下载（候选源按序兜底）----
let rawText: string | null = null;
let usedSource = '';
for (const url of SOURCES) {
  try {
    rawText = await fetchSource(url);
    usedSource = url;
    break;
  } catch (err) {
    console.warn(`[geo] 源不可达：${url} → ${err instanceof Error ? err.message : String(err)}`);
  }
}
if (rawText === null) throw new Error('[geo] 全部数据源不可达——不落半成品，请检查网络后重跑。');
const rawBytes = Buffer.byteLength(rawText);

// ---- 2. 解析与结构校验 ----
const nes = JSON.parse(rawText) as NesCollection;
if (nes.type !== 'FeatureCollection' || !Array.isArray(nes.features)) {
  throw new Error('[geo] 下载件不是 FeatureCollection——源结构变化，请人工核对数据源。');
}

// ---- 3. 属性归一（168 键 → 4 键；坐标先保精度，体积披露后再降密）----
const features: NormFeature[] = [];
let zhHit = 0;
let isoA2Dash99 = 0;
let nullGeometry = 0;
for (const f of nes.features) {
  const p: NesProps = f.properties ?? {};
  const nameZh = typeof p['NAME_ZH'] === 'string' ? p['NAME_ZH'] : '';
  if (nameZh !== '') zhHit += 1;
  if (p['ISO_A2'] === '-99') isoA2Dash99 += 1;
  const nameEn =
    typeof p['NAME_EN'] === 'string'
      ? p['NAME_EN']
      : typeof p['NAME'] === 'string'
        ? p['NAME']
        : '';
  if (f.geometry === null) {
    nullGeometry += 1; // 110m 实测应为 0；防御计数，末尾披露
    continue;
  }
  features.push({
    type: 'Feature',
    properties: {
      iso_a2: typeof p['ISO_A2'] === 'string' ? p['ISO_A2'] : '',
      iso_a3: typeof p['ISO_A3'] === 'string' ? p['ISO_A3'] : '',
      name_en: nameEn,
      name_zh: nameZh
    },
    geometry: f.geometry
  });
}
const prunedJson = JSON.stringify({ type: 'FeatureCollection', features } satisfies NormCollection);
const prunedBytes = Buffer.byteLength(prunedJson);

// ---- 4. 坐标降密（5 位小数）+ 落盘（紧凑 JSON）----
for (const f of features) {
  f.geometry = { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) };
}
const json = JSON.stringify({ type: 'FeatureCollection', features } satisfies NormCollection);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json, 'utf8');
const outBytes = statSync(OUT).size;

// ---- 5. 产物报告 ----
console.log(`[geo] 最终来源：${usedSource}（Natural Earth · Public Domain）`);
console.log(
  `[geo] 要素数：${features.length}（原始 ${nes.features.length}，null geometry 跳过 ${nullGeometry}）`
);
console.log(
  `[geo] 体积：原始下载 ${rawBytes} B → 属性归一 ${prunedBytes} B → 坐标降密 5 位小数 ${outBytes} B（落盘 ${OUT}）`
);
console.log(
  `[geo] name_zh 覆盖：${zhHit}/${features.length}；ISO_A2='-99' 照实保留条目：${isoA2Dash99}`
);
