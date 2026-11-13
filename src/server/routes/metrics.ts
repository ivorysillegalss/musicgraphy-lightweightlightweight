// 观察池仪表路由（PRD §6 六埋点 · 02 §4 metrics 行）：GET /metrics/coverage → {data}。
// 匿名化 = 仅聚合比率、无个人标识符（02 §4 口径）；"可关闭"设置开关随 W8-9 行为埋点一并接线
// （当前数据全部本地派生、无任何外发，不存在关闭前的外泄面）。鉴权同全局（/api/v1/* 守卫）。
import { Hono } from 'hono';
import type { DAO } from '../db/dao';

export function metricsRoutes(dao: DAO): Hono {
  const app = new Hono();
  app.get('/metrics/coverage', (c) => c.json({ data: dao.metricsCoverage() }));
  return app;
}
