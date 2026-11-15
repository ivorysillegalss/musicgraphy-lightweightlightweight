// globe-view DR-M2/M3 单测（派工 D3 · 2026-11-15）：
// - buildMapStyle 两主题结构断言（version 8 / sources.countries 自托管 URL / 无 glyphs / 零外部 URL / 层序 / token 注入读色）；
// - buildFillPaint 五态表达式断言（null 白名单 = 全可用无 empty 分支；给定名单 = in 表达式 + empty 透明度在档）；
// - labels 标注点断言（外包矩形质心 / MultiPolygon 最大代表多边形 / 容差去重 / -99 要素 name 兜底键 / 全量资产冒烟）。
// 纯数据断言零 DOM 零渲染引擎（maplibre-gl 仅 type import，运行时零加载——契约红线）。
// 测试桩色值 = tokens.css 既有变量值的镜像（模拟 getComputedStyle 注入面；非新色值发明）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { buildFillPaint, FIVE_STATE_OPACITY } from '../src/client/islands/globe-view/five-state';
import { buildLabels, geoFeatureKey, type GeoFeatureCollectionLike } from '../src/client/islands/globe-view/labels';
import { buildMapStyle, GEO_ASSET_URL, GLOBE_THEME_IDS } from '../src/client/islands/globe-view/maplibre-style';

// token 查表桩（键 = app.css globe token 桥段变量名；值 = tokens.css 既有值镜像）
const LIGHT_TOKENS: Record<string, string> = {
  '--globe-ocean': '#FFFBEB', // var(--color-background) = cream
  '--globe-land': '#E9E2D2', // var(--color-border)
  '--globe-boundary': '#78716C', // var(--color-secondary) = stone-500
  '--globe-accent': '#D97706' // var(--color-accent) = amber-600
};
const DARK_TOKENS: Record<string, string> = {
  '--globe-ocean': '#1C1917', // var(--stone-900)
  '--globe-land': '#292524', // var(--stone-800)
  '--globe-boundary': '#57534E', // var(--stone-600)
  '--globe-accent': '#D97706' // var(--amber-600)
};

const stubReader =
  (table: Record<string, string>) =>
  (varName: string): string => {
    const v = table[varName];
    if (v === undefined) throw new Error(`[stub] 未登记的 token：${varName}`);
    return v;
  };

const FIVE_TOKENS = { accent: '#D97706', base: '#E9E2D2' };

describe('buildMapStyle（DR-M2 · StylePort maplibre 真实现：自托管样式注册表）', () => {
  test('light 主题：version 8 / sources.countries 自托管 GeoJSON URL / generateId / globe 投影 / 层序', () => {
    const style = buildMapStyle('light', stubReader(LIGHT_TOKENS));
    assert.equal(style.version, 8);
    assert.equal(style.name, 'musicgraphy-globe-light');
    assert.equal(style.projection?.type, 'globe');
    const src = style.sources['countries'];
    assert.ok(src, 'countries source 缺失');
    assert.equal(src.type, 'geojson');
    assert.equal((src as { data?: string }).data, GEO_ASSET_URL);
    assert.equal(GEO_ASSET_URL, '/static/geo/countries-110m.json'); // 同源相对路径（乙-5 零外部请求）
    assert.equal((src as { generateId?: boolean }).generateId, true);
    assert.deepEqual(
      style.layers.map((l) => l.id),
      ['background', 'countries-layer', 'country-boundaries']
    );
  });

  test('无 glyphs 无 sprite（DOM 标注方案规避 PBF 字体源）；全文档零外部 URL', () => {
    for (const id of GLOBE_THEME_IDS) {
      const style = buildMapStyle(id, stubReader(id === 'dark' ? DARK_TOKENS : LIGHT_TOKENS));
      assert.ok(!('glyphs' in style), `${id} 主题不得携带 glyphs 字段`);
      assert.ok(!('sprite' in style), `${id} 主题不得携带 sprite 字段`);
      const json = JSON.stringify(style);
      assert.ok(!json.includes('http://') && !json.includes('https://'), `${id} 主题样式含外部 URL——乙-5 红线`);
    }
  });

  test('颜色 = 注入 token 值（light/dark 两套计算样式桩各自生效；禁止 TS 硬编码）', () => {
    const light = buildMapStyle('light', stubReader(LIGHT_TOKENS));
    const dark = buildMapStyle('dark', stubReader(DARK_TOKENS));
    const paintOf = (s: typeof light, layerId: string): Record<string, unknown> => {
      const layer = s.layers.find((l) => l.id === layerId) as { paint: Record<string, unknown> };
      return layer.paint;
    };
    assert.equal(paintOf(light, 'background')['background-color'], LIGHT_TOKENS['--globe-ocean']);
    assert.equal(paintOf(dark, 'background')['background-color'], DARK_TOKENS['--globe-ocean']);
    assert.equal(paintOf(light, 'country-boundaries')['line-color'], LIGHT_TOKENS['--globe-boundary']);
    assert.equal(paintOf(dark, 'country-boundaries')['line-color'], DARK_TOKENS['--globe-boundary']);
    // 五态强调色 = accent token（light/dark 共用琥珀 accent 桩值，来源 --globe-accent）
    const fillColor = paintOf(light, 'countries-layer')['fill-color'] as unknown[];
    assert.ok(fillColor.includes(LIGHT_TOKENS['--globe-accent']));
  });

  test('未知主题 id 抛错（与 registry-theme 校验同语义）；无 DOM 且未注入读取器时指路 CssVarReader', () => {
    assert.throws(() => buildMapStyle('vintage', stubReader(LIGHT_TOKENS)), /未知主题 id/);
    assert.throws(() => buildMapStyle('light'), /CssVarReader/); // node:test 环境 typeof document === 'undefined'
  });
});

describe('buildFillPaint（DR-M3 · 五态染色表达式，纯数据可断言）', () => {
  test('null 白名单 = 全部可用：fill-color 五态 case 强调色 = accent；opacity 无 empty 分支', () => {
    const paint = buildFillPaint(null, FIVE_TOKENS);
    assert.deepEqual(paint['fill-color'], [
      'case',
      ['boolean', ['feature-state', 'playing'], false], '#D97706',
      ['boolean', ['feature-state', 'selected'], false], '#D97706',
      ['boolean', ['feature-state', 'hover'], false], '#D97706',
      '#E9E2D2'
    ]);
    const json = JSON.stringify(paint['fill-opacity']);
    assert.ok(!json.includes('"in"') && !json.includes('"match"'), 'null 白名单不得出现名单匹配分支');
    assert.ok(!json.includes('empty'));
    assert.equal(paint['fill-opacity'].length, 8); // case + 3×(bool, v) + 基态 = 8
    assert.deepEqual(paint['fill-opacity'][1], ['boolean', ['feature-state', 'playing'], false]);
    assert.equal(paint['fill-opacity'][2], FIVE_STATE_OPACITY.playing);
    assert.equal(paint['fill-opacity'][4], FIVE_STATE_OPACITY.selected);
    assert.equal(paint['fill-opacity'][6], FIVE_STATE_OPACITY.hover);
    assert.equal(paint['fill-opacity'][7], FIVE_STATE_OPACITY.base); // 基态弱填充收尾
  });

  test('给定名单：iso_a2/iso_a3 双 in 匹配 + empty 态表达式存在（名单内基态 / 名单外近隐身）', () => {
    const paint = buildFillPaint(['FRA', 'CN'], FIVE_TOKENS);
    const opacity = paint['fill-opacity'] as unknown[];
    assert.equal(opacity.length, 10); // case + 3×(bool, v) + (any, v) + empty = 10
    assert.equal(opacity[8], FIVE_STATE_OPACITY.base); // 名单内基态
    assert.equal(opacity[9], FIVE_STATE_OPACITY.empty); // empty 近隐身收尾
    const json = JSON.stringify(opacity);
    assert.equal((json.match(/"in"/g) ?? []).length, 2, 'iso_a2 与 iso_a3 各一条 in 匹配');
    assert.ok(json.includes('"literal"') && json.includes('"FRA"') && json.includes('"CN"'));
    // fill-color 与 null 名单版完全一致（白名单只影响 opacity 语义，色面恒定）
    const nullPaint = buildFillPaint(null, FIVE_TOKENS);
    assert.deepEqual(paint['fill-color'], nullPaint['fill-color']);
  });

  test('token 缺失抛错（禁硬编码兜底色，fail loud）', () => {
    assert.throws(() => buildFillPaint(null, { accent: '', base: '#E9E2D2' }), /accent/);
    assert.throws(() => buildFillPaint(null, { accent: '#D97706', base: undefined as unknown as string }), /base/);
  });
});

describe('labels（DR-M3 · 标注点：质心 / 代表多边形 / 容差去重 / -99 兜底键）', () => {
  const square = (x0: number, y0: number, x1: number, y1: number): number[][][] => [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0]
    ]
  ];

  test('geoFeatureKey：iso_a2 优先 → iso_a3 兜底 → name 兜底（NE -99 槽位）', () => {
    assert.equal(geoFeatureKey({ iso_a2: 'CN', iso_a3: 'CHN', name_en: 'China' }), 'CN');
    assert.equal(geoFeatureKey({ iso_a2: '-99', iso_a3: 'NOR', name_en: 'Norway' }), 'NOR');
    assert.equal(geoFeatureKey({ iso_a2: '-99', iso_a3: '-99', name_en: 'France' }), 'name:France');
    assert.equal(geoFeatureKey(null), 'name:');
    assert.equal(geoFeatureKey({ iso_a2: 123, iso_a3: 456 }), 'name:'); // 非 string 槽位 → 兜底
  });

  test('手工 FeatureCollection：外包矩形质心 + MultiPolygon 取最大代表多边形 + 同格去重 + -99 要素键', () => {
    const fc: GeoFeatureCollectionLike = {
      type: 'FeatureCollection',
      features: [
        { properties: { iso_a2: 'AA', name_en: 'Aaa', name_zh: '甲国' }, geometry: { type: 'Polygon', coordinates: square(0, 0, 10, 10) } },
        // 与 AA 同 bbox 中心（容差 0.05° 同格）→ 去重丢弃
        { properties: { iso_a2: 'CC', name_en: 'Ccc', name_zh: '丙国' }, geometry: { type: 'Polygon', coordinates: square(2.5, 2.5, 7.5, 7.5) } },
        // MultiPolygon：小块 (0..1) vs 大块 (20..30) → 代表点取大块中心 (25, 25)
        // （MultiPolygon 坐标 = [polygon, polygon]，polygon = [ring]，square() 已返回 polygon）
        {
          properties: { iso_a2: '-99', iso_a3: 'BBB', name_en: 'Bbb', name_zh: '乙国' },
          geometry: { type: 'MultiPolygon', coordinates: [square(0, 0, 1, 1), square(20, 20, 30, 30)] }
        },
        { properties: { geometry: null }, geometry: null } // 无几何要素跳过（不产生标注）
      ]
    };
    const labels = buildLabels(fc);
    assert.equal(labels.length, 2);
    assert.deepEqual(labels[0], { iso: 'AA', nameZh: '甲国', nameEn: 'Aaa', lng: 5, lat: 5 });
    assert.deepEqual(labels[1], { iso: 'BBB', nameZh: '乙国', nameEn: 'Bbb', lng: 25, lat: 25 });
  });

  test('全量资产冒烟（public/geo/countries-110m.json）：≥170 标注 / 坐标域合法 / France 走 name 兜底键 / name_zh 全覆盖', () => {
    const raw = JSON.parse(
      readFileSync(fileURLToPath(new URL('../public/geo/countries-110m.json', import.meta.url)), 'utf8')
    ) as GeoFeatureCollectionLike;
    const labels = buildLabels(raw);
    console.log(`[globe-style] 全量资产标注点 = ${labels.length}/${raw.features.length}`);
    assert.ok(labels.length >= 170, `标注点 ${labels.length} 过少——质心/去重逻辑异常`);
    for (const lp of labels) {
      assert.ok(Math.abs(lp.lng) <= 180 && Math.abs(lp.lat) <= 90, `坐标越界：${lp.iso} (${lp.lng}, ${lp.lat})`);
      assert.ok(lp.nameEn !== '', `${lp.iso} name_en 为空`);
      assert.ok(lp.nameZh !== '', `${lp.iso} name_zh 为空`);
    }
    const france = labels.find((l) => l.nameEn === 'France');
    assert.ok(france, 'France 标注缺失');
    assert.equal(france.iso, 'name:France');
    // 容差去重有效性：全量 177 要素去重后至多丢 7 个（5km 格碰撞——110m 尺度下应为 0–2）
    assert.ok(raw.features.length - labels.length <= 7, `去重丢点 ${raw.features.length - labels.length} 过多`);
  });
});
