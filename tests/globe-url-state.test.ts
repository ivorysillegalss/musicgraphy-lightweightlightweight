// globe-view D4 纯函数单测（派工 D4 · DR-M4 相机编排与 URL 即状态的可测核心）：
// - url-state：parse/serialize/round-trip/非法参数容错/派生 helper（乙-1 URL 即状态；
//   history 语义 = 国家切换 pushState / 主题切换 replaceState，裁决在宿主层 globe-view.ts，
//   本模块只管序列化不触 history API）；
// - camera：easeInOutCubic 性质 / focusZoomForSpan 单调与夹取 / focusViewFromBbox（相机态
//   不入 URL 的过渡态纯函数）；
// - labels.featureBbox：代表环 bbox（与标注点同环——聚焦中心恒等于标注点位）。
// 纯数据断言零 DOM 零渲染引擎（maplibre-gl 仅 type import 链，运行时零加载——契约红线）。
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { easeInOutCubic, focusViewFromBbox, focusZoomForSpan, FOCUS_ZOOM_RANGE } from '../src/client/islands/globe-view/camera';
import { featureBbox } from '../src/client/islands/globe-view/labels';
import { parseGlobeQuery, serializeGlobeQuery, withCountry, withTheme, type GlobeUrlState } from '../src/client/islands/globe-view/url-state';

describe('url-state（DR-M4 · URL 即状态纯函数）', () => {
  test('parse：?country=FR&theme=dark 全量解析；带/不带 ? 前缀均可；空串 = 双 null', () => {
    assert.deepEqual(parseGlobeQuery('?country=FR&theme=dark'), { country: 'FR', theme: 'dark' });
    assert.deepEqual(parseGlobeQuery('country=JP'), { country: 'JP', theme: null });
    assert.deepEqual(parseGlobeQuery(''), { country: null, theme: null });
    assert.deepEqual(parseGlobeQuery('?'), { country: null, theme: null });
  });

  test('parse 容错：ISO 形态大写归一；name: 形态原样保留（URLSearchParams 已解码）', () => {
    assert.equal(parseGlobeQuery('?country=fr')?.country, 'FR');
    assert.equal(parseGlobeQuery('?country=deu')?.country, 'DEU'); // 2–3 位字母均收（iso_a2/iso_a3 两档）
    assert.equal(parseGlobeQuery('?country=name%3AFrance')?.country, 'name:France');
    assert.equal(parseGlobeQuery('?country=name:Norway')?.country, 'name:Norway');
  });

  test('parse 容错：非法 country/theme 丢弃为 null（陈旧分享链接不阻塞页面）', () => {
    for (const bad of ['F', 'FRANC', '12', 'F!', '', '   ', 'name:', 'NAME:France']) {
      assert.equal(parseGlobeQuery(`?country=${encodeURIComponent(bad)}`)?.country, null, `country「${bad}」应为 null`);
    }
    assert.equal(parseGlobeQuery('?theme=vintage')?.theme, null); // 注册表外主题
    assert.equal(parseGlobeQuery('?theme=Dark')?.theme, null); // 主题 id 大小写敏感（注册表同口径）
    assert.deepEqual(parseGlobeQuery('?foo=1&country=CN&theme=dark'), { country: 'CN', theme: 'dark' }); // 未知参数忽略
  });

  test('serialize：country 前 theme 后；空态 = 空 query；name: 键经 URLSearchParams 编码', () => {
    assert.equal(serializeGlobeQuery({ country: 'FR', theme: 'dark' }), '?country=FR&theme=dark');
    assert.equal(serializeGlobeQuery({ country: null, theme: 'dark' }), '?theme=dark');
    assert.equal(serializeGlobeQuery({ country: 'JP', theme: null }), '?country=JP');
    assert.equal(serializeGlobeQuery({ country: null, theme: null }), '');
    assert.equal(serializeGlobeQuery({ country: 'name:France', theme: null }), '?country=name%3AFrance');
  });

  test('round-trip：合法状态 serialize → parse 恒等', () => {
    const states: GlobeUrlState[] = [
      { country: 'FR', theme: 'dark' },
      { country: 'name:France', theme: 'light' },
      { country: 'DEU', theme: null },
      { country: null, theme: 'dark' },
      { country: null, theme: null }
    ];
    for (const s of states) assert.deepEqual(parseGlobeQuery(serializeGlobeQuery(s)), s);
  });

  test('派生 helper：withCountry/withTheme 值替换且不改传入对象（不可变派生）', () => {
    const base: GlobeUrlState = { country: 'FR', theme: null };
    assert.deepEqual(withCountry(base, null), { country: null, theme: null });
    assert.deepEqual(withTheme(base, 'dark'), { country: 'FR', theme: 'dark' });
    assert.deepEqual(base, { country: 'FR', theme: null }); // 原对象不动
  });
});

describe('camera（DR-M4 · 相机聚焦视图纯函数；相机态不入 URL）', () => {
  test('easeInOutCubic：f(0)=0、f(0.5)=0.5、f(1)=1、两端点外夹取、f(t)=f(1-t) 对称、单调', () => {
    assert.equal(easeInOutCubic(0), 0);
    assert.equal(easeInOutCubic(0.5), 0.5);
    assert.equal(easeInOutCubic(1), 1);
    assert.equal(easeInOutCubic(-0.3), 0); // 夹取
    assert.equal(easeInOutCubic(1.7), 1); // 夹取
    assert.equal(easeInOutCubic(0.25), 1 - easeInOutCubic(0.75)); // 对称
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = easeInOutCubic(i / 20);
      assert.ok(v >= prev, `easing 非单调 @${i / 20}`);
      prev = v;
    }
  });

  test('focusZoomForSpan：退化/零跨度 → 上限；360° 全球 → 下限；夹取生效；随跨度单调递减', () => {
    assert.equal(focusZoomForSpan(0), FOCUS_ZOOM_RANGE.max);
    assert.equal(focusZoomForSpan(-5), FOCUS_ZOOM_RANGE.max);
    assert.equal(focusZoomForSpan(360), FOCUS_ZOOM_RANGE.min);
    assert.equal(focusZoomForSpan(0.001), FOCUS_ZOOM_RANGE.max); // 微型 bbox 夹取上限
    const mid = focusZoomForSpan(10); // 法国量级（~9°）→ 中高倍
    assert.ok(mid > FOCUS_ZOOM_RANGE.min && mid < FOCUS_ZOOM_RANGE.max, `span=10 zoom 越界：${mid}`);
    assert.ok(focusZoomForSpan(10) > focusZoomForSpan(30), 'zoom 应随跨度增大而减小');
    assert.ok(focusZoomForSpan(30) > focusZoomForSpan(120), 'zoom 应随跨度增大而减小');
  });

  test('focusViewFromBbox：中心 = bbox 中心；zoom 取经/纬跨度较大者', () => {
    const v = focusViewFromBbox({ minLng: 0, minLat: 0, maxLng: 10, maxLat: 6 });
    assert.deepEqual(v.center, [5, 3]);
    assert.equal(v.zoom, focusZoomForSpan(10)); // max(10, 6) = 10
    const v2 = focusViewFromBbox({ minLng: -124.7, minLat: 24.5, maxLng: -66.9, maxLat: 49.4 });
    assert.ok(Math.abs(v2.center[0] - -95.8) < 0.01 && Math.abs(v2.center[1] - 36.95) < 0.01); // 美国本土量级
    assert.equal(v2.zoom, focusZoomForSpan(57.8)); // 经度跨度为主
  });
});

describe('labels.featureBbox（DR-M4 · 代表环 bbox——聚焦中心与标注点同环同中心）', () => {
  const square = (x0: number, y0: number, x1: number, y1: number): number[][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0]
  ];

  test('Polygon：外环 bbox；MultiPolygon：取面积最大环（与代表点同环）', () => {
    assert.deepEqual(
      featureBbox({ type: 'Polygon', coordinates: [square(0, 0, 10, 10)] }),
      { minLng: 0, minLat: 0, maxLng: 10, maxLat: 10 }
    );
    assert.deepEqual(
      featureBbox({ type: 'MultiPolygon', coordinates: [[square(0, 0, 1, 1)], [square(20, 20, 30, 30)]] }),
      { minLng: 20, minLat: 20, maxLng: 30, maxLat: 30 }
    );
  });

  test('退化容错：null 几何 / 空环 / 全非坐标环 → null', () => {
    assert.equal(featureBbox(null), null);
    assert.equal(featureBbox({ type: 'Polygon', coordinates: [[]] }), null);
    assert.equal(featureBbox({ type: 'Polygon', coordinates: [['x', 'y']] }), null);
  });
});
