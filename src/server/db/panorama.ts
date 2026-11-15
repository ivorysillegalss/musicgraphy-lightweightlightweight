// 收藏全景域（R-106 · S2-12——命名注记：/atlas 路由已被并行会话 DR globe 页占用（routes/atlas.ts 在制品），本域改称 panorama=收藏全景，评审案 Q1′ 披露）
// 专辑图集域（R-106 · S2-12，评审案 docs/design-refs-review.md Q6——设计参考 Album Atlas®：
// 专辑集合 = 可漫游的空间，空间位置承载语义；S2-8 拆解的「离线布局预计算」哲学）。
// 布局 = 服务端预计算（无在线力导向）：decade 行 × 首流派列簇 + id 确定性抖动，
// 同库同坐标（mulberry32(id 哈希) 与 genremap 同族）；全表读 = 内存纪律①豁免披露
// 第二则（export 先例，评审案 Q6——字节数/RSS 随卡 evidence 实测报告，观察指标口径）。
import type { Row, StmtCache } from './sql';
import { asNumN, asStr, asStrN, cell } from './types';

export interface PanoramaNode {
  /** collection_record.id */
  i: string;
  /** 布局坐标 0..1000 */
  x: number;
  y: number;
  /** cover_color 1..16（无则 null → 渲染兜底色块） */
  c: number | null;
  /** cover_local 文件名（无则 null → 色块）；/covers 流式（禁 base64） */
  u: string | null;
  /** 截断标题（≤24 字符，tooltip） */
  t: string;
  /** 截断艺术家（≤18 字符） */
  a: string;
}

export interface PanoramaData {
  w: number;
  h: number;
  nodes: PanoramaNode[];
  stats: { records: number; decades: number; clusters: number };
}

const SQL_ATLAS_ROWS =
  "SELECT r.id AS id, m.title AS title, m.artist AS artist, m.release_year AS year, r.cover_color AS color, m.cover_local AS cover_local, " +
  "COALESCE(json_extract(m.genres, '$[0]'), '') AS genre " +
  'FROM collection_record r JOIN album_metadata m ON m.id = r.album_id WHERE r.user_id = ? ORDER BY r.id';

/** FNV-1a 短哈希（id → 抖动种子，确定性） */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const trunc = (s: string, n: number): string => (Array.from(s).length <= n ? s : Array.from(s).slice(0, n).join('') + '…');

/**
 * 专辑图集布局（S2-12）：decade 行 × 首流派列簇 + 簇内确定性抖动 → 0..1000。
 * 列序 = 簇规模 DESC → 名称（全局一致 → 同流派跨年代纵向成带，年代横向成轴——
 * 空间位置即叙事，Album Atlas 设计原理②）。
 */
export function panoramaNodes(st: StmtCache, userId = 'local'): PanoramaData {
  const rows = st.get(SQL_ATLAS_ROWS).all(userId) as Row[];
  type Acc = { node: PanoramaNode; decade: number; genre: string };
  const acc: Acc[] = [];
  for (const r of rows) {
    const year = asNumN(cell(r, 'year'));
    acc.push({
      decade: year === null ? Number.NaN : Math.floor(year / 10) * 10,
      genre: asStr(cell(r, 'genre'), 'genre').trim(),
      node: {
        i: asStr(cell(r, 'id'), 'id'),
        x: 0,
        y: 0,
        c: asNumN(cell(r, 'color')),
        u: asStrN(cell(r, 'cover_local')),
        t: trunc(asStr(cell(r, 'title'), 'title'), 24),
        a: trunc(asStr(cell(r, 'artist'), 'artist'), 18)
      }
    });
  }
  // 簇（首流派）与 decade 的全局序
  const genreCount = new Map<string, number>();
  for (const it of acc) if (it.genre !== '') genreCount.set(it.genre, (genreCount.get(it.genre) ?? 0) + 1);
  const genres = [...genreCount.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map((x) => x[0]);
  const genreCol = new Map(genres.map((g, i) => [g, i]));
  const NO_GENRE_COL = genres.length; // 无流派 = 最后一列（诚实归类）
  const decades = [...new Set(acc.map((it) => (Number.isNaN(it.decade) ? -1 : it.decade)))].sort((x, y) => x - y);
  const decadeRow = new Map(decades.map((d, i) => [d, i]));
  // 网格铺排 + 抖动
  const cols = genres.length + (acc.some((it) => it.genre === '') ? 1 : 0);
  const nRows = Math.max(decades.length, 1);
  const stepX = 1000 / Math.max(cols, 1);
  const stepY = 1000 / nRows;
  for (const it of acc) {
    const col = it.genre === '' ? NO_GENRE_COL : (genreCol.get(it.genre) ?? NO_GENRE_COL);
    const row = decadeRow.get(Number.isNaN(it.decade) ? -1 : it.decade) ?? 0;
    const rnd = mulberry32(fnv1a(it.node.i));
    const jr = 0.34; // 抖动半径（格距比例）
    it.node.x = Math.round((col * stepX + stepX * (0.5 + (rnd() * 2 - 1) * jr)) * 10) / 10;
    it.node.y = Math.round((row * stepY + stepY * (0.5 + (rnd() * 2 - 1) * jr)) * 10) / 10;
  }
  return {
    w: 1000,
    h: 1000,
    nodes: acc.map((it) => it.node),
    stats: { records: acc.length, decades: decades.length, clusters: cols }
  };
}
