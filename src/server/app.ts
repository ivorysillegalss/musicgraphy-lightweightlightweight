import { Hono } from 'hono';
import { html } from 'hono/html';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Config } from './config';
import type { DAO } from './db/dao';
import { CursorInvalidError, DuplicateRecordError, NotFoundError } from './db/dao';

// 错误 envelope（ADR-007 条 6，复审 V1）：{error:{code,message,details?}}，禁 200+error
export function errorBody(code: string, message: string, details?: unknown): { error: { code: string; message: string; details?: unknown } } {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export function createApp(dao: DAO, cfg: Config): Hono {
  const app = new Hono();

  // 静态资源（复审 V8 拓扑）：serveStatic 的 root 是基准目录，URL 路径整体拼在其后——
  // /static/main.js → ./dist/static/main.js；/covers/xx.jpg → ./data/covers/xx.jpg
  app.use('/static/*', serveStatic({ root: './dist' }));
  app.use('/covers/*', serveStatic({ root: './data' }));

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

  // W0 骨架首页：验证 DB 链路 + 静态产物 + 客户端岛屿。页面形态由 07-前端设计包在 W1 接管。
  app.get('/', (c) => {
    const s = dao.stats();
    return c.html(
      html`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Musicgraphy</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; color: #2b2622; }
    h1 { font-size: 1.6rem; margin-bottom: 0.2rem; }
    .sub { color: #8a8078; margin-top: 0; }
    dl { display: flex; gap: 2rem; margin: 2rem 0; }
    dt { color: #8a8078; font-size: 0.8rem; }
    dd { font-size: 1.6rem; margin: 0; font-variant-numeric: tabular-nums; }
    input { width: 100%; padding: 0.6rem; border: 1px solid #d8d0c8; border-radius: 8px; font-size: 1rem; }
  </style>
</head>
<body>
  <main>
    <h1>Musicgraphy</h1>
    <p class="sub">个人专辑档案 · W0 骨架运行中（架构 C1）</p>
    <dl>
      <div><dt>记录</dt><dd>${s.records}</dd></div>
      <div><dt>收藏</dt><dd>${s.favorites}</dd></div>
      <div><dt>标签</dt><dd>${s.tags}</dd></div>
      <div><dt>艺术家</dt><dd>${s.artists}</dd></div>
    </dl>
    <input id="global-search" type="search" placeholder="搜索专辑 / 艺术家 / 笔记（按 / 聚焦）" autocomplete="off" />
  </main>
  <script src="/static/main.js" defer></script>
</body>
</html>`
    );
  });

  // 统一错误映射（DAO 类型化错误 → HTTP 状态码，复审 V1/错误 envelope）
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
