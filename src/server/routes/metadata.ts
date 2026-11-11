// 元数据域路由（Hono 子应用，静态挂载不改 app 主体——拆分方案/PM §7.5）
import { Hono } from 'hono';
import type { DAO } from '../db/dao';
import { errorBody } from '../http';
import { LocalRateLimitError } from '../metadata/queue';
import { UpstreamError, type AlbumCandidate, type MusicBrainzClient } from '../metadata/musicbrainz';

export function metadataRoutes(dao: DAO, mb: MusicBrainzClient): Hono {
  const app = new Hono();

  // GET /api/v1/search/albums（02 §4 / FR-1 输入端）：外部源搜索代理 + 已收藏前置标记
  app.get('/search/albums', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2) {
      return c.json(errorBody('invalid_query', '搜索词至少 2 个字符', { field: 'q' }), 422);
    }
    const limitRaw = Number(c.req.query('limit') ?? '12');
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 25) : 12;

    let candidates: AlbumCandidate[];
    try {
      candidates = await mb.searchReleases(q, limit);
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

    // FR-1 捷径③"已收藏前置标记"：候选阶段即标注已在 Collection，防止确认后才发现重复
    const existing = dao.existingSourceIds('musicbrainz', candidates.map((x) => x.source_id));
    for (const cand of candidates) cand.in_collection = existing.has(cand.source_id);
    return c.json({ data: candidates });
  });

  return app;
}
