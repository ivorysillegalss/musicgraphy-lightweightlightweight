// DR-I1 红线适配审计（派工 D4 · 设计参考 03 §5.3 DR-I1 + 评审案 5db47b4 §5 红线逐条）：
// 源码级断言「外部请求零新增」（netease.smoke Q3 零 logger 源码断言先例 readFileSync+regex）——
// ① globe-view/**/*.ts 与 public/geo/*.json 零外部绝对 URL（http:// / https:// 字面量）；
// ② 零 accessToken / mapbox 字面量（无 Mapbox 服务依赖——乙-5 资产自托管零 CDN）；
// ③ GeoJSON 与 mock 白名单资产 = 本地相对路径 fetch（'/static/geo/…' 同源规则）；
// ④ package.json dependencies 恰好 3 个（hono/@hono/node-server/maplibre-gl）——锁死依赖面；
// ⑤ maplibre-gl 运行时 import 唯一性（maplibre-adapter.ts = 全仓唯一非 type import，D3 契约）；
// ⑥ mock 白名单 ↔ GeoJSON 资产键一致性（键 = geoFeatureKey 同源三档，'-99' name 兜底在档）；
// ⑦ GPU/JS 白名单口径一致（five-state 表达式含 name 兜底 match 条款）。
// 豁免清单：**无**——当前源码零命中（注释同样不得出现上述字面量，保持最强 tripwire；
// 未来如需在注释/字符串引用外部 URL，须拆分形式书写并在此登记豁免，保持清单最小化）。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { fetchAvailability, AVAILABILITY_MOCK_URL } from '../src/client/islands/globe-view/availability';
import { geoFeatureKey, type GeoFeatureCollectionLike } from '../src/client/islands/globe-view/labels';
import { buildFillPaint } from '../src/client/islands/globe-view/five-state';
import { buildMapStyle, GEO_ASSET_URL } from '../src/client/islands/globe-view/maplibre-style';

const GLOBE_DIR = fileURLToPath(new URL('../src/client/islands/globe-view', import.meta.url));
const GEO_DIR = fileURLToPath(new URL('../public/geo', import.meta.url));
const PKG = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  dependencies: Record<string, string>;
};

/** 递归列出目录内指定扩展名文件（globe-view 含 adapters/ 子目录）。 */
function listFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${ent.name}`;
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(ext)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe('DR-I1 红线审计 · 零外部请求（乙-5 资产自托管零 CDN）', () => {
  const forbidden = ['http://', 'https://', 'mapbox', 'accessToken', 'access_token'] as const;

  test('globe-view/**/*.ts 零外部绝对 URL / 零 accessToken / 零 mapbox 字面量（豁免清单 = 空）', () => {
    const files = listFiles(GLOBE_DIR, '.ts');
    assert.ok(files.length >= 9, `globe-view 源文件数异常：${files.length}`);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const token of forbidden) {
        assert.ok(!src.includes(token), `${f} 含禁止字面量「${token}」——乙-5/隐私红线（豁免清单为空，不得新增）`);
      }
    }
  });

  test('public/geo/*.json 资产零外部 URL（GeoJSON + mock 白名单）', () => {
    for (const f of listFiles(GEO_DIR, '.json')) {
      const src = readFileSync(f, 'utf8');
      assert.ok(!src.includes('http://') && !src.includes('https://'), `${f} 含外部 URL——乙-5 红线`);
    }
  });

  test('资产 URL = 同源相对路径（/static/geo/ 直服规则；禁协议相对与绝对地址）', () => {
    for (const [name, url] of [
      ['countries-110m', GEO_ASSET_URL],
      ['availability.mock', AVAILABILITY_MOCK_URL]
    ] as const) {
      assert.ok(url.startsWith('/') && !url.startsWith('//'), `${name} 资产 URL 非同源相对路径：${url}`);
      assert.ok(!url.includes('http:'), `${name} 资产 URL 含协议：${url}`);
    }
    assert.equal(GEO_ASSET_URL, '/static/geo/countries-110m.json');
    assert.equal(AVAILABILITY_MOCK_URL, '/static/geo/availability.mock.json');
  });

  test('运行时依赖恰好 3 个（hono / @hono/node-server / maplibre-gl）——依赖面锁死', () => {
    const deps = Object.keys(PKG.dependencies).sort();
    assert.deepEqual(deps, ['@hono/node-server', 'hono', 'maplibre-gl']);
  });

  test("maplibre-gl 运行时 import 唯一性：maplibre-adapter.ts 是唯一非 type import（D3 契约延续）", () => {
    const files = listFiles(GLOBE_DIR, '.ts');
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const withoutTypeImports = src.replace(/import\s+type[^;]*;/gs, '');
      if (f.endsWith('maplibre-adapter.ts')) {
        assert.match(src, /import \{[^}]*\} from 'maplibre-gl'/, '适配器缺失运行时 maplibre import');
      } else {
        assert.ok(!withoutTypeImports.includes("from 'maplibre-gl'"), `${f} 出现非 type 的 maplibre import——渲染依赖唯一性破约`);
      }
    }
  });
});

describe('DR-I1 红线审计 · mock 白名单与资产一致性（G2 静态替身数据面）', () => {
  const asset = JSON.parse(
    readFileSync(`${GEO_DIR}/countries-110m.json`, 'utf8')
  ) as GeoFeatureCollectionLike;
  const mock = JSON.parse(
    readFileSync(`${GEO_DIR}/availability.mock.json`, 'utf8')
  ) as { comment?: string; available: unknown };

  test('available = 20–40 个字符串键（G2 替换点规模口径）', () => {
    assert.ok(Array.isArray(mock.available), 'available 非数组');
    assert.ok(mock.available.length >= 20 && mock.available.length <= 40, `白名单 ${mock.available.length} 项超出 20–40 口径`);
    for (const k of mock.available) assert.equal(typeof k, 'string');
  });

  test('每个白名单键命中 ≥1 个资产要素（键 = geoFeatureKey 同源三档：iso_a2 → iso_a3 → name:name_en）', () => {
    const keys = new Set<string>();
    for (const f of asset.features) keys.add(geoFeatureKey(f.properties ?? {}));
    const list = mock.available as string[];
    const unmatched = list.filter((k) => !keys.has(k));
    assert.deepEqual(unmatched, [], `白名单死键（无要素命中）：${JSON.stringify(unmatched)}`);
  });

  test("'-99' 兜底裁决落地：France/Norway（NE 110m ISO 双 -99）以 name: 键入列；无 '-99' 死键", () => {
    const list = mock.available as string[];
    assert.ok(list.includes('name:France') && list.includes('name:Norway'), '-99 要素 name 兜底键缺失（France/Norway）');
    for (const k of list) {
      assert.ok(!k.startsWith('-'), `白名单含 '-99' 族死键：${k}`);
    }
    // France/Norway 资产键核对（ISO 槽位确为 -99——兜底是唯一通路）
    for (const name of ['France', 'Norway']) {
      const f = asset.features.find((x) => x.properties?.['name_en'] === name);
      assert.ok(f, `资产缺 ${name}`);
      assert.equal(f.properties?.['iso_a2'], '-99');
      assert.equal(f.properties?.['iso_a3'], '-99');
      assert.equal(geoFeatureKey(f.properties ?? {}), `name:${name}`);
    }
  });

  test('GPU/JS 白名单口径一致：five-state 表达式含 name 兜底 match 条款（match+concat+coalesce）', () => {
    const paint = buildFillPaint(['CN', 'name:France'], { accent: '#D97706', base: '#E9E2D2' });
    const json = JSON.stringify(paint['fill-opacity']);
    assert.ok(json.includes('"match"') && json.includes('"concat"') && json.includes('"coalesce"'), '五态表达式缺 name 兜底条款（-99 要素基态将恒 empty）');
    assert.ok(json.includes('"name:France"'), '白名单 name 键未进 literal');
  });

  test('带白名单的 style 仍零外部 URL（D4 白名单注入不改乙-5 面貌；token 桩注入读色）', () => {
    const style = buildMapStyle('light', () => '#000000', ['CN', 'name:France']);
    const json = JSON.stringify(style);
    assert.ok(!json.includes('http://') && !json.includes('https://'), '白名单模式 style 含外部 URL——乙-5 红线');
    assert.ok(json.includes('"name:France"'), 'style 未携带白名单表达式');
  });
});

describe('DR-I1 红线审计 · 白名单加载器（G2 唯一替换点 · 注入 fetch 不触网）', () => {
  const resp = (body: string, status = 200): Response => new Response(body, { status });

  test('ok + 合法形状 → 键数组原样返回（空数组 = API 权威「当前无可用」，非 null）', async () => {
    const codes = await fetchAvailability(async () => resp(JSON.stringify({ comment: 'x', available: ['CN', 'name:France'] })));
    assert.deepEqual(codes, ['CN', 'name:France']);
    const empty = await fetchAvailability(async () => resp(JSON.stringify({ available: [] })));
    assert.deepEqual(empty, []);
  });

  test('非 ok / 坏形状 / 网络失败 → null（fail-open 降级全可用，宿主层不阻塞）', async () => {
    assert.equal(await fetchAvailability(async () => resp('nope', 404)), null);
    assert.equal(await fetchAvailability(async () => resp(JSON.stringify({ nope: 1 }))), null);
    assert.equal(await fetchAvailability(async () => resp(JSON.stringify({ available: 'CN' }))), null);
    assert.equal(
      await fetchAvailability(async () => {
        throw new Error('offline');
      }),
      null
    );
  });

  test('非字符串与空白项过滤（键表卫生）', async () => {
    const codes = await fetchAvailability(async () => resp(JSON.stringify({ available: ['CN', 42, '', '   ', null, 'JP'] })));
    assert.deepEqual(codes, ['CN', 'JP']);
  });
});
