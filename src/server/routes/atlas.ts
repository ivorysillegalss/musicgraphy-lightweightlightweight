/**
 * atlas 域路由 —— GET /atlas：globe-view 岛屿 SSR 宿主页（DR-M2/M3）。
 *
 * 独立域文件而非并入 pages.ts 的取舍（二选一已裁决，提交说明披露）：routes/ 各域文件
 * 归各自 agent 所有——pages.ts 归 pages 会话所有，最小侵入 = 新域文件 + app.ts 一行挂载
 * （评审案 5db47b4 §6「pages.ts 最小增量或新域文件」中侵入面更小的选项）。页面守卫 =
 * installAuth 的 use('/*') 拓扑自动覆盖（app.ts 挂载序：鉴权先于本路由注册）。
 */
import { Hono } from 'hono';
import { renderAtlas } from '../pages/atlas';

export function atlasRoutes(): Hono {
  const app = new Hono();
  app.get('/', (c) => c.html(renderAtlas({ title: 'Musicgraphy · Album Atlas（骨架）' })));
  return app;
}
