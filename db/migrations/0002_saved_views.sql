-- 0002 saved_views（P1-10 命名视图 = 仅查询状态；02 §2.4 + 裁决案 4 附条件 + 评审案 docs/saved-views-review.md Q2/Q3）
-- 用户 2026-11-14 批准实现（新表 = 裁决保留权项，评审案先行）。只追加、禁改历史迁移（0001 不动）。

CREATE TABLE saved_views (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL DEFAULT 'local',
  name       TEXT NOT NULL,
  query_json TEXT NOT NULL,           -- {axes:{genre,release_year,listened_period,favorite,tag,color}, q}（02 §2.4）
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_saved_views_user_name ON saved_views (user_id, name);   -- 防重名（评审案 Q3 补约束，复审 V12 精神）
CREATE INDEX idx_saved_views_user_created ON saved_views (user_id, created_at DESC);
