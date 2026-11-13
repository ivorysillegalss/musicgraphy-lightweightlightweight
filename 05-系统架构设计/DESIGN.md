---
slug: musicgraphy-2.0-platform
title: Musicgraphy 2.0 平台架构（自底向上：存储优先、轻依赖、内存友好）
status: decided
decided: C1-node-sqlite-hono-ssr-islands
mode: greenfield
date: 2026-11-10
---

# DESIGN · Musicgraphy 2.0 平台架构

> 按 system-design skill 流程执行（Step 0 规模判定 → Step 4 envelope → Step 5 数据模型 → Step 6 候选 → Step 7 裁决 → Step 9 产物）。报告未渲染（本机无 python，按 skill 规则记录）；本文件 + design.json 为本次运行产物，用户侧 ADR 见《变现文档包/07-系统架构与选型ADR.md》。
> 2026-11-11 存储层技术评审（见同目录《存储层技术评审报告.md》）：**架构维持不变**；DD4 备份触发机制、§5 mmap_size、envelope 推导已按 R1/R2/R7 修订。
> 2026-11-11 五维复审（存储/运行时/前端/API/运维五路子评审合成）：**架构维持不变**；Node 24→26（V6）· 运行时依赖=2 补 @hono/node-server（V5）· 限流重设计（V2）· 无 JS 基线与片段替换规格（V4）· hono/html 替代自写助手（V9）· 鉴权与 cursor 规格（V10/V11）· 运行环境节（V8）· offsite 备份与按天去重（V3/V14）· RSS 基线修正（V13）· C2 表述统一（V7）· htmx 钉 2.x（V15）· dev server 形态（V16）。

## 0. 规模判定（Step 0）

用户四条硬需求（不搞重 / 依赖最少 / SQLite 级中间件 / 内存友好）+ envelope 数字**预先关闭**了大部分选择：Postgres、Redis、Elasticsearch、消息队列、微服务、重型 ORM 全部一行否决（依据：DB 18.3MB、单用户写并发 1、LIKE 全扫 <5ms、AGENTS.md §11）。剩余真正 load-bearing 的轴只有一条：**运行时形态与呈现架构**——在此轴上取 3 个候选（skill 上限）。

## 1. Envelope（算术已验证 · PowerShell）

| 项 | 值 | 推导 |
|---|---|---|
| DB 体积（含索引） | **18.3 MB** | 5000 × 2.5KB × 1.5 |
| DB 体积（10 年后） | **36.6 MB** | 保守 2× 上界（按 1.4 张/周 实算 ≈21MB——评审 R7 修正推导） |
| Note 全文扫描量 | **1,500 KB** | LIKE 全扫 <5ms → 搜索引擎关闭 |
| 首屏流量 | **2.34 MB**（封面 immutable 缓存后 ≈0） | 60 封面 ×40KB + 文档 |
| 服务端每页查询 | **6 条**（1 页 + 5 轴计数），索引轴各 <1ms | genre 轴经 json_each 不可索引（预期 <10ms）——原"全走索引"表述过强（复审注） |
| 写并发 | **1**（单用户） | SQLite WAL 单写者 + Node 单线程 = 零锁竞争、零连接池 |
| RSS 预算 | **目标 <100MB / 告警 150MB** | 分解：page cache 8 + 应用堆 ~15 + Node 空载基线——社区实测区间 50–120MB，原 ~45MB 偏乐观，目标须以 D2 在目标 OS 实测背书（复审 V13）；启动参数 `--max-old-space-size=64`（堆硬上限防失控）；告警发出方 = 进程定时读 `process.memoryUsage().rss` 写日志、越界 WARN，由守护承接 |

## 2. 不变量与失败模式

| 不变量 | 执行权威 |
|---|---|
| I1 一专辑一记录 | `UNIQUE(user_id, album_id)` 物理约束 |
| I2 用户数据不被同步覆盖 | 元数据/用户数据物理分表，同步只写 album_metadata |
| I3 记录 ≤3 步/15s | 确认层默认即完成态（FR-6 验收） |
| I4 导出可重建档案 | 单文件库 → JSON 投影；永久免费 |
| I5 无打扰 | 架构中不存在通知子系统（无法被滥用） |

失败模式：F1 元数据源失效→本地快照兜底；F2 node:sqlite API 演进中（现为 1.2 RC、无需 flag，但处于 DatabaseSync/StatementSync → Database/Statement 类改名期）→DAO 隔离 + C2 一日回退；F3 封面防盗链→落盘缓存；F4 LIKE 远期退化→FTS5 measured 升级；F5 内存膨胀→五条纪律。

## 3. 候选与裁决（Step 6-7）

| | C1（推荐） | C2（F2 回退，复审 V7 统一表述） | C3（不选） |
|---|---|---|---|
| 形态 | Node 26 单进程 + node:sqlite + Hono + **SSR HTML + 原生 TS 岛屿** | Node 26 + better-sqlite3 + Hono + SSR——**仅换 DAO 驱动，前端与架构其余不变**（原"Preact SPA"为早期候选残留，删除） | Cloudflare Workers + D1 |
| 运行时依赖 | **2**（hono + @hono/node-server，复审 V5） | **3**（+ better-sqlite3 原生编译件） | 1 + 平台绑定 |
| 内存 | **最小**（无 VDOM/无 hydration） | 与 C1 相当（+原生驱动开销） | 平台接管 |
| 四条硬需求 | 全满足 | ②输（多 1 个原生依赖） | ③被平台替换 |

**推荐证据链**：需求② C1 运行时依赖=2（hono + @hono/node-server，已达预算上限内的最少配置）；需求④ C1 无前端运行时（RSS 预算最易达成）；需求③ node:sqlite 即 SQLite 本体零封装；需求① 单进程 + 单文件部署。I1–I5 三者中性。C1 唯一弱点 F2 由 DAO 隔离缓解，**可证伪点唯一**：D2 spike。C2 回退语义 = 只换 DAO 驱动文件，一日内完成（复审 V7：原 C2 列"Preact SPA"与"只换一个文件"矛盾，已统一）。
**一行否决**：Next.js（依赖树）、Prisma/重型 ORM、Postgres/Redis/ES/MQ/微服务（envelope + §11）、Electron（越界）。

## 4. Deep Dives

- **DD1 存储驱动（复审 V6 更新）**：node:sqlite 主选（**Node 26 LTS**——24 已于 2026-10 进 Maintenance、26 为 Active LTS 至约 2029-04；node:sqlite 稳定性 1.2 RC、无需 flag，模块级 `sqlite.backup()` 已内置）；better-sqlite3 为回退——同步 API 约八成同形（多 `.transaction()`/`.pragma()`，DAO 8 个方法隔离全部差异），回退 = 换一个文件；better-sqlite3 对 Node 26 的 prebuilt 覆盖列入 D2 验证。
- **DD2 内存纪律（F5）**：①列表强制 LIMIT 60 分页（禁全表载入）②封面流式响应（禁读入内存）③禁 base64 内嵌 ④prepared statements 进程级缓存（一次解析）⑤无 hydration（SSR 直出）。
- **DD3 交互形态（复审 V4/V9/V15/V16 重写）**：**URL 即状态**——筛选条件全在 query string（可分享/可回退/零内存状态）。**无 JS 基线（P0）**：chips 渲染为 `<a href="?genre=…">`、搜索为原生 GET form、添加为原生 `<form POST>` + 303 回网格——JS 岛屿仅做增强，I3「≤3 步/15s」验收不得押在 JS 正确性上（FR-1 粘贴识别/自动补全为纯增强层）。chips 联动 = fetch HTML 片段替换，必须包含：AbortController（快速连续筛选的 latest-wins 竞态防护）、pushState+popstate 回退、错误态注入旧片段保留、swap 后事件委托到 document——合计约 100–200 行（原"<60 行"为低估）。HTML 生成用 **hono 内置 hono/html**（自动转义 + raw() 逃生口），不自写助手；上下文纪律：禁 raw() 插用户数据、禁 style/script 上下文插值（script 内 JSON.stringify + `<`→`\u003c`）、URL 插值仅 http(s)/相对路径白名单。htmx 为授权升级件：钉 **2.x** 稳定线，触发条件 = 局部刷新形态增多（非岛屿数），引入即整体替换自写 swap。dev server = @hono/vite-dev-server（devDependency）或 tsx watch + 手动刷新。
- **DD4 备份/恢复（authoritative store 的 RPO/RTO，评审 R1 修订 + 复审 V3/V14 补强）**：SQLite 文件 = 唯一事实源；备份触发 = **启动时 + 每日定时**（长驻进程仅靠启动备份会使 RPO=24h 不成立）→ `data/backups/` 文件名 `musicgraphy-YYYYMMDD.db`、**按天去重**（当日已存在则跳过）、**保留最近 7 天**；机制 = `VACUUM INTO`（同步、产出紧凑快照）为主；node:sqlite 自 v22.16.0/v23.8.0 起已内置模块级 `sqlite.backup()`（返回 Promise，复审核实——D2 只做二选一实测）；**WAL 活动期间禁止直接复制 .db 文件**（-wal 未并回会丢最近提交）；RTO<1h（重部署 + 还原单文件）。**offsite（P0，复审 V3）**：同盘 7 份防误删不防硬件故障——备份目录必须纳入用户网盘/同步范围，或启用 04A 云备份 Pro 推对象存储；10 年档案资产定位下 offsite 不是可选项；JSON 导出不含封面文件（评审 R6），只能作最后兜底、不能充当 RPO 手段。**恢复清单（复审 V8）**：装 Node 26 → 还原备份 .db → 启动 → 抽查记录 → 导出 JSON 校验；Node 大版本升级前演练一次。

## 5. 数据模型物理层（Step 5 增补）

逻辑模型沿用 02 文档（引擎无关）；SQLite 物理化：`journal_mode=WAL`（持久）/ `synchronous=NORMAL` / `cache_size=-8000`（8MB）/ `foreign_keys=ON` / `busy_timeout=5000`（后四者 per-connection，DAO 打开例程统一执行）；**`mmap_size` 已按评审 R2 移除**（库 ≤36.6MB 小于窗口无收益，且 Windows 工作集计入映射页、威胁 RSS<100MB 预算）；迁移 = `db/migrations/00NN_*.sql` + `PRAGMA user_version`；单连接同步 API，无池。

## 6. API v1.1 修订（api-design skill 校准 02 文档）

`/api/v1/` 前缀 · POST 成功 201+Location · 重复 409(code=duplicate_record) · 校验失败 422 字段级 details · Grid 分页 = cursor：**复合键 `[sort_value, id]` 的不透明 base64(JSON) + SQLite row-value 比较**（Release Year/Artist/Title 非唯一键必须 tiebreaker），sort 变更即作废，`meta.has_next` 放值、`links.next` 放下一页 URL（复审 V11）· 元数据代理限流 = **全局串行队列（相邻上游请求 ≥1s 间隔）+ 全局 30/min + 429 + Retry-After + 显式 User-Agent**（`Musicgraphy/<ver> (+contact)`）——MusicBrainz 官方政策为平均 1 req/s，固定窗口 30/min 允许 2 秒内 30 连发必打穿；per-IP 在单机部署后即自伤，弃用（复审 V2）；iTunes 源单独 20/min · 错误 envelope `{error:{code,message,details?}}` · 单用户访问密钥鉴权（无公开 API）：无 cookie → 302 密钥表单页，`crypto.timingSafeEqual` 校验，HttpOnly+SameSite=Lax+Secure 签名 cookie，CSRF = SameSite=Lax + 校验 Origin/Sec-Fetch-Site 头（约 10 行），导出脚本走 `Authorization: Bearer` 备用通道（复审 V10）。

## 7. Checks 与限制（诚实记录）

- 算术：PowerShell 验证 ✓（node/python 本机缺失）
- 结构校验：未运行（捆绑 runtime 为 python）
- HTML 报告：**未渲染**（python 缺失，按 skill 错误表记录为 unfinished-render）
- node:sqlite spike：**待 D2 实测**——本设计唯一可证伪点（验证项：`backup()` vs `VACUUM INTO` 二选一实测（含 WAL 活动期）/ per-connection PRAGMA 执行方式 / json_each / 迁移执行器（DDL 事务包裹、journal_mode 事务外）/ DAO 8 方法同形度 / **锁定 Node 26 minor 版本的 Database/Statement 类名与 options**——类正处 DatabaseSync/StatementSync 改名期；见评审报告 §6 + 复审更新）
- 假设：用户量=1；MusicBrainz 可用（D2 验证）

## 8. 部署拓扑

```
[Node 26 单进程: hono + @hono/node-server + node:sqlite]
 ├─ /static      ← vite build 产物（immutable）
 ├─ /covers/*    ← data/covers/ 磁盘缓存（流式 + immutable，有界 ≈200MB 上界，首次访问懒下载）
 └─ /data/musicgraphy.db（WAL）+ /data/backups/（按天去重 7 天 + offsite 必备）
```

**运行环境（复审 V8 新增，原拓扑节缺失）**：进程守护 = OS 原生（Linux systemd `Restart=on-failure` / Windows WinSW 或计划任务；**禁 PM2**——PM2 自身约 +50MB，会击穿 RSS<100MB 预算）；TLS = 反向代理终结（Caddy/Nginx），或仅绑 127.0.0.1 + 访问密钥；部署目标 OS 于 D1 定死（本文档产自 Windows，路线图步骤按目标 OS 落笔）；日志 = stdout → 文件轮转（含 node:sqlite 错误）；`uncaughtException` 记日志后 exit(1) 交守护重启（WAL + synchronous=NORMAL 下应用崩溃不丢数据，评审 R8）。启动参数：`--max-old-space-size=64`（复审 V13）。
