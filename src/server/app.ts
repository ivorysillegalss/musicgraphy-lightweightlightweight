import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Config } from './config';
import type { DAO } from './db/dao';
import { CursorInvalidError, DuplicateRecordError, NotFoundError } from './db/dao';
import { errorBody } from './http';
import { installAuth, isAuthed, sameOrigin } from './auth';
import { metadataRoutes } from './routes/metadata';
import { recordsRoutes, type RecordsRouteOptions } from './routes/records';
import { LocalRateLimitError } from './metadata/queue';
import { UpstreamError, type AlbumCandidate, type MusicBrainzClient } from './metadata/musicbrainz';
import { renderHome, type HomeItem } from './pages/home';
import type { CollectionItem } from './db/types';

export type AppOptions = RecordsRouteOptions;

const withCover = (it: CollectionItem): HomeItem => ({
  ...it,
  cover_src: it.album.cover_local !== null ? `/covers/${it.album.cover_local}` : it.album.cover_url
});

export function createApp(dao: DAO, cfg: Config, mb: MusicBrainzClient, opts: AppOptions = {}): Hono {
  const app = new Hono();

  // 静态资源（复审 V8 拓扑，公开）：serveStatic root 是基准目录，URL 路径整体拼在其后——
  // /static/main.js → ./dist/static/main.js；/covers/xx.jpg → ./data/covers/xx.jpg
  app.use('/static/*', serveStatic({ root: './dist' }));
  app.use('/covers/*', serveStatic({ root: './data' }));

  // 鉴权（V10）：登录页 + 页面 302 守卫 + API cookie/Bearer + CSRF；须先于业务路由注册
  installAuth(app, cfg);

  app.route('/api/v1', metadataRoutes(dao, mb));
  app.route('/api/v1', recordsRoutes(dao, opts));

  // IM-11：守护探测保持公开（仅非敏感运行指标）
  app.get('/api/v1/health', (c) =>
    c.json({
      data: {
        ok: true,
        env: cfg.env,
        node: process.version,
        rss_mb: Math.round(process.memoryUsage().rss / 1048576)
      }
    })
  );

  // W1 无 JS 垂直切片首页（V4 基线）：搜索=原生 GET form，添加=原生 POST+303；JS 岛屿仅增强
  app.get('/', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    const page = dao.listPage({ cursor: c.req.query('cursor') || null, limit: 60 });
    let candidates: AlbumCandidate[] | null = null;
    let notice: string | null = null;
    if (q.length >= 2) {
      try {
        candidates = await mb.searchReleases(q, 12);
        const existing = dao.existingSourceIds('musicbrainz', candidates.map((x) => x.source_id));
        for (const cd of candidates) cd.in_collection = existing.has(cd.source_id);
      } catch (err) {
        notice =
          err instanceof LocalRateLimitError
            ? '搜索过于频繁，请稍后再试。'
            : err instanceof UpstreamError
              ? '元数据上游暂不可用，请稍后重试。'
              : '搜索失败，请重试。';
      }
    }
    return c.html(
      renderHome({
        stats: dao.stats(),
        q: q === '' ? null : q,
        items: page.items.map(withCover),
        nextCursor: page.meta.next_cursor,
        candidates,
        notice
      })
    );
  });

  // 无 JS 添加通道（与 POST /api/v1/records 同一 DAO 路径；303 回网格——I3「≤3 步/15s」）
  app.post('/add', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    if (!isAuthed(c, cfg)) return c.redirect('/login', 302);
    const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const sourceId = typeof b['source_id'] === 'string' ? b['source_id'].trim() : '';
    const title = typeof b['title'] === 'string' ? b['title'].trim() : '';
    const artist = typeof b['artist'] === 'string' ? b['artist'].trim() : '';
    if (sourceId === '' || title === '' || artist === '') return c.text('缺少候选字段', 422);
    const coverUrl = typeof b['cover_url'] === 'string' && b['cover_url'] !== '' ? b['cover_url'] : null;
    const year = Number(b['release_year']);
    const { id: albumId } = dao.upsertAlbum({
      source: 'musicbrainz',
      source_id: sourceId,
      title,
      artist,
      release_year: Number.isFinite(year) && year > 0 ? Math.trunc(year) : null,
      cover_url: coverUrl
    });
    try {
      dao.createRecord({ album_id: albumId });
    } catch (err) {
      if (err instanceof DuplicateRecordError) return c.redirect('/?notice=duplicate', 303);
      throw err;
    }
    opts.onAlbumAdded?.(albumId, sourceId, coverUrl);
    return c.redirect('/', 303);
  });

  // 统一错误映射（DAO 类型化错误 → HTTP，复审 V1）
  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json(errorBody('record_not_found', '记录不存在'), 404);
    if (err instanceof DuplicateRecordError) {
      return c.json(errorBody('duplicate_record', '该专辑已在 Collection 中', { record_id: err.recordId }), 409);
    }
    if (err instanceof CursorInvalidError) return c.json(errorBody('cursor_invalid', '无效的分页游标'), 400);
    console.error(`500 [${c.req.method} ${c.req.path}]`, err);
    return c.json(errorBody('internal_error', '服务器内部错误'), 500);
  });

  return app;
}
