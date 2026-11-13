# P1-10 命名视图实现评审案 · saved_views（只存查询状态）

> 产出：W7-9-1 会话（2026-11-14）。性质：**评审案 → 用户裁决**（本卡红线：涉及新表一律评审案先行，
> 停止线命中即停下问用户——本案为「新表」项，**不自行实现**，批准后走既有迁移框架执行）。
> 规格出处：PRD P1-10（命名/恢复/删除；与 Topster 同构、无第二套集合）· 02 §2.4（表结构原形）·
> 02 §6 拓展点 #9 · 拆分方案 §8 · PM §4 W9 · 裁决案 4 附条件（只存查询状态，不存专辑集合）。
> 触发的第二条停止线：**G3 行数**（§4）——dao.ts 已 199 行贴线（W9 批 P1-6 落地后实测），
> 新增 3 个委托必超 200，预案 = echoToday 外拆（IM-10a 先例同款）。

---

## 1. 结论速览

| 项 | 决定 | 依据 |
|---|---|---|
| Q1 新表 | `saved_views`——**须用户裁决**（本仓新表 = 停止线；agent 只备案评审案） | 本卡红线 + 裁决保留权（删仓/预算超线/新表同级别裁决项） |
| Q2 迁移文件号 | `db/migrations/0002_saved_views.sql`（migrate.ts 顺序执行 + PRAGMA user_version；DDL 由执行器 BEGIN IMMEDIATE 包裹，文件内零 PRAGMA） | 既有迁移框架（migrate.ts 实况）；只追加、禁改历史（0001 不动） |
| Q3 表结构 | `id TEXT PK` · `user_id TEXT NOT NULL DEFAULT 'local'` · `name TEXT NOT NULL` · `query_json TEXT NOT NULL` · `created_at TEXT NOT NULL` + **UNIQUE(user_id, name)**（02 §2.4 未列——补此约束：同名视图语义混乱，防分裂与 tags UNIQUE 同理，复审 V12 精神）+ 索引 `(user_id, created_at DESC)` | 02 §2.4 字段原形 + 重名防御补约束（评审案披露，待追认时一并确认） |
| Q4 query_json 形状 | `{"axes":{"genre":…,"release_year":…,"listened_period":"YYYY","favorite":true,"tag":…,"color":…},"q":…}`——与页面 FilterState 一一映射（period ↔ listened_period）；**只存筛选状态不存结果集**（裁决案 4 附条件；与 Topster 同构零第二套数据） | 02 §2.4 原形状 + collection.ts FilterState 实况 |
| Q5 查询形状（DAO） | `listSavedViews(userId)`（全量，个人规模 LIMIT 100）/ `createSavedView(userId, name, queryJson)`（重名 → DuplicateRecordError 复用）/ `deleteSavedView(id, userId)`（NotFoundError 复用）——落 `db/savedviews.ts` 域文件 + dao.ts 三行委托 | 域文件委托先例（associations/taggov/metrics）；错误类型复用现有三态 |
| Q6 API | `/api/v1/saved-views` GET `{data:[…]}` · POST 201+Location（422 校验 name 非空/query_json 可解析）· DELETE `/:id` 200——envelope/状态码对齐 ADR-007；页面通道无 JS 基线：表单 POST `/views`（保存）→ 303 `/`；恢复 = `GET /?view=<name>` 服务端读 query_json 展开成筛选参数后 **303 到展开 URL**（URL 即状态不被破坏，可分享可回退）；删除 = 表单 POST `/views/delete` → 303 `/` | 02 §4 API 表精神 + pages 域 POST+303 先例（add/favorite/relisten 同款）；URL 即状态（ADR-003 DD3）不被命名视图破坏 |
| Q7 UI 版位 | 筛选舱上方一行「命名视图」区：视图列表（每项 = 恢复 `<a>` + 删除 form）+「保存当前筛选」表单（name input + 隐藏 query_json）；有筛选激活才显示保存入口（空态不鼓励存空视图） | PRD「侧栏一键恢复」的最小落点（舱顶一行 ≈ 侧栏，不新增页面/布局骨架） |
| Q8 埋点衔接 | named_view_rate（六仪表之一）接线就绪：视图表存在后，B3 metrics.ts 的 null + notes 更新为实算（周人均新建 = created_at 计数/周数）——随本表落地一并交付 | B3 evidence「named_view_rate：P1-10 未实现（无表）」的解除路径 |

## 2. 迁移文件草案（0002_saved_views.sql）

```sql
-- 0002 saved_views（P1-10 命名视图 = 仅查询状态；02 §2.4 + 裁决案 4 附条件）
CREATE TABLE saved_views (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL DEFAULT 'local',
  name       TEXT NOT NULL,
  query_json TEXT NOT NULL,           -- {axes:{genre,release_year,listened_period,favorite,tag,color}, q}（02 §2.4）
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_saved_views_user_name ON saved_views (user_id, name);   -- 防重名（Q3 补约束）
CREATE INDEX idx_saved_views_user_created ON saved_views (user_id, created_at DESC);
```

## 3. G1–G4 核对（批准后执行口径）

| 护栏 | 核对 |
|---|---|
| G1 | 纯 SQL + hono/html，零新增依赖 ✓ |
| G2 | listSavedViews LIMIT 100（个人规模）；无 base64/整读 ✓ |
| G3 | **见 §4——需先外拆 echoToday 腾余量**（IM-10a 先例，零行为变更） |
| G4 | 实现后 npm run check 全绿（预估测试 +8：list/create/delete/重名 409/422/恢复 303 展开/渲染/埋点接线） |

## 4. ⚠️ G3 停止线预案（实施前必做）

W9 批 P1-6 落地后 dao.ts 实测 **199 行**（贴线，余量 0）。saved_views 三委托 ≈ +4 行 → **必超 200**。
预案（与 B1 案 B 变体 / IM-10a 同款，零行为变更）：

1. `echoToday` 方法体（4 行）+ `SQL_ECHO` 外拆为 `db/echo.ts` 域文件（dao 一行箭头委托，净 -3 行）；
2. 外拆后 dao.ts ≈ 196 行，+3~4 委托后 ≈ **199–200**——若仍贴线，`existingSourceIds`/`getAlbum` 的分块循环（~24 行）外拆 `db/lookups.ts`（机械搬移，先例同款）再核。

实施时以当日 wc -l 为准；**若两步外拆后仍 < 200 不可达 → 回报用户再裁决**（停止线不静默闯过）。

## 5. 本次明确不做

- 不做视图改名 / 共享 / 排序（PRD 只要求命名/恢复/删除）；
- 不做「视图内打乱」「Era 语言」（观察池信号项，等 named_view_rate 数据）；
- 不动 0001 迁移与现有四表；
- Topster 策展模型（W10-12）另表另案。

---
*产出：W7-9-1 会话 · 2026-11-14 · 等待用户裁决后执行；裁决结果与本表落地状态登记于看板 W7-9-1 卡 evidence*
