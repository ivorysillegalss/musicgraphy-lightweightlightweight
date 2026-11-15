// 流派星图域（R-109 · S2-24，评审案 docs/design-refs-review.md Q2/Q3——设计参考 Every Noise
// at Once：相似度 = 组织维度 + 服务端预计算布局，S2-11 拆解同款哲学）。
// 共现口径：节点 = Genre（album_metadata.genres json_each）+ Tag（record_tag×tags）；
// 边 = 同一条收藏记录上的两两共现（genre×genre / tag×tag / genre×tag），零外部调用
// （隐私红线 + 存活性——everynoise 因 Spotify API 关停进维护态的教训即本决策依据）。
// 相似度 = overlap 系数 w/min(n(a),n(b))；布局 = 确定性力导向（mulberry32 固定种子，
// 同库同布局可复算，color-extract CLI 先例）；坐标归一化 0..100。
import type { Row, StmtCache } from './sql';
import { asStr, cell } from './types';

export interface GenreMapNode {
  kind: 'genre' | 'tag';
  name: string;
  /** 覆盖记录数（节点权重） */
  count: number;
  /** 归一化坐标 0..100（SSR 直出 left/top 百分比） */
  x: number;
  y: number;
}

export interface GenreMap {
  nodes: GenreMapNode[];
  stats: { nodes: number; edges: number; genres: number; tags: number; maxCount: number };
}

interface LayoutEdge {
  a: number;
  b: number;
  /** overlap 系数 0..1 */
  s: number;
}

// —— SQL（域内常量，全部参数化零拼接注入面；json_each = W0-3 实测 ~ms 级先例）——

const SQL_GENRE_NODES =
  'SELECT je.value AS name, COUNT(*) AS count FROM collection_record r JOIN album_metadata m ON m.id = r.album_id, ' +
  "json_each(m.genres) je WHERE r.user_id = ? AND je.value IS NOT NULL AND TRIM(je.value) <> '' GROUP BY je.value ORDER BY COUNT(*) DESC, je.value";
const SQL_TAG_NODES =
  'SELECT t.name AS name, COUNT(*) AS count FROM record_tag rt JOIN tags t ON t.id = rt.tag_id ' +
  'WHERE t.user_id = ? GROUP BY rt.tag_id ORDER BY COUNT(*) DESC, t.name';
const SQL_GENRE_GENRE =
  'SELECT je1.value AS a, je2.value AS b, COUNT(*) AS w FROM collection_record r JOIN album_metadata m ON m.id = r.album_id, ' +
  "json_each(m.genres) je1, json_each(m.genres) je2 WHERE r.user_id = ? AND je1.value < je2.value AND TRIM(je1.value) <> '' AND TRIM(je2.value) <> '' GROUP BY je1.value, je2.value";
const SQL_TAG_TAG =
  'SELECT ta.name AS a, tb.name AS b, COUNT(*) AS w FROM record_tag rt1 JOIN record_tag rt2 ON rt1.record_id = rt2.record_id AND rt1.tag_id < rt2.tag_id ' +
  'JOIN tags ta ON ta.id = rt1.tag_id JOIN tags tb ON tb.id = rt2.tag_id WHERE ta.user_id = ? AND tb.user_id = ? GROUP BY ta.name, tb.name';
const SQL_GENRE_TAG =
  'SELECT je.value AS g, t.name AS tg, COUNT(*) AS w FROM collection_record r JOIN album_metadata m ON m.id = r.album_id, ' +
  "json_each(m.genres) je JOIN record_tag rt ON rt.record_id = r.id JOIN tags t ON t.id = rt.tag_id " +
  "WHERE r.user_id = ? AND t.user_id = ? AND TRIM(je.value) <> '' GROUP BY je.value, t.name";

/** mulberry32 固定种子 PRNG（确定性布局；种子 = 固定常量，非时间/随机熵） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LAYOUT_SEED = 0x1234abcd;
const ITERATIONS = 220;

/**
 * 确定性力导向布局（0..100 空间）：圆环初始化 → 迭代（边引力 ∝ overlap、库仑斥力 ∝ k²/d、
 * 向心 0.03、阻尼 0.85）→ bbox 归一化（保纵横比，留 8% 边距）。同库同输入 → 同坐标。
 */
interface Pt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 标签近似半径（字号×0.35，评审案 Q2） */
  r: number;
}

function layout(nodes: GenreMapNode[], edges: LayoutEdge[]): void {
  const n = nodes.length;
  if (n === 0) return;
  const rnd = mulberry32(LAYOUT_SEED);
  const pts: Pt[] = nodes.map((_, i) => {
    const ang = (i / n) * Math.PI * 2;
    return { x: 50 + Math.cos(ang) * 38, y: 50 + Math.sin(ang) * 38, vx: 0, vy: 0, r: 2.2 };
  });
  const k = Math.max(14, Math.min(34, 320 / Math.sqrt(n) + 14)); // 斥力尺度随节点数自适应
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const cool = 1 - iter / ITERATIONS; // 线性降温
    // 斥力（全对）
    for (let i = 0; i < pts.length; i++) {
      const pi = pts[i]!;
      for (let j = i + 1; j < pts.length; j++) {
        const pj = pts[j]!;
        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = (rnd() - 0.5) * 0.5;
          dy = (rnd() - 0.5) * 0.5;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const minD = pi.r + pj.r + 1.5;
        const f = ((k * k) / d2 + (d < minD ? (minD - d) * 1.5 : 0)) * cool;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        pi.vx += fx;
        pi.vy += fy;
        pj.vx -= fx;
        pj.vy -= fy;
      }
    }
    // 引力（边，overlap 加权）+ 向心
    for (const e of edges) {
      const ea = pts[e.a];
      const eb = pts[e.b];
      if (ea === undefined || eb === undefined) continue;
      const dx = eb.x - ea.x;
      const dy = eb.y - ea.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = e.s * 0.9 * cool;
      const fx = (dx / d) * f * Math.max(0, d - (ea.r + eb.r) * 1.6);
      const fy = (dy / d) * f * Math.max(0, d - (ea.r + eb.r) * 1.6);
      ea.vx += fx;
      ea.vy += fy;
      eb.vx -= fx;
      eb.vy -= fy;
    }
    for (const p of pts) {
      p.vx += (50 - p.x) * 0.03;
      p.vy += (50 - p.y) * 0.03;
      p.vx *= 0.85;
      p.vy *= 0.85;
      const step = 1.6 * cool + 0.2;
      const dl = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const clamp = dl > step ? step / dl : 1;
      p.x += p.vx * clamp;
      p.y += p.vy * clamp;
    }
  }
  // bbox 归一化（x/y 各自独立拉伸到 8..92——hub 型共现图天然宽扁，保纵横比会把 y 压扁；
  // 可读性优先于测度保真 = everynoise「readability-adjusted」同款取舍，评审案 Q2 注记）
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const sx = 84 / w;
  const sy = 84 / h;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  nodes.forEach((nd, i) => {
    const p = pts[i];
    if (p === undefined) return;
    nd.x = Math.round((50 + (p.x - cx) * sx) * 100) / 100;
    nd.y = Math.round((50 + (p.y - cy) * sy) * 100) / 100;
  });
}

/** 流派星图（S2-24）：共现 + 确定性布局；纯函数无副作用（每次即时计算，个人库节点数 ≪100 毫秒级——评审案 Q2） */
export function genreMap(st: StmtCache, userId = 'local'): GenreMap {
  const genres = st.get(SQL_GENRE_NODES).all(userId) as Row[];
  const tags = st.get(SQL_TAG_NODES).all(userId) as Row[];
  const index = new Map<string, number>();
  const nodes: GenreMapNode[] = [];
  const push = (kind: GenreMapNode['kind'], rows: Row[]): void => {
    for (const r of rows) {
      const name = asStr(cell(r, 'name'), 'name').trim();
      if (name === '' || index.has(`${kind}:${name}`)) continue;
      index.set(`${kind}:${name}`, nodes.length);
      nodes.push({ kind, name, count: Number(cell(r, 'count') ?? 0), x: 0, y: 0 });
    }
  };
  push('genre', genres);
  push('tag', tags);
  const edges: LayoutEdge[] = [];
  const addEdge = (ka: GenreMapNode['kind'], na: string, kb: GenreMapNode['kind'], nb: string, w: number): void => {
    if (na === nb && ka === kb) return;
    const ia = index.get(`${ka}:${na}`);
    const ib = index.get(`${kb}:${nb}`);
    const ca = ia === undefined ? undefined : nodes[ia];
    const cb = ib === undefined ? undefined : nodes[ib];
    if (ca === undefined || cb === undefined || ia === ib || ia === undefined || ib === undefined) return;
    const min = Math.min(ca.count, cb.count);
    if (min <= 0) return;
    edges.push({ a: Math.min(ia, ib), b: Math.max(ia, ib), s: Math.min(1, w / min) });
  };
  for (const r of st.get(SQL_GENRE_GENRE).all(userId) as Row[]) {
    addEdge('genre', asStr(cell(r, 'a'), 'a'), 'genre', asStr(cell(r, 'b'), 'b'), Number(cell(r, 'w') ?? 0));
  }
  for (const r of st.get(SQL_TAG_TAG).all(userId, userId) as Row[]) {
    addEdge('tag', asStr(cell(r, 'a'), 'a'), 'tag', asStr(cell(r, 'b'), 'b'), Number(cell(r, 'w') ?? 0));
  }
  for (const r of st.get(SQL_GENRE_TAG).all(userId, userId) as Row[]) {
    addEdge('genre', asStr(cell(r, 'g'), 'g'), 'tag', asStr(cell(r, 'tg'), 'tg'), Number(cell(r, 'w') ?? 0));
  }
  layout(nodes, edges);
  const maxCount = nodes.reduce((m, x) => Math.max(m, x.count), 0);
  return {
    nodes,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      genres: genres.length,
      tags: tags.length,
      maxCount
    }
  };
}

/** 星图节点字号（S2-25：字号 ∝ √覆盖数，11–26px 夹取——readability-adjusted 同款思路） */
export function nodeFontSize(count: number, maxCount: number): number {
  if (maxCount <= 1) return 15;
  const ratio = Math.sqrt(Math.max(0, count - 1)) / Math.sqrt(Math.max(1, maxCount - 1));
  return Math.round((11 + 15 * ratio) * 10) / 10;
}
