/**
 * search-parse —— q 分字段定向解析（S2-2 专项一 · 方案 b 钦定 2026-11-16）。
 *
 * 语法（评审案 = ../Musicgraphy-2.0-文档包/05-系统架构设计/评审案-搜索分字段定向.md）：
 *   - 前缀记号 artist: / title: / tag: / note:（空白分隔；前缀名大小写不敏感）；
 *   - 引号值 artist:"Jordan Rakei" 支持含空格；无引号值 = 到下一个已识别前缀记号或串尾；
 *   - 多前缀 = AND 组合（buildWhere 逐值生成条件自然 AND）；同字段多次出现 = 各一条件 AND；
 *   - 无前缀文本段 = 现状盲搜语义（四字段 OR；多段之间 AND）；
 *   - 整串无任何已识别前缀 = 与现状完全一致（单段四字段 OR，向后兼容零行为变化）；
 *   - 未知前缀（foo:）= 字面量参与盲搜（不报错）；空值前缀忽略（artist: 单独出现 → q 无条件）。
 * 纯函数零依赖：buildWhere（本地 Collection）与 searchAlbums（外部链）共用同一解析。
 * 转义不在本层（escapeLike 由各消费方在拼 LIKE 前施加；解析输出保持用户原文）。
 */

export interface ParsedQuery {
  /** 无前缀文本段：每段做四字段 OR，段间 AND */
  bare: string[];
  /** artist: 值（m.artist LIKE），多次出现各自一条件 */
  artist: string[];
  /** title: 值（m.title LIKE） */
  title: string[];
  /** tag: 值（tags.name LIKE，与现状盲搜同轴） */
  tag: string[];
  /** note: 值（r.note LIKE） */
  note: string[];
  /** 是否出现已识别前缀记号（区分分字段模式与纯盲搜；外部链据此决定透传/折叠） */
  fielded: boolean;
}

const PREFIX_RE = /^(artist|title|tag|note):(.*)$/i;

type FieldKey = 'artist' | 'title' | 'tag' | 'note';

const FIELD_KEYS: readonly FieldKey[] = ['artist', 'title', 'tag', 'note'];

const isBoundary = (q: string, i: number): boolean => i === 0 || /\s/.test(q[i - 1] ?? '');

/** 位置 i 是否为已识别前缀记号起点（记号须以空白或串首为界）；命中返回字段名 */
function prefixAt(q: string, i: number): FieldKey | null {
  if (!isBoundary(q, i)) return null;
  const m = PREFIX_RE.exec(q.slice(i));
  if (m === null) return null;
  const key = (m[1] ?? '').toLowerCase(); // 捕获组必参与（正则保证），?? 收敛 noUncheckedIndexedAccess
  return FIELD_KEYS.includes(key as FieldKey) ? (key as FieldKey) : null;
}

/** 解析 q 为分字段结构（纯函数；任何输入不抛错，畸形输入按字面量/忽略收敛） */
export function parseFieldQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { bare: [], artist: [], title: [], tag: [], note: [], fielded: false };
  const q = raw.trim();
  if (q === '') return out;

  let bareStart = 0; // 当前未消费文本段起点（前缀记号之间的部分归 bare）
  let i = 0;

  const flushBare = (end: number): void => {
    const seg = q.slice(bareStart, end).trim();
    if (seg !== '') out.bare.push(seg);
  };

  while (i < q.length) {
    const field = prefixAt(q, i);
    if (field === null) {
      i += 1;
      continue;
    }
    out.fielded = true;
    flushBare(i);
    i += field.length + 1; // 跳过 "artist:" 记号
    let value: string;
    if (q[i] === '"') {
      // 引号值：到下一个引号（未闭合 = 取到串尾）；引号内前缀记号不识别
      const close = q.indexOf('"', i + 1);
      if (close === -1) {
        value = q.slice(i + 1);
        i = q.length;
      } else {
        value = q.slice(i + 1, close);
        i = close + 1;
      }
    } else {
      // 无引号值：到下一个已识别前缀记号或串尾
      const start = i;
      while (i < q.length && prefixAt(q, i) === null) i += 1;
      value = q.slice(start, i).trim();
    }
    if (value !== '') out[field].push(value);
    bareStart = i; // 引号值后的残余文本（含无空白紧邻记号）按字面量归 bare
  }
  flushBare(q.length);
  return out;
}
