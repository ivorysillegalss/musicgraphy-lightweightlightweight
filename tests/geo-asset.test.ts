// DR-G1 地理数据资产冒烟（设计参考 03 §5.3 DR-G1：产物在档 + 结构有效 + 归一字段齐备）。
// 离线测试：只读仓库内 public/geo/countries-110m.json（不触网——网络归 build 脚本）。
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

interface Feature {
  type: string;
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown } | null;
}
interface Collection {
  type: string;
  features: Feature[];
}

const ASSET = fileURLToPath(new URL('../public/geo/countries-110m.json', import.meta.url));

describe('DR-G1 自托管国家边界资产（public/geo/countries-110m.json）', () => {
  const bytes = readFileSync(ASSET);
  const geo = JSON.parse(bytes.toString('utf8')) as Collection;

  test('有效 FeatureCollection，要素数 ≥ 170', () => {
    assert.equal(geo.type, 'FeatureCollection');
    assert.ok(Array.isArray(geo.features));
    assert.ok(geo.features.length >= 170, `要素数 ${geo.features.length} < 170`);
  });

  test('每要素 properties 含 iso_a2/iso_a3/name_en/name_zh 字符串字段（name_en 非空，geometry 在档）', () => {
    for (const f of geo.features) {
      assert.equal(f.type, 'Feature');
      const p = f.properties;
      assert.ok(p, 'properties 缺失');
      assert.equal(typeof p['iso_a2'], 'string');
      assert.equal(typeof p['iso_a3'], 'string');
      assert.equal(typeof p['name_en'], 'string');
      assert.equal(typeof p['name_zh'], 'string');
      assert.ok((p['name_en'] as string).length > 0, 'name_en 为空');
      const g = f.geometry;
      if (g === null) throw new Error('geometry 缺失');
      assert.ok(['Polygon', 'MultiPolygon'].includes(g.type), `geometry 类型异常：${g.type}`);
    }
  });

  test('geometry 坐标已降密至 5 位小数（DR-G1 体积控制纪律）', () => {
    let checked = 0;
    const walk = (node: unknown): void => {
      if (!Array.isArray(node)) return;
      if (typeof node[0] === 'number') {
        for (const v of node as number[]) {
          assert.ok(Math.abs(Math.round(v * 1e5) - v * 1e5) < 1e-6, `坐标超 5 位小数：${v}`);
        }
        checked += 1;
        return;
      }
      for (const child of node) walk(child);
    };
    for (const f of geo.features) {
      const g = f.geometry;
      if (g === null) throw new Error('geometry 缺失');
      walk(g.coordinates);
    }
    assert.ok(checked > 0, '未检到任何 Position');
  });

  test('文件体积记录（落盘 243,411 B 口径；回归上限 300KB）', () => {
    const size = statSync(ASSET).size;
    console.log(
      `[geo-asset] countries-110m.json 体积 = ${size} B（${(size / 1024).toFixed(1)} KB）；要素数 = ${geo.features.length}`
    );
    const zh = geo.features.filter(
      (f) => ((f.properties ?? {})['name_zh'] as string).length > 0
    ).length;
    console.log(`[geo-asset] name_zh 覆盖 = ${zh}/${geo.features.length}`);
    assert.ok(size > 100 * 1024, `体积 ${size} B 异常偏小——资产可能损坏`);
    assert.ok(size < 300 * 1024, `体积 ${size} B 超 300KB 回归上限——检查降密/归一是否被绕过`);
    assert.ok(
      zh === geo.features.length,
      'name_zh 覆盖率下降（NE 源更新所致时须更新脚本披露注释）'
    );
  });
});
