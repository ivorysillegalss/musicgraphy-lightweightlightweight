-- 0004 topster_views（W10-12-1 W10 批 · Topster 策展模型；02-变现文档包/02-数据模型与API设计 §6 预留位原形 5 字段照抄）
-- 用户 2026-11-14 AskUserQuestion 批准（新表 = 裁决保留权项，评审案 docs/topster-review.md 先行）。
-- 只追加、禁改历史迁移（0001–0003 不动）。纯新表 DDL，无表重建，不依赖 0003 的任何对象。
-- 红线：Topster = Collection 的一种 View（PRD §4 方案 B 调整 1，禁第二套数据）——item_order 仅存
-- collection_record.id 引用（不复制专辑/记录数据，成员渲染实时 JOIN）；策展仅限顺序 + 副标题
-- （禁自由画布：无布局/位置字段，终稿不做清单铁律）；容量 ≤60（内存纪律① LIMIT≤60 对齐）由写路径执行。

CREATE TABLE topster_views (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL DEFAULT 'local',
  title      TEXT NOT NULL,              -- 主标题（写路径：必填非空 ≤80 字符）
  subtitle   TEXT,                       -- 副标题一句话（可选 ≤120 字符；案 2 底线「副标题可保存」）
  item_order TEXT NOT NULL DEFAULT '[]', -- JSON 数组 [record_id,...]；顺序即叙事（案 2 底线「顺序可保存」）
  created_at TEXT NOT NULL
);
CREATE INDEX idx_topster_views_user_created ON topster_views (user_id, created_at DESC);
