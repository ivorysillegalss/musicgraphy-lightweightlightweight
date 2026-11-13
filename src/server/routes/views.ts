// 命名视图域路由（P1-10，评审案 docs/saved-views-review.md Q6；用户 2026-11-14 批准实现；ADR-007 状态码/envelope 口径）：
// GET /api/v1/saved-views {data:[…]} · POST 201+Location / 409 duplicate_record（重名）/ 422 · DELETE /:id 200 / 404。
// 只存查询状态（裁决案 4 附条件）；query_json 形状校验 = 可解析为 FilterState（02 §2.4）。
import { Hono } from 'hono';
import type { DAO } from '../db/dao';
import { errorBody } from '../http';
import { queryJsonToFilter } from '../pages/collection';

export function savedViewRoutes(dao: DAO): Hono {
  const app = new Hono();

  app.get('/saved-views', (c) => c.json({ data: dao.listSavedViews() }));

  app.post('/saved-views', async (c) => {
    const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (b === null) return c.json(errorBody('invalid_body', '请求体须为 JSON'), 422);
    const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
    const queryJson = typeof b['query_json'] === 'string' ? b['query_json'] : '';
    const fields: Record<string, string> = {};
    if (name === '') fields['name'] = '必填';
    if (queryJson === '' || queryJsonToFilter(queryJson) === null) {
      fields['query_json'] = '必须是可解析的查询状态（{axes:{genre,release_year,listened_period,favorite,tag,color}, q}，02 §2.4）';
    }
    if (Object.keys(fields).length > 0) return c.json(errorBody('validation_failed', '字段校验失败', { fields }), 422);
    const { id } = dao.createSavedView(name, queryJson); // 重名 → DuplicateRecordError 经 onError 409
    c.header('Location', `/api/v1/saved-views`);
    return c.json({ data: { id, name } }, 201);
  });

  app.delete('/saved-views/:id', (c) => {
    const { id } = dao.deleteSavedView(c.req.param('id')); // 不存在 → NotFoundError 经 onError 404
    return c.json({ data: { id } });
  });

  return app;
}
