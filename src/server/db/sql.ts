import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { parseFieldQuery } from './search-parse';

export type Cell = string | number | bigint | Uint8Array | null;
export type Row = Record<string, Cell>;

export interface Filters {
  genre?: string;
  year?: number;
  listenedFrom?: string;
  listenedTo?: string;
  favorite?: boolean;
  tag?: string;
  color?: number;
  q?: string;
}

export type Axis = 'genre' | 'year' | 'listened' | 'favorite' | 'tag' | 'color';

/** 排序规格：expr 用于 ORDER BY 与 row-value cursor 比较（复审 V11）；key 用于从行取 cursor 值 */
export interface SortSpec {
  expr: string;
  key: string;
  desc: boolean;
}

export const SORTS: Record<string, SortSpec> = {
  added: { expr: 'r.added_at', key: 'added_at', desc: true },
  oldest: { expr: 'r.added_at', key: 'added_at', desc: false },
  year: { expr: 'm.release_year', key: 'release_year', desc: true },
  artist: { expr: 'm.artist COLLATE NOCASE', key: 'artist', desc: false },
  title: { expr: 'm.title COLLATE NOCASE', key: 'title', desc: false },
  favorite: { expr: 'r.is_favorite', key: 'is_favorite', desc: true }
};

/** LIKE 转义（评审 R10 注记：SQLite LIKE 仅 ASCII 折叠大小写；%_\\ 必须转义） */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export const normalizeTag = (s: string): string => s.trim().toLowerCase();

export const nowIso = (): string => new Date().toISOString();

/** 组合筛选（FR-2 chips）。exclude = "轴排除式 facet 计数"时剔除自身轴 */
export function buildWhere(f: Filters, userId: string, exclude?: Axis): { where: string; params: Cell[] } {
  const conds: string[] = ['r.user_id = ?'];
  const params: Cell[] = [userId];
  if (exclude !== 'genre' && f.genre) {
    conds.push('EXISTS (SELECT 1 FROM json_each(m.genres) je WHERE je.value = ?)');
    params.push(f.genre);
  }
  if (exclude !== 'year' && f.year !== undefined) {
    conds.push('m.release_year = ?');
    params.push(f.year);
  }
  if (exclude !== 'listened' && f.listenedFrom) {
    conds.push('r.listened_at >= ?');
    params.push(f.listenedFrom);
  }
  if (exclude !== 'listened' && f.listenedTo) {
    conds.push('r.listened_at <= ?');
    params.push(f.listenedTo);
  }
  if (exclude !== 'favorite' && f.favorite) conds.push('r.is_favorite = 1');
  if (exclude !== 'tag' && f.tag) {
    conds.push('EXISTS (SELECT 1 FROM record_tag rt JOIN tags t ON t.id = rt.tag_id WHERE rt.record_id = r.id AND t.normalized_name = ?)');
    params.push(normalizeTag(f.tag));
  }
  if (exclude !== 'color' && f.color !== undefined) {
    conds.push('r.cover_color = ?');
    params.push(f.color);
  }
  if (f.q) {
    // S2-2 分字段定向（方案 b，评审案 = 文档包 05/评审案-搜索分字段定向.md）：
    // 前缀记号逐值生成条件（AND）；bare 段维持现状盲搜（四字段 OR）。
    // 整串无前缀时 bare 恰为一段 = 与旧实现字节同形（向后兼容零行为变化）。
    const parsed = parseFieldQuery(f.q);
    const likeCond = (expr: string): string => `${expr} LIKE ? ESCAPE '\\'`;
    const blindOr = (): string =>
      `(${likeCond('m.title')} OR ${likeCond('m.artist')} OR ${likeCond('r.note')} ` +
        `OR EXISTS (SELECT 1 FROM record_tag rt2 JOIN tags t2 ON t2.id = rt2.tag_id WHERE rt2.record_id = r.id AND ${likeCond('t2.name')}))`;
    const tagExists = (): string =>
      `EXISTS (SELECT 1 FROM record_tag rt2 JOIN tags t2 ON t2.id = rt2.tag_id WHERE rt2.record_id = r.id AND ${likeCond('t2.name')})`;
    for (const seg of parsed.bare) {
      const like = `%${escapeLike(seg)}%`;
      conds.push(blindOr());
      params.push(like, like, like, like);
    }
    for (const v of parsed.artist) {
      conds.push(likeCond('m.artist'));
      params.push(`%${escapeLike(v)}%`);
    }
    for (const v of parsed.title) {
      conds.push(likeCond('m.title'));
      params.push(`%${escapeLike(v)}%`);
    }
    for (const v of parsed.tag) {
      conds.push(tagExists());
      params.push(`%${escapeLike(v)}%`);
    }
    for (const v of parsed.note) {
      conds.push(likeCond('r.note'));
      params.push(`%${escapeLike(v)}%`);
    }
  }
  return { where: conds.join(' AND '), params };
}

/** prepared statements 进程级缓存（ADR-005 纪律④：一次解析） */
export class StmtCache {
  private map = new Map<string, StatementSync>();
  constructor(private db: DatabaseSync) {}
  get(sql: string): StatementSync {
    let s = this.map.get(sql);
    if (s === undefined) {
      s = this.db.prepare(sql);
      this.map.set(sql, s);
    }
    return s;
  }
}

/** cursor = 不透明 base64url(JSON [sort_value, id])（复审 V11） */
export function encodeCursor(value: string | number | null, id: string): string {
  return Buffer.from(JSON.stringify([value, id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): [string | number | null, string] | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && v.length === 2 && typeof v[1] === 'string') {
      const val = v[0];
      if (val === null || typeof val === 'string' || typeof val === 'number') return [val, v[1]];
    }
  } catch {
    /* fallthrough */
  }
  return null;
}
