# AGENTS.md（代码库工程约束）

上游：文档包 `04-源文档/AGENTS.md`（§11 优先简单 / §14 工作规则 / §15 完成标准）。
本文件是其在本仓库的落地细则 + 骨架已冻结的决策清单。**修改前必读。**

## 1. 已冻结决策（不得重开；出处 = 文档包 07-ADR / DESIGN.md / 评审 R1–R10 / 复审 V1–V16）

| 项 | 决策 |
|---|---|
| 运行时 | **Node 26 LTS** 单进程（复审 V6/FC3；engines 锁 >=26 <27；类名用 `Database`/`Statement`，DEP0210/0211） |
| 驱动 | `node:sqlite` 主选（spike 八项全 PASS，docs/spike-d2.md）；better-sqlite3 仅 C2 回退（prebuilt 覆盖 26 已验证） |
| 依赖 | 运行时 = **hono + @hono/node-server（=2，复审 V5/FC4）**；内置替代清单：node:test / --env-file / fetch / timingSafeEqual / 自写限流 <60 行 |
| PRAGMA | WAL / NORMAL / -8000 / FK=ON / busy_timeout=5000；无 mmap_size（评审 R2）；通道 = exec 设置 + prepare 读回校验（spike 定案） |
| 连接 | 单连接同步 API，无池；打开例程 = db.ts（全仓唯一） |
| DAO | 手写 SQL，契约 `dao/interface.ts` 冻结（C2 回退只换 `dao/index.ts`，复审 V7）；prepared statements 进程级缓存 |
| 迁移 | `db/migrations/00NN_*.sql` + `user_version`；DDL 包事务、PRAGMA 在事务外；pending 须从版本+1 起连续 |
| 呈现 | SSR 直出（**hono/html，复审 V9**——禁 raw() 插用户数据）+ 原生岛屿，无 hydration；**无 JS 基线**（复审 V4：chips=`<a>`、搜索=GET form、添加=POST+303） |
| API | `/api/v1` 前缀；envelope `{error:{code,message,details?}}`；cursor = 复合键 `[sort_value,id]` base64(JSON)（V11）；limit ≤60 |
| 鉴权 | V10：cookie 会话（HttpOnly+Lax+Secure HMAC 签名）+ 302 表单页 + CSRF Origin 校验 + Bearer 备用通道；/static、/covers 除外 |
| 上游调用 | 复审 V2：全局串行队列 ≥1s + 全局 30/min + 显式 UA；per-IP 弃用；iTunes 20/min |
| 备份 | 启动 + 每日定时（R1/V14：musicgraphy-YYYYMMDD.db 按天去重、留 7 天）；机制 = VACUUM INTO 主（backup() 等价备选）；**WAL 期禁文件复制**；offsite 条款（V3）见 ADR-006 |
| 运行环境 | V8/V13：禁 PM2；uncaughtException → exit(1) 交守护；--max-old-space-size=64；RSS 看门狗已内置（boot 实测 70–76MB < 100MB） |
| 内存 | 五纪律（ADR-005 ①LIMIT≤60 ②封面流式 ③禁 base64 ④stmt 缓存 ⑤无 hydration）；RSS<100MB（告警 150MB） |

## 2. 工作流（AGENTS.md §14 落地）

改动前：读文档包对应章节 → 定位调用链 → 数据来源/状态边界 → 复用已有实现。
改动后必过：`npm run typecheck && npm run lint && npm run build`；涉及 API/DB 的改动检查
数据兼容性；UI 改动检查 loading/empty/error 三态；不留 debug 代码。

**并行协作纪律**：routes/ 各域文件归各自 agent 所有——修别人的文件只限"挡住共享门禁的
最小类型/import 修复"，并在提交说明中披露；不动 index.ts/app.ts 挂载结构、
dao/interface.ts 契约、db.ts PRAGMA 基线（三不动）。

## 3. 边界（骨架留给后续 agent 的空白，2026-11-12 F0 前端骨架交付后更新）

- 建表迁移（02 v1.2 三条数据决定 + V12 约束 → 物理层）；DAO 实现（`dao/index.ts`）；
- 七域路由实现（注册模式见 routes/README.md）；**pages.ts + html.ts 已由 F0 填充并冻结**
  （改动走文档包 07-前端设计包/02-前端实现拆分方案.md §6 登记）；
- 岛屿实现（4 个 stub 已注册进 main.ts：add-dialog→F2 / filter-cabin→F1 /
  search-box+keyboard-flow→F3；第 5 岛屿 wall-scroll→F4 触发 ADR-003 评审条款；
  派工 prompt = 07-前端设计包/02 §4）；封面缓存/主色提取（D3）；
- 备份调度（index.ts TODO 挂载点）；MusicBrainz 串行队列 spike（D3）。
