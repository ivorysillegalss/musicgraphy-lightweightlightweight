-- 0005 telemetry_days（W8-9 行为埋点立项：PRD §6 行为类四仪表的数据源；评审案 docs/telemetry-review.md）
-- 用户 2026-11-15 执行令（立项 = 评审案先行，Q1–Q5 全按建议值）。只追加、禁改历史迁移（0001 不动）。
-- 天粒度聚合计数（匿名化 = 仅聚合、无个人标识符；零外发）——不是事件表：
-- 「收听史事件表」在不做清单（PRD §8），本表只存日计数列、零个人维度、零事件明细。
-- 「可关闭」= cookie mg_metrics=closed 时停记（opt-out，评审案 Q3；无 cookie = 记）。
CREATE TABLE telemetry_days (
  day          TEXT PRIMARY KEY,          -- 本地日 YYYY-MM-DD（echo.ts 本地时区口径）
  search_total INTEGER NOT NULL DEFAULT 0,
  search_fail  INTEGER NOT NULL DEFAULT 0,
  echo_shown   INTEGER NOT NULL DEFAULT 0,
  echo_click   INTEGER NOT NULL DEFAULT 0,
  detail_view  INTEGER NOT NULL DEFAULT 0,
  note_view    INTEGER NOT NULL DEFAULT 0,
  export_cnt   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);
