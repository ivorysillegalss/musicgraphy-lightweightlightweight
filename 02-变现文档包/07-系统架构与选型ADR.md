# 07 · 系统架构与选型 ADR（自底向上）

> 按 `system-design` skill（v1.4.0）流程执行 · greenfield 模式 · slug: `musicgraphy-2.0-platform`
> 完整过程产物：`docs/design/musicgraphy-2.0-platform/design.json` + `DESIGN.md`（HTML 报告因本机无 python 未渲染，按 skill 规则记录）
> 决策输入：用户四条硬需求——①不搞重 ②依赖最少 ③SQLite 级轻量中间件 ④内存友好；自底向上推演
> 上下游：01-PRD（验收口径）/ 02-数据模型（逻辑层不变）/ 03-路线图B / AGENTS.md §11/§14
> 2026-11-11 存储层技术评审：结论 = **架构不变**；ADR-001/006 已按评审 R1/R2/R7/R8 修订（报告见 `05-系统架构设计/存储层技术评审报告.md`）
> 2026-11-11 五维复审（存储/运行时/前端/API/运维五路子评审合成）：结论 = **架构不变**；Node 24→26（V6）· 运行时依赖=2 补 @hono/node-server（V5）· 限流重设计（V2）· 无 JS 基线（V4）· hono/html 替代自写助手（V9）· 鉴权/cursor 规格（V10/V11）· 运行环境节 + offsite（V3/V8）· RSS 基线修正（V13）· 备份按天去重（V14）等已修订，行内标注"复审 Vnn"

---

## ADR-001 · 存储引擎：SQLite 本体（node:sqlite），零封装零服务

**决策**：SQLite 作为唯一存储引擎；驱动优先 **Node 26 LTS**（Active LTS 至约 2029-04；24 已于 2026-10 进 Maintenance，复审 V6）内置 `node:sqlite`（0 依赖），`better-sqlite3` 为一日回退路径。

**证据链**（每个数字均已验证）：
- DB 体积 10 年后仅 **36.6MB**（5000 × 2.5KB × 1.5 索引；PowerShell 验证）——距 SQLite 甜区上限差 3 个数量级；
- 写并发 = 1（单用户）→ WAL 单写者 + Node 单线程 = **零锁竞争、零连接池、零并发调优**；
- Note 全文扫描 1.5MB → LIKE 全扫 <5ms → **搜索引擎被 envelope 关闭**；
- 备份 = 单文件快照（`VACUUM INTO` 为主；node:sqlite 自 v22.16.0/v23.8.0 起亦内置模块级 `sqlite.backup()`——复审核实；**WAL 活动期禁止直接复制 .db 文件**——`-wal` 未并回会丢最近提交，评审 R1）；迁移 = SQL 文件 + `PRAGMA user_version`。

**否决**：Postgres（进程/端口/维护成本，envelope 关闭）· Redis（无可缓存之物——DB 查询已是毫秒级）· Elasticsearch/Meilisearch（同上）· 浏览器 IndexedDB（跨设备与导出主权受损，违背终稿支柱三）。

**失败模式覆盖**：F2（node:sqlite 现为 1.2 RC、无需 flag，但处于 DatabaseSync/StatementSync → Database/Statement 类改名期）→ DAO 单文件隔离，两者同步 API 约八成同形（better-sqlite3 多 `.transaction()`/`.pragma()`，DAO 8 方法抹平），回退 = 换一个文件（复审 V7：**C2 = 仅换驱动，前端与架构其余不变**）；better-sqlite3 对 Node 26 的 prebuilt 覆盖列入 D2；**唯一可证伪点** = D2 spike 实测，证伪即启用 C2。

**PRAGMA 基线**：`journal_mode=WAL`（持久）/ `synchronous=NORMAL` / `cache_size=-8000`（8MB）/ `foreign_keys=ON` / `busy_timeout=5000`（后四项 per-connection，DAO 打开例程统一执行）。`mmap_size` 经评审 R2 **移除**（库 ≤36.6MB 小于窗口无收益；Windows 工作集计入映射页，威胁 RSS<100MB 预算）。崩溃语义（评审 R8）：NORMAL 下应用崩溃不丢数据；OS 断电可能回滚最近提交，由每日备份兜底——如需绝对持久可切 `synchronous=FULL`（单用户写频下成本 ≈0）。

## ADR-002 · 数据访问层：手写 SQL + 类型化 DAO，不用 ORM

**决策**：无 Prisma/Drizzle/TypeORM。一个 <200 行的类型化 DAO 模块，全部查询为 prepared statements（进程级缓存，一次解析）。

**证据链**：02 文档的查询模式仅 6 类（分页页、5 轴计数、LIKE 检索、详情、联想、那年今日）——ORM 的迁移生成/关系映射/查询构建在本项目全部没有第二消费者；依赖②与内存④（ORM 反射与元数据常驻堆）双双受益。类型安全由"SQL → DAO 返回类型"的手写接口层保证。

## ADR-003 · 呈现层：服务端 HTML + 原生 TS 岛屿，不上 SPA 框架

**决策**：Hono 直接输出 HTML，用 **hono 内置 `hono/html`**（自动转义 + raw() 逃生口；不自写助手——复审 V9：自写 80 行需重复解决已转义标记/数组 join/Promise 摊平等边界，违背"能内置不自写"）；交互（添加弹层[原生 `<dialog>`]/筛选舱/搜索框/键盘流）= 4 个原生 TS 岛屿，每个 <150 行；**无 React/Preact、无 VDOM、无 hydration**。

**证据链**：首屏 JS ≤30KB vs SPA 基线 150KB+；常驻内存少 15–25MB（需求④）；构建 = vite 仅做 TS 编译打包；URL 即状态——筛选条件全在 query string，天然可分享/可回退。**无 JS 基线（复审 V4，P0）**：chips=`<a href="?genre=…">`、搜索=原生 GET form、添加=原生 `<form POST>`+303 回网格——JS 岛屿仅做增强，I3「≤3 步/15s」验收不得押在 JS 正确性上（FR-1 粘贴识别/自动补全为纯增强层）。chips 联动 = fetch HTML 片段替换，规格：AbortController 竞态防护 + pushState/popstate 回退 + 错误片段注入 + document 级事件委托，约 100–200 行（原"<60 行"为低估）。**上下文纪律（复审 V9，进代码评审清单）**：禁 raw() 插用户数据；禁 style/script 上下文插值；URL 插值仅 http(s)/相对路径白名单。**授权升级件**：htmx 钉 **2.x** 稳定线（复审 V15），触发条件 = 局部刷新形态增多（非岛屿数），引入即整体替换自写 swap。dev 形态 = @hono/vite-dev-server（devDependency）或 tsx watch + 手动刷新（复审 V16）。

**否决**：Next.js（依赖树庞大，违背需求②）· SPA（内存④ + 复杂度① 双输）· jQuery 类库（原生 API 已足够，多一个依赖毫无收益）。

## ADR-004 · 依赖预算：运行时依赖 ≤ 2

**决策**：生产依赖白名单 = `hono`（路由/HTML 助手，~15KB，0 传递依赖）+ **`@hono/node-server`**（Node 官方适配器——复审 V5：原"运行时依赖=1"计数错误，Hono 在 Node 上必须经它启动）+ 可选 `better-sqlite3`（仅 F2 回退时，触发即 3 个）。**其余一切为零**，内置替代清单（复审 V5 明文固化，防"三问"被逼破）：CSS 手写（landing 已示范）· 图标内联 SVG · 模板用 hono/html · 测试用 node:test（22 起 stable）· 配置用 `--env-file`（24.10 起 stable）· 请求用内置 fetch · 密钥比对用 crypto.timingSafeEqual · 限流自写（<60 行）；无统计 SDK（自托管匿名计数）、无后台任务框架。devDependencies = typescript / vite / tsx + **eslint**（补齐 AGENTS §14 三件套，复审 V5）。

**执行纪律**：任何新依赖必须走"三问"——能用 node 内置吗？能用 <60 行自写吗？它带来几个传递依赖？三问不过 = 不引入。

## ADR-005 · 内存预算：RSS < 100MB（告警 150MB）

**分解（复审 V13 修正）**：SQLite page cache 8MB（PRAGMA 显式封顶）+ 应用堆 ~15MB + Node 空载基线——原 ~45MB 偏乐观，社区实测区间 50–120MB（nodejs/node#52228 等），<100MB 目标须以 **D2 在目标 OS 实测**背书；启动参数 `--max-old-space-size=64`（堆硬上限防失控，非封 RSS）；**告警发出方（原缺失）**：进程定时读 `process.memoryUsage().rss` 写日志、越界 WARN，由守护进程/health 端点承接。
**五条内存纪律（进代码评审清单）**：①列表强制 `LIMIT 60` 分页，禁全表载入；②封面流式响应（`data/covers/` 磁盘缓存 + immutable 头），禁读入内存；③禁 base64 内嵌图片；④prepared statements 进程级缓存；⑤无 hydration（SSR 直出即终态）。

## ADR-006 · 拓扑与运维：单进程、单文件、单机

```
[Node 26 单进程: hono + @hono/node-server + node:sqlite]
 ├─ /static      ← vite 产物（immutable）
 ├─ /covers/*    ← 磁盘缓存目录（流式，有界 ≈200MB，首次访问懒下载）
 └─ /data/musicgraphy.db (WAL) + /data/backups/（按天去重，保留 7 天）
```

RPO=24h（备份触发 = **启动时 + 每日定时**——长驻进程仅靠启动触发不成立，评审 R1；文件名 `musicgraphy-YYYYMMDD.db` **按天去重**、保留最近 7 天，复审 V14；机制 = `VACUUM INTO` / 模块级 `sqlite.backup()` 二选一，D2 实测）；RTO<1h（重部署+还原单文件）；未来 04A 云备份 Pro = 把同一文件定时推对象存储，**架构零改动**。

**offsite（复审 V3，P0）**：同盘备份防误删不防硬件故障——备份目录必须纳入用户网盘/同步范围，或启用 04A 云备份 Pro；10 年档案资产定位下 offsite 不是可选项；JSON 导出不含封面文件（评审 R6），只能作最后兜底、不能充当 RPO 手段。

**运行环境（复审 V8 新增）**：进程守护 = OS 原生（systemd `Restart=on-failure` / Windows WinSW；**禁 PM2**——自身约 +50MB 会击穿内存预算）；TLS = 反代终结（Caddy/Nginx）或仅绑 127.0.0.1 + 访问密钥；部署目标 OS 于 D1 定死；日志 = stdout → 文件轮转（含 node:sqlite 错误）；`uncaughtException` 记日志后 exit(1) 交守护重启（WAL+NORMAL 下应用崩溃不丢数据，评审 R8）。**恢复清单**：装 Node 26 → 还原备份 .db → 启动 → 抽查记录 → 导出 JSON 校验；Node 大版本升级前演练一次。

显式拒绝：负载均衡/多实例/读写分离——单用户产品不需要，AGENTS.md §11"不提前平台化"。

## ADR-007 · API v1.1 修订（api-design skill 校准 02 文档）

1. 全部端点加 **`/api/v1/`** 前缀；
2. `POST /api/v1/records` 成功 → **201 + Location**；重复 → **409** `{error:{code:'duplicate_record',details:{record_id}}}`；
3. 校验失败 → **422** 字段级 details（不是 400/500）；
4. Grid 分页 = **cursor**（`?cursor=&limit=60`）——封面墙是无限滚动，无跳页需求；cursor = 复合键 `[sort_value, id]` 不透明 base64(JSON) + SQLite row-value 比较（Release Year/Artist/Title 非唯一键须 tiebreaker，复审 V11），sort 变更即作废（400 code=cursor_invalid）；`meta.has_next` 放值、`links.next` 放下一页 URL（与条 6 口径统一）；
5. 元数据代理限流（复审 V2 重设计——原 30/min per IP 与上游政策不符）：**全局串行队列（相邻上游请求 ≥1s 间隔）+ 全局 30/min + 429 + Retry-After + 显式 User-Agent `Musicgraphy/<ver> (+contact)`**——MusicBrainz 官方为平均 1 req/s、超速 100% 拒绝，固定窗口必打穿；per-IP 在单机部署后即自伤，弃用；iTunes 单独 20/min；
6. 错误 envelope 统一 `{error:{code,message,details?}}`；成功 `{data}` / 列表 `{data,meta,links}`；
7. 鉴权（复审 V10 补规格）：单用户访问密钥——无 cookie → 302 密钥表单页；`crypto.timingSafeEqual` 比对；HttpOnly+SameSite=Lax+Secure 签名 cookie；CSRF = SameSite=Lax + 校验 Origin/Sec-Fetch-Site；导出脚本走 `Authorization: Bearer` 备用通道；除静态资源与登录页外**无公开端点**。

## 与既有文档的一致性核对

| 文档 | 状态 |
|---|---|
| 02-数据模型 | 逻辑模型**不变**（引擎无关设计生效）；物理层补 PRAGMA/迁移/DAO 见本文；API §4 已按 ADR-007 v1.1 全量同步（复审 V1） |
| 01-PRD | FR-1~FR-6 全部可在 C1 上达成；FR-6 验收口径不变 |
| AGENTS.md §11 | "能普通查询完成的不引入服务"——本文是其严格执行 |
| AGENTS.md §14 | TS + lint + build 三件套保留（vite） |
| 路线图 B | W1–W3 骨架按本文执行；D2 spike = node:sqlite 实测 |

## 遗留风险与限制（诚实记录）

| 项 | 状态 |
|---|---|
| node 本机未安装 | D1 第一项：装 **Node 26 LTS**（复审 V6：24 已进 Maintenance，26 为 Active LTS 至约 2029-04） |
| node:sqlite 稳定性 | 1.2 RC、无需 flag；类改名期（DatabaseSync/StatementSync → Database/Statement，DEP0210/0211）；D2 spike 锁定目标 minor 版本类名；证伪 → better-sqlite3 回退（唯一改动点 = DAO 文件） |
| node:sqlite backup API | **已确认存在**（模块级 `sqlite.backup()`，v22.16.0/v23.8.0 起，复审核实）——D2 与 `VACUUM INTO` 二选一实测即可 |
| better-sqlite3 Node 26 prebuilt | D2 验证（回退路径前提，复审 V6 增补） |
| MusicBrainz 可用性 | D2 spike 验证（全局串行 ≥1s + User-Agent 合规，复审 V2） |
| RSS<100MB 目标 | D2 于目标 OS 实测背书（社区实测区间 50–120MB，复审 V13） |
| HTML 设计报告未渲染 | 本机无 python；design.json/DESIGN.md 已落盘，后续可在装有 python 的环境补渲染 |

## 下一步（对应路线图 B 的 W1）

D1：装 **Node 26 LTS**（复审 V6）→ 工程骨架（单仓：`src/server`（hono+DAO）+ `src/client`（岛屿）+ `db/migrations`）→ 三件套跑通（含 eslint，复审 V5）。
D2–3：node:sqlite + MusicBrainz 双 spike → 定稿或触发 C2 回退。
D3–7：建表（三条数据决定进物理约束）→ 垂直切片「搜索→确认→添加→网格可见」→ FR-6 验收。
