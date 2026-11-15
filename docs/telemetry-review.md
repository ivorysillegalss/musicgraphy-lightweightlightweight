# 评审案 · W8-9 行为埋点立项（PRD §6 行为类四仪表的数据源）

> 状态：**用户 2026-11-15 执行令批准立项**（「执行 W8-9 行为埋点立项——四个仪表现为 null，勿伪造」），
> 本评审案 = 立项事实源；Q1–Q5 按建议值执行（B4/B5/B7 追认令先例）。实现登记 = IM-28。
> 上游口径：PRD §6 观察池埋点表 · 02 §4 metrics 行（{data}、匿名化、可关闭）· 04B §3
> （自托管匿名计数、可关闭，不用付费分析栈）· B3 实现记录（IM-21；行为类四项 null + notes 逐项缺源说明）。

## 1. 背景

B3 落地 `/api/v1/metrics/coverage` 时，行为类四仪表（search_fail_rate / echo_ctr /
note_revisit_rate / export_usage）因「无数据源」如实返回 null（勿伪造数字是硬纪律）。
coverage（北极星）与 named_view_rate 已实算；呈现级开关（cookie `mg_metrics`，92 天季度级）
已随 W8 到位。本评审案补齐四仪表的数据源：**本地匿名聚合计数，零外发、零新依赖**。

## 2. 现状核实

- `db/metrics.ts`：四项硬编码 null + notes 说明「埋点属 W8-9 行为层」。
- 现有表（album_metadata / collection_record / record_tag / saved_views / topster_views /
  tags）均为事实数据表，不承载「曝光-点击-会话」级行为计数。
- `mg_metrics` cookie：`closed` = 呈现关闭（pages.ts toggle）；无 cookie = 开。

## 3. 逐仪表本地口径（PRD §6 定义 → 可实现定义）

| 仪表 | PRD §6 定义 | 本地实现口径 |
|---|---|---|
| 搜索失败率 | 无结果搜索会话占比 | 分母 = 实际执行的搜索会话（`GET /api/v1/search/albums`，q≥2）；分子 = 零结果 **或** 上游不可用（502）；**429/422 不计**（搜索未发生）。窗口 = 近 28 天 |
| 回响卡片点击率 | 卡片曝光→点击 | 分母 = 首页 `GET /` 渲染且 echoCard 实际渲染（echoToday 命中）；分子 = 详情页带 `?from=echo` 归因（href 加 query，**不加跳步**——P1-1「单入口 ≤1 步」不破坏）。CTR = click/shown |
| 「为什么」回访率 | 详情页个人区回访占比 | 分母 = 详情页 `GET /album/:id` 渲染数；分子 = 其中 note 非空 **且** added_at 早于今日（排除添加当日 = 回访语义；day 粒度本地时区）。API `GET /records/:id` 不计（呈现层口径，见 Q4） |
| 导出使用率 | 导出会话占比 | 本地单用户无「会话」概念的诚实代理 = **近 28 天有导出行为的天数 / 有效天数**；有效天数 = min(28, 自首记录 added_at 起含首尾天数)；档案空（无记录）→ null |

## 4. 方案（R1–R5）

- **R1 天粒度计数表**：`0005_telemetry.sql` 新表 `telemetry_days`（PK = 本地日 YYYY-MM-DD，
  7 列计数 + updated_at）。**不是事件表**——「收听史事件表」在不做清单（PRD §8），本表只存
  日聚合列、零个人维度、零事件明细，与不做清单不冲突（Q2）。
- **R2 域文件直连**：`db/telemetry.ts` 自建 StmtCache（savedviews/lookups 直连先例），
  **dao.ts 零改动**（G3 = 192 行不动）。写入 = 单行 upsert（`ON CONFLICT(day) DO UPDATE
  SET col = col + 1`，列名取自代码内白名单常量，无注入面）。
- **R3 注入式接线**：`createTelemetry(db)` 在 server.ts 建共享实例，经 `AppOptions.telemetry`
  转发到 export / metadata / pages 三路由工厂（**B4 cover.gate 注入先例**；app.ts 挂载行
  改动披露）。读侧 metrics.ts 经 `windowSums(st, startDay)` 复用同一域。
- **R4 可关闭 = opt-out 停记**（Q3）：`mg_metrics=closed` 时埋点方法直接返回（不记录）；
  无 cookie = 记录。与呈现开关同一枚 cookie 同一语义——「关闭」同时停呈现与停记录，
  数据全部本地派生无外发，不存在关闭前的外泄面。
- **R5 best-effort**：埋点写入 try/catch，失败仅 debug 日志，**绝不阻塞主功能**
  （仪表是馈赠不是依赖；P1-1 馈赠语义同款）。

## 5. 红线核对

| 护栏 | 结论 |
|---|---|
| G1 运行时依赖 ≤2 | 零新包（hono/cookie 类型 + node:sqlite 已有）✓ |
| G3 DAO <200 行 | dao.ts 零改动（192 不变；域文件 + 直连先例）✓ |
| G2 RSS <100MB | 表 = 每天 ≤1 行、7 个整数列；查询固定 LIMIT 窗口 28 行；无常驻内存结构 ✓ |
| 匿名化（02 §4） | 仅聚合计数、无个人标识符、无 IP/UA/会话维度 ✓ |
| 无外发 | 计数只进本地 SQLite；无任何上报通道 ✓ |
| 无 JS 基线 | 归因 = URL query；曝光/视图 = SSR 路由内服务端计数；零前端改动（仅 echoCard href 加 query）✓ |
| 三不动 | index.ts / dao/interface.ts / PRAGMA 基线零触碰；app.ts 挂载行转发 = 披露件（B2/B3/B4 先例）✓ |
| 不做清单 | 天粒度聚合计数 ≠ 收听史事件表（无事件明细、无个人维度）✓ |

## 6. 待裁决 Q1–Q5（全按建议值执行）

- **Q1** 行为四仪表窗口 = **近 28 天**（4 周，对齐 04B T1–T5 决策窗）；coverage /
  named_view_rate 维持全量口径不变。
  - Q1a 搜索失败率不含 429/422（搜索未发生）。
  - Q1b echo 点击归因 = `?from=echo`（retention-w7 href 断言同步升级口径）。
  - Q1c 回访分子排除添加当日（day 粒度）。
  - Q1d export_usage 分母 = min(28, 档案年龄天数)；档案空 → null。
- **Q2** 存储 = 天粒度计数表 `telemetry_days`（非事件表；不做清单不冲突）。
- **Q3** 可关闭 = opt-out（`mg_metrics=closed` 停记；无 cookie = 记）。
- **Q4** 计数范围 = 呈现层页面（/ / /album/:id）+ 搜索/导出 API；API 详情（GET
  /records/:id）不计（呈现层口径，外部工具调用不混入行为仪表）。
- **Q5** notes 语义升级 = null 字段给「无样本 + 口径 + 埋点起点」说明（实算后条目移除）；
  types.ts 注释同步。

## 7. 测试与验收

`tests/telemetry.smoke.test.ts`（零网络）：0005 表在档（不硬编码 user_version——
netease.smoke 教训）/ 同日累加 + 跨日分行（nowFn 假时钟）/ opt-out 停记 / 搜索零结果
计数（空源链）/ 导出计数 + export_usage 实算 / 详情视图 + 回访排除添加当日 + ?from=echo
归因 / 曝光→CTR 实算 / 窗口排除。`tests/metrics.smoke.test.ts` 口径升级：notes 断言
从「W8-9 缺源」改为「无样本说明」。
