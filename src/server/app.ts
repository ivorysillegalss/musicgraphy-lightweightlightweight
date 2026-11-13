import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Config } from './config';
import type { DAO } from './db/dao';
import { CursorInvalidError, DuplicateRecordError, NotFoundError } from './db/dao';
import { errorBody } from './http';
import { installAuth } from './auth';
import { metadataRoutes } from './routes/metadata';
import { recordsRoutes, type RecordsRouteOptions } from './routes/records';
import { exportRoutes } from './routes/export';
import { pagesRoutes } from './routes/pages';
import { coverRoutes } from './metadata/cover-routes';
import { SourceChain, type AlbumSource } from './metadata/sources';

export type AppOptions = RecordsRouteOptions & {
  /** 封面子应用覆盖项（测试零网络 seam：tmp coversDir / fetch 注入；缺省用 config + 全局 fetch） */
  cover?: {
    coversDir?: string;
    fetchFn?: typeof fetch;
  };
};

export function createApp(dao: DAO, cfg: Config, sources: AlbumSource[], opts: AppOptions = {}): Hono {
  const app = new Hono();
  const chain = new SourceChain(sources);

  // 静态资源（复审 V8 拓扑，公开）：/static → vite 产物；/covers → 封面子应用
  // （磁盘命中流式 + immutable；未落盘封面按 album_metadata.cover_url 懒下载，Step 4/F3）
  app.use('/static/*', serveStatic({ root: './dist' }));
  app.route(
    '/covers',
    coverRoutes(dao, {
      coversDir: opts.cover?.coversDir ?? cfg.coversDir,
      userAgent: cfg.userAgent,
      fetchFn: opts.cover?.fetchFn
    })
  );

  // 鉴权（V10）：登录页 + 页面 302 守卫 + API cookie/Bearer + CSRF；须先于业务路由注册
  installAuth(app, cfg);

  app.route('/api/v1', metadataRoutes(dao, sources));
  app.route('/api/v1', recordsRoutes(dao, opts));
  app.route('/api/v1', exportRoutes(dao, opts.cover?.coversDir ?? cfg.coversDir));
  // 呈现层（ADR-003）：SSR 页面子应用——Collection / 详情双区 / 添加基线 / 片段端点。
  // 旧 W1 垂直切片首页（renderHome + POST /add）由本子应用整体取代（模板见 pages/*.ts）。
  app.route('/', pagesRoutes(dao, chain, opts));

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
