# 评审案 · Topster v1 + topster_views 策展模型（W10 批，W10-12-1 #1）

> 卡 = W10-12-1（Topster → 发布 → 决策门）W10 批。规格事实源：
> 02-变现文档包 03-路线图B §W10（案 2 底线：**topster_views 与首版同期生效**——副标题+顺序可保存；禁自由画布）
> · 01-PRD §4 方案 B 调整 1（Topster = Collection 一种 View，禁第二套数据）
> · 02-数据模型与API设计 §6 预留位原形（`topster_views(id, user_id, title/subtitle, item_order JSON, created_at)`）
> · 产品理念终稿（策展仅限顺序+副标题；Topster 持久化自由画布/布局状态入不做清单铁律）。
> 先例：0002_saved_views.sql + db/savedviews.ts + routes/views.ts（W7-9-1 用户批准件）。

## 1. 裁决清单（Q1–Q8，全按建议值实施，待用户追认）

### Q1 表结构 —— 02 §6 原形 5 字段照抄，零加项

```sql
CREATE TABLE topster_views (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL DEFAULT 'local',
  title      TEXT NOT NULL,              -- 主标题（必填，≤80 字符，写路径校验）
  subtitle   TEXT,                       -- 副标题一句话（可选，≤120 字符；案 2 底线「副标题」）
  item_order TEXT NOT NULL DEFAULT '[]', -- JSON 数组 [record_id,...]；顺序即叙事（案 2 底线「顺序可保存」）
  created_at TEXT NOT NULL
);
CREATE INDEX idx_topster_views_user_created ON topster_views (user_id, created_at DESC);
```

- 与 02 §6 预留位声明逐字段一致（title/subtitle 拆为两列 = 声明原文的斜杠列举）。
- 不加 updated_at / 布局 / 位置字段：禁自由画布 = 禁多余状态（终稿不做清单铁律）。
- 不加 UNIQUE(user_id,title)：Topster 允许重名（"2026 年度 Top" 年年都有），视图 name 才需要防重。

### Q2 迁移 —— `db/migrations/0004_topster_views.sql`（0003 已被 B5 占用，顺延）

纯新表 DDL + 1 索引。**migrate.ts 零改动**：迁移执行器自动扫描 `db/migrations/`（正则 + sort +
user_version，已核实 migrate.ts:15-49），0001/0002/0003 历史迁移只追加不改动（冻结纪律）。
B5 的 migrate.ts 表重建改动（FK=OFF 窗口）与本迁移零交互（新表无 FK）。

### Q3 查询形状 —— 域文件直连，DAO 零改动（G3 余量 22 不动）

新域文件 `src/server/db/topster.ts`（savedviews.ts/lookups.ts 先例同款，直连 `st`/`db`）：

- `listTopsters(st, userId)` — `SELECT id,title,subtitle,item_order,created_at … WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 100`（savedviews SQL_LIST 同形）
- `getTopster(st, id, userId)` — 单个；不存在 → undefined（页面 404）
- `createTopster(db, st, input, userId)` — 校验后 INSERT；返回 {id}
- `updateTopsterMeta(st, id, title, subtitle, userId)` — 改名/副标题
- `deleteTopster(st, id, userId)` — changes=0 → NotFoundError（/views/delete 幂等先例外显 404 语义由路由吞为 303 静默）
- `topsterItems(st, recordIds, userId)` — 成员取数：`SELECT {LIST_COLS} FROM collection_record r JOIN album_metadata m ON m.id=r.album_id WHERE r.user_id=? AND r.id IN (…)`（分块 100，lookups 先例）→ **JS 端按 item_order 重排**（顺序存在策展表，不在 SQL 排序键里——策展顺序是用户事实不是元数据事实）；JOIN 不到的 id（记录已删）渲染时跳过并如实计数（Q7）
- SQL 常量进 `db/queries.ts`（SQL_TOPSTER_LIST/SQL_TOPSTER_BY_ID/SQL_TOPSTER_ITEMS）——queries.ts 是共享 SQL 常量文件（B1/B2/B3 先例），追加 3 条非独占改动，提交披露

**dao.ts 一行不动**：域文件先例 = associations/taggov/metrics/echo/lookups/savedviews（G3 实测 178 行，余量 22 全保留）。

### Q4 容量与校验 —— Topster ≤ 60 张（对齐内存纪律① LIMIT≤60，零豁免）

- v1 容量上限 **60**：一次取数一页拿完，不碰 LIMIT≤60 纪律、不引入分页（导出图一屏构图也以 ≤60 为合理上界：3×3/4×4/Top25/Top50 全覆盖）。
- 写路径校验：recordIds 全部属于本 user（复用成员判定查询）+ 数组去重 + ≤60；title 必填非空 ≤80、subtitle ≤120、item_order 必须可解析为 JSON 字符串数组。
- 坏 JSON / 越权 id / 超容量 → 422 envelope（字段级，routes/views 422 先例）。

### Q5 路由 —— 无 JS 基线（全部 POST + 303，挂 pagesRoutes = /views /metrics 先例）

| 端点 | 方法 | 行为 |
|---|---|---|
| `/topsters` | GET | 策展列表页：每项 标题+副标题+张数+创建日期+查看链接+删除 form；页顶新建 form（title+subtitle） |
| `/topsters` | POST | 创建（303 → `/topsters/:id`） |
| `/topsters/:id` | GET | 策展页：①按序网格（cover-first，复用 coverCard）②成员编辑区（每行 ↑/↓/移除 form）③添加成员区（`?add_q=` 搜索表单 GET + 每候选「加入」按钮 POST）④改名/副标题 form |
| `/topsters/:id/update` | POST | 改 title/subtitle → 303 回策展页 |
| `/topsters/:id/members` | POST | 添加成员（record_id 校验属本档+未在列+容量）→ 尾部追加 → 303 |
| `/topsters/:id/move` | POST | record_id + dir=up\|down → 顺序交换 → 303 |
| `/topsters/:id/remove` | POST | record_id 移出 → 303 |
| `/topsters/delete` | POST | 幂等删除 → 303 `/topsters`（/views/delete 先例） |

- CSRF：POST 全走 sameOrigin（views/metrics 同款）；未登录 302 由既有 installAuth 守卫。
- 顺序编辑无 JS 形态 = ↑↓ 按钮（经典 form 重排，零拖拽零 JS——自由画布的替代面是「顺序即叙事」本身）。

### Q6 渲染 —— 新 `pages/topster.ts` + pages.ts 接线（披露件，B1/W8 先例）

- `renderTopsterList` / `renderTopsterDetail` 新文件（pages/metrics.ts 先例：渲染函数独立成文件，路由接线在 routes/pages.ts 加端点——pages.ts 为共享接线文件，按先例提交说明披露）。
- 网格复用 html.ts 现有 coverCard/coverWall；**零新增 CSS**（复用 .wall/.card 网格类 + 内联微样式，IM-14 预算观察项不加新规则）。
- 详情页联动（详情页加「加入 Topster」form）**不在 v1**：加成员统一在策展页内搜索加入（零跨页接线，pages.ts 改动面最小）。登记观察项：若使用信号显示用户想从详情页直加，随 B4 路径再议。

### Q7 「Collection 一种 View」的落实（禁第二套数据）

- item_order 只存 `collection_record.id` **引用**，不复制任何专辑/记录数据（PRD §4 调整 1 红线）。
- 成员渲染实时 JOIN：档案内记录改名/加 tag/收藏变化自动反映（View 语义）。
- 记录删除后：渲染跳过缺失 id，页头如实显示「档案内 N 张 / 策展清单 M 处引用已失效」（诚实占位，不静默伪造满格）。

### Q8 月成本 ≈0 架构核对（04B §3，W10 门禁）

`docs/cost-audit.md` 产出：逐项核对 04B §3 五决策（静态托管 / 元数据零成本 / 封面本地缓存 /
无付费基础设施 / 统计自托管）在当前架构的落实形态 + 实测口径（本机单进程 + SQLite + 本地封面 =
零云成本；元数据源全部免费层）。预算结论 < $5/月 = 实际 $0，无超线项（超线项清单为空即明示）。

## 2. 实现决策（R1–R4）

- **R1** 迁移号 0004（0003 被 B5 占用）；若 B5 的 0003 在本卡实现窗口仍未提交，0004 文件独立成行互不依赖（迁移按文件名排序执行，二者无顺序耦合——0004 不引用 0003 的任何对象）。
- **R2** item_order 读写每次 JSON.parse/stringify，≤60 元素，内存有界；写回走 prepared statement（StmtCache 先例）。
- **R3** 上移/下移/移除/添加都是「读 item_order → JS 数组操作 → 写回」的最小事务语义（单语句 UPDATE，无多语句事务需求）。
- **R4** 导出（W11 批）：`GET /topsters/:id/export.svg` 纯文本零依赖（依赖三问评审案随本批一并送审，见 §3）。

## 3. 随批送审 · W11 导出格式依赖三问（ADR-004 口径）

**三问**：①是否真需要？——是（案 2：「分享到社交平台的是作品图，不是产品」，零成本自传播主引擎）。②现有依赖能否实现？——**能**：SVG = 纯文本模板字符串（hono/html 同族 escape 纪律），零新包。③若新增，最小代价？——位图转换（sharp/canvas 原生 or jpeg-js 提升进 dependencies）都将推高运行时依赖 2→3，**必须用户追认且 G1 护栏变动**。

| 案 | 形态 | 依赖 | 红线核对 | 建议 |
|---|---|---|---|---|
| A | 服务端 SVG（`export.svg`，网格 + 标题/副标题 + 「made with Musicgraphy」署名内嵌） | **0 新增** | G1 ✓ / 禁 base64 ✓（封面以 `/covers/…` URL 引用，不内嵌像素）/ 无 JS ✓ | **首选** |
| B | 服务端位图（jpeg-js 升 dependencies 或 sharp） | 2→3 | G1 超线须追认；平台接受度高 | v1 不做，登记再议路径 |
| C | 浏览器海报页（`/topsters/:id/poster` cover-first 大网格 + 署名页脚，用户截图/系统打印成图） | 0 | 全绿 | 与 A 并行交付（补位：主流社交平台不接受 SVG 上传、外链封面在部分查看器不加载——诚实披露 A 的边界，C 提供「截图即成图」的现实分享路径） |

**建议 = A + C 组合（零新依赖）**；B 登记观察池（若 SVG 分享转化信号出现再议，届时走用户追认）。

## 4. 护栏核对

| 护栏 | 结论 |
|---|---|
| G1 运行时依赖 ≤2 | 零新包（SVG=模板字符串；导出与渲染同栈） |
| G2 RSS <100MB | 单次渲染 ≤60 张封面 URL 引用 + item_order ≤60 JSON，内存有界 |
| G3 DAO <200 行 | **dao.ts 零改动**（178 行不变，余量 22 全保留）；域文件 topster.ts 独立计数 |
| G4 npm run check | 收口前全绿（tsc/eslint/vite build/node:test） |
| 三不动 | index.ts/app.ts 挂载结构不动（Topster 路由挂 pagesRoutes 子应用内，app.ts 零改动）；db.ts PRAGMA 不动；遗留仓契约不动 |
| 无 JS 基线 | 全部交互 = `<a>` / GET form / POST+303，零新岛屿 |
| 禁自由画布 | 表结构无布局/位置字段；策展仅顺序+副标题 |

## 5. 测试计划（tests/topster.smoke.test.ts，预估 +10）

1. 创建：合法 / title 空白 422 / 越权 record_id 422 / 容量 >60 422
2. 成员：加入尾部 / 重复加入 422 / 移除 / move up·down 顺序断言
3. 渲染：列表页项数与序 / 策展页按 item_order 序渲染网格 + 副标题在场
4. 失效引用：删除成员记录后渲染跳过 + 失效计数如实显示
5. 删除：幂等（二次删除仍 303）
6. 守卫：未登录 302 / POST 无 CSRF 头 403
7. 门禁：dao.ts 行数断言不变（178）随卡 evidence 实测登记
