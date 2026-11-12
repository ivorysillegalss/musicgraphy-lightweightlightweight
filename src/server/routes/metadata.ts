// 元数据域路由（Hono 子应用，静态挂载不改 app 主体——拆分方案/PM §7.5）
// GET /api/v1/search/albums（02 §4 / FR-1 输入端）：多源降级链搜索代理（Step 4）
//   - ?q= 必带（≥2 字符）、?limit= 钳 1–25、?source= 可选（指定单源，默认走全链降级）
//   - 限流（复审 V2）：全局串行队列 + 30/min → LocalRateLimitError → 429 + Retry-After（per-IP 弃用）
//   - 全部上游失败 → 502 upstream_unavailable（主源错误优先透传 Retry-After）
//   - 响应字段对齐 02 §2.1 + in_collection（FR-1 捷径③）；落库/归并细节见 metadata/search.ts
// 注意：本域是"搜索外部源"；Collection 内检索走 collection/records 域的 q 参数。
import { Hono } from 'hono';
import type { DAO } from '../db/dao';
import { errorBody } from '../http';
import { LocalRateLimitError } from '../metadata/queue';
import { UpstreamError } from '../metadata/musicbrainz';
import { searchAlbums, type AlbumSearchItem } from '../metadata/search';
import { SourceChain, type AlbumSource } from '../metadata/sources';

const SOURCE_NAMES = new Set(['musicbrainz', 'deezer', 'itunes', 'discogs']);

export function metadataRoutes(dao: DAO, sources: AlbumSource[]): Hono {
  const app = new Hono();
  const chain = new SourceChain(sources);

  app.get('/search/albums', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2) {
      return c.json(errorBody('invalid_query', '搜索词至少 2 个字符', { field: 'q' }), 422);
    }
    const limitRaw = Number(c.req.query('limit') ?? '12');
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 25) : 12;
    const sourceRaw = (c.req.query('source') ?? '').trim();
    if (sourceRaw !== '' && !SOURCE_NAMES.has(sourceRaw)) {
      return c.json(errorBody('invalid_query', 'source 必须是 musicbrainz/deezer/itunes/discogs', { field: 'source' }), 422);
    }

    const picked = sourceRaw === '' ? chain : new SourceChain(sources.filter((s) => s.name === sourceRaw));
    let items: AlbumSearchItem[];
    try {
      items = await searchAlbums(dao, picked, q, limit);
    } catch (err) {
      if (err instanceof LocalRateLimitError) {
        return c.json(errorBody('rate_limited', '搜索过于频繁，请稍后再试', { retry_after_ms: err.retryAfterMs }), 429, {
          'Retry-After': String(Math.max(1, Math.ceil(err.retryAfterMs / 1000)))
        });
      }
      if (err instanceof UpstreamError) {
        const headers: Record<string, string> = err.retryAfterS !== null ? { 'Retry-After': String(err.retryAfterS) } : {};
        return c.json(errorBody('upstream_unavailable', '元数据上游暂不可用，请稍后重试', { upstream_status: err.status, code: err.code }), 502, headers);
      }
      throw err;
    }
    return c.json({ data: items });
  });

  return app;
}
