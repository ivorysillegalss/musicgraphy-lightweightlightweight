# 用户级记忆 · Musicgraphy 2.0（同步自工作区，2026-11-15 晚·第三批收口后）

> **性质与适用范围**：本文件 = ZCode 用户级记忆（`~/.zcode/AGENTS.md`），内容同步自
> Musicgraphy 2.0 工作区的全部工作流约束（4 份 AGENTS.md + 文档包《00-工作区关系与硬约束》
> + 《看板更新协议》+ 看板最新状态快照）。**仅在 Musicgraphy 2.0 相关工作时适用本文件内容**，
> 其他项目工作不受本文件约束。
> **权威序不变**：工作区内的原文件永远是事实源；本记忆用于工作区文件不可达/路径变更时
> 恢复上下文。冲突裁决：用户指示 > 工作区原文件 > 本记忆。

## 0. 项目速览（30 秒版）

- **项目**：Musicgraphy 2.0，个人音乐线索库 Web 应用（个人专辑档案 + 线索回响）。
- **执行主线**：方案 B（增长验证优先）· 12 周验证冲刺；PM 排期锚点 W0 = 2026-11-16，
  实际实现超前于日历（W0 于 2026-11-11 完成）。
- **核心架构红线**（**2026-11-15 用户批注修订 = IM-30**；文档包 00-硬约束 v1.3）：
  SQLite(node:sqlite) + Hono；hono/html 禁 raw 插用户数据；全局串行限流 ≥1s；
  备份 = VACUUM INTO；隐私红线 + 资产自托管零 CDN；DD3 URL 即状态。
  ~~运行时依赖 = 2~~ / ~~SSR 岛屿（无 JS 基线）~~ / ~~RSS < 100MB~~ / ~~DAO < 200 行~~
  已废止（数值转观察指标；IM-14 CSS 预算、首屏 JS 预算、IM-19、无 hydration、
  UI 不建页面清单同批废止）。
- **主线仓已上 GitHub**：origin = `github.com/ivorysillegalss/musicgraphy-lightweightlightweight`；
  HEAD `d8653d0`（2026-11-15 21:30）已推远端并经 ls-remote 验证一致。
- **看板线上镜像**：<https://musicgraphy-progress-ohqn.zai-ai.site>（公开无密钥，已接受；
  2026-11-15 晚核验 = progress-data.js / daily-reports.js 线上与本地 SHA256 逐字节一致）。
- **归档工作区参考路径**（2026-11-13 快照）：
  `C:\Users\13762\Desktop\Musicgraphy-2.0-workspace-archive-20261113\`
  若路径已变，以实际找到的三层目录为准（见 §1）。

## 1. 工作区地图与权限边界

| 目录 | 身份 | agent 权限 |
|---|---|---|
| `musicgraphy/` | **主线仓 · 唯一开发位**（git 主干，已推 GitHub origin） | ✅ 开发（守仓内 AGENTS.md 门禁） |
| `Musicgraphy-2.0-代码库/` | **遗留仓 · 只读存档**（D2 spike 报告、冻结 DAO 契约 dao/interface.ts 十方法、V10 鉴权参考实现） | ❌ 禁写禁删禁新开发；**2026-11-15 用户裁决 = 永久封存**（原样只读保留，不迁移不合并不删除；D3 alias_sources 主线对象数组为唯一权威） |
| `Musicgraphy-2.0-文档包/` | **文档事实源**（索引 = `00-文件目录说明.txt`；**独立 git 仓**，main 分支，无远端） | ✅ 回写：原地替换旧内容 + 同步索引 + 过测试 + git 提交 |
| `…文档包/08-进度看板/` | **进度唯一事实源**（progress-data.js） | ✅ 按协议只改自己负责的卡 |
| `tools/` | Node v26 portable + rezip-docpackage.ps1 + rezip-workspace.ps1 | ✅ 使用，不改 |
| `_downloads/` | ui-ux-pro-max skill 克隆 | ❌ 只读 |
| `review/` `变现文档包/` `LIKE全扫` `-p` `_prototype-cover-views/` 根级 `docs/` | 历史杂项/早期副本/误建文件，**非事实源** | ❌ 禁当依据；清理须用户裁决 |
| 根级 `Musicgraphy 2.0 新版产品理念（终稿）.md` | 副本；权威 = 文档包 `01-产品理念终稿/` | — |

## 2. 权威序与开工三读

- **裁决顺序**：用户指示 > 文档包《00-工作区关系与硬约束.md》（工作区关系唯一权威）
  > `musicgraphy/AGENTS.md`（主线仓纪律）> 工作区根 `AGENTS.md`（环境/运维补充）> 看板 notes。
- **开工三读**：① 《00-工作区关系与硬约束》→ ② 看板最新内容（**重读**）→
  ③ 主线 `AGENTS.md` + `git log`/`git status`。
- **AGENTS.md 有几份**（历史混淆澄清）：现行 = 工作区根 + 主线仓 + 遗留仓（历史）+
  `文档包/04-源文档/`（上游产品工程约束）四份，互不冲突；遗留仓那份是历史参考。
- **02 变现文档有两个版本**：根级 `变现文档包/` 是早期副本；权威 = `文档包/02-变现文档包/`（v1.2）。
- **DAO 契约是哪份**：`dao/interface.ts` 十方法契约是**遗留仓**冻结文件；主线 DAO =
  `src/server/db/dao.ts`（方法名不同），扩展走评审案 + G3 行数护栏。

## 3. 硬约束（违反 = 交付无效）

1. **主线唯一**：一切代码只写进 `musicgraphy/`；其他目录新建/修改代码 = 越权。
2. **文档包唯一事实源**：需求/规格/裁决以文档包为准；产出必须回写文档包
   （原地替换 + 同步索引），不留对话孤儿结论。
3. **看板同步强制**（用户 2026-11-12 钦定）：完成即更新 `progress-data.js` 对应卡，
   **未同步看板 = 未交付**；置 done 前置 = `npm run check` 全绿；evidence 必须可核查
   （数字/路径/hash）；看板与代码不一致时**以代码为事实源**修正看板。
4. **门禁与红线**（**2026-11-15 用户批注修订 = IM-30**）：`npm run check` 全绿
   （基线顺延，当前 273/273）；hono/html 禁 raw 插用户数据；DD3 URL 即状态；隐私红线 +
   资产自托管零 CDN；提交说明引用需求编号（FR-x/P1-x/ADR-x/IM-x）。
   ~~运行时依赖 ≤2~~ / ~~RSS <100MB~~ / ~~DAO <200 行~~ / ~~无 JS 基线~~ 已废止
   （转观察指标；依赖数/RSS/DAO 行数仍随卡 evidence 如实报告）。
5. **并发现实**：宿主同一时间仅 1 个子 Agent（实测超限报错）；多会话并行按
   "文件边界零交集"分割；同一仓库**先收口提交再开新工作**（未提交在制品会挡他人门禁）。
6. **裁决保留权**：删仓/合并仓、预算超线追认、PM 后周任务提前执行、遗留仓冲突取舍、
   在制品提交时机——**只有用户能批**；agent 最多产出评审案并标注"待追认"。
7. **派工 prompt 必须自包含**：写明目标仓绝对路径、先读清单、文件边界、看板卡片操作、
   zip 重建命令；派工计划事实源 = `07-前端设计包/02-前端实现拆分方案.md`。
   接单时以 prompt 原文 + 前置 Agent 交付实况为第一判断依据，勿凭旧印象改写目标仓
   （W1-7/W1-8 派工落遗留仓为先例）。
8. **冻结决策不得重开**（遗留仓 AGENTS.md 冻结表）：Node 26 LTS 单进程；
   node:sqlite 主选（better-sqlite3 仅 C2 回退）；PRAGMA = WAL/NORMAL/-8000/FK=ON/
   busy_timeout=5000；单连接同步 API 无池（db.ts 全仓唯一）；手写 SQL + prepared
   statements 进程级缓存；迁移 = `db/migrations/00NN_*.sql` + user_version（DDL 包事务、
   PRAGMA 在事务外）；SSR = hono/html；API = `/api/v1` + envelope
   `{error:{code,message,details?}}` + cursor=[sort_value,id] base64(JSON)、limit ≤60；
   鉴权 = V10 cookie 会话（HttpOnly+Lax+Secure HMAC）+ 302 表单页 + CSRF Origin 校验
   + Bearer 备用；上游调用 = 全局串行队列 ≥1s + 全局 30/min + 显式 UA（iTunes 20/min）；
   备份 = 启动 + 每日 VACUUM INTO（musicgraphy-YYYYMMDD.db 按天去重、留 7 天，
   WAL 期禁文件复制）；禁 PM2；--max-old-space-size=64 + RSS 看门狗；
   内存五纪律（LIMIT≤60 / 封面流式 / 禁 base64 / stmt 缓存 / ~~无 hydration~~——
   **2026-11-15 用户批注：无 hydration 条目废止 = IM-30，余四条维持**）。
9. **三不动**（**2026-11-15 用户批注修订 = IM-30 甲-8**）：~~index.ts/app.ts 挂载结构~~
   （废止，可重构——/atlas、/panorama、/crate、/genres、/topsters/about 等新页面挂载均为
   此口径下的合法增量）；dao/interface.ts 契约（遗留仓冻结文件）与 db.ts PRAGMA 基线仍不动。
   routes/ 各域文件归各自 agent 所有——修别人文件只限"挡住共享门禁的最小类型/import 修复"，
   提交说明披露。

## 4. 环境重建（新机器从零跑通）

1. **Node v26.13.0（冻结口径，勿用其他版本）**：解压 `tools/node-v26.13.0-win-x64.zip`
   至 `tools/node-v26.13.0-win-x64/`；命令前置 PATH（不写系统 PATH，**必须 MSYS 风格**）：
   `export PATH="/…/tools/node-v26.13.0-win-x64:$PATH"`
2. **主线安装**：`cd musicgraphy && npm install`（package-lock.json 在）。
   **esbuild postinstall 必须被允许**：`npm install-scripts approve esbuild`（npm 11.20.0 实测）；
   等效 = config `ignore-scripts=false`。vite build 报 esbuild 缺失即此步未生效。
3. **git 身份**：本机无全局身份，提交用仓库级参数
   `git -c user.name="…" -c user.email="…" commit …`。
4. **门禁基线**（2026-11-15 晚第三批收口后）：HEAD `d8653d0`（已推 GitHub origin）；
   测试 273/273（Node v26.13.0；tsc/eslint/vite build/node:test）；运行时依赖 = 3
   （hono + @hono/node-server + maplibre-gl，观察指标）；main.css 24,319B（观察指标）；
   globe chunk ~1.08MB（懒加载不进首屏）；RSS 生产参数 86.68MB（全景页全表读峰值 101MB
   为观察指标口径）。
5. **遗留仓**：默认只读不动；验证存档状态同样 npm install + check，任何写操作须用户裁决。

## 5. 运维程序

- **文档包 git 仓**（2026-11-14 用户新建）：`Musicgraphy-2.0-文档包/` = 独立 git 仓
  （分支 main，无远端；提交身份 `agent@musicgraphy.local`）。**收口三步 = node --test tests/
  （11 项，cwd = 文档包根，零依赖）全绿 → git 提交（message 带卡片号，只 add 本次变更文件）
  → 看板数据变更时线上重部署**；测试红或未提交 = 未交付；`/.zcode/` 已 ignore。
- **文档包 zip（2026-11-14 起降级）**：仅**用户显式要求**时执行，工作区根
  `powershell -ExecutionPolicy Bypass -File tools/rezip-docpackage.ps1`；默认收口不做。
- **工作区全量归档**：`powershell -ExecutionPolicy Bypass -File tools/rezip-workspace.ps1`。
- **⚠️ 禁用 tar.exe/bsdtar 重建任何 zip**（2026-11-12/13 两轮实测证伪）：中文 locale 下
  条目名与 `-f` 文件名被 GBK 化，且 `.zcode/` 会话状态泄漏进包。ps1 是唯一可靠路径。
- **ps1 编码纪律**：含中文的 ps1 必须 UTF-8 **with BOM**（PowerShell 5.1 无 BOM 按
  ANSI/GBK 读必炸）；辅助校验脚本一律纯 ASCII + 通配路径。
- **看板线上部署**：progress-data.js / daily-reports.js 每次更新后必须重部署才反映线上。
  stage = 工作区根 `.zcode-site/stage/`（看板六件 index.html/app.js/progress-data.js/
  daily.html/daily.js/daily-reports.js + static-server.mjs + start.sh，
  SITE_DIR=. SPA_FALLBACK=0）；程序 = 从源文件重建 stage（禁 patch 旧 stage）→
  ZCode Site CLI 部署（siteId `2120913580313718784`，记录于工作区根 `.zcode-site.json`，
  该文件维持未跟踪 = 7f95537 披露先例）。

## 6. 看板协议精华（progress-data.js 是唯一数据源）

- 只改**自己负责那张卡**的 `status / desc / evidence / updated` 四字段；不增删卡片、
  不改他人卡、不动 meta（lastSync 由全量同步会话更新）；index.html/app.js/daily.html/daily.js
  禁改（展现形式变更须用户裁决：2026-11-14 裁决改为主线 tracks 视图、同日裁决新开
  「每日日报」页 = daily-reports.js 数据 + index.html 入口链接一处，均已登记协议 §7）。
- 触发：开工置 `in_progress`；完成置 `done` + 可核查 evidence + 当天日期；
  受阻置 `blocked` 写明原因。每日收口在 daily-reports.js 头部追加当日日报条目
  （历史只增不改；2026-11-14 用户新原则）。
- 状态取值：done / in_progress / pending / blocked / watch（护栏观察卡，不计数）。
- **并行保护**：编辑前必重读文件最新内容，小步 Edit，禁整文件重写。
- 语法自检（新版 tracks 结构，cwd = 文档包根）：
  `node -e "global.window={};require('./08-进度看板/progress-data.js');var d=window.MG_PROGRESS;console.log('tracks='+d.tracks.length,'relations='+d.relations.length,'ok')"`
  输出 ok 才算有效更新；更新后浏览器打开 index.html 目检对应卡。
- 新决策登记：实现期决策追加到 `文档包/05/实现决策记录.md`（IM 编号顺延，**只增不改**；
  当前至 IM-33）。
- **协议 §7 建卡特例已登记**（agent 不得随意建卡，四特例外须用户批准）：
  ⑥ 设计参考第二批 S2-8~S2-27 分割候选建卡（0c8c2d8）；⑦ R-110 → B10 建卡（f3923c4）；
  ⑧ S2-28 Radiooooo 实施转正建卡（77b90f6）；⑨ B10 范式（2a6a920）。

## 7. 进度快照（同步时点 2026-11-15 晚，以看板/代码实况为准）

- **看板 7 tracks × 73 卡 = done 63 / watch 4（G1–G4）/ pending 6**
  （S2-2 搜索优化专项 / S2-3 前端动效专项·承接 R-103 React 裁决 / S2-4~S2-7 设计参考四站
  总卡——后四张 = 筛选候选非排期承诺，排期判定权在用户）；lastSync = 2026-11-15。
  - DESIGN 4 done；CRAWL 6 done；BACKEND 18 done（含 B10）；FRONTEND 8 done；
    SHIP 5 done（余 = 用户亲手发布 landing/赞助链接/全渠道 + W12 决策门）；
    OPS 1 done + 4 watch（观察池 O1–O9）；SPECIAL 21 done + 6 pending。
- **2026-11-15 实现潮（全部当日收口、看板与日报均同步）**：
  1. **Radiooooo 地图模块 0→1**（D1–D4 四会话：1fde125 端口契约+NE 110m GeoJSON 自托管 →
     5db47b4 引擎选型评审案（推荐 MapLibre GL JS，待追认）→ b180dd7/27d9e46 globe 岛屿 +
     URL 即状态 + 红线审计零豁免 → 950df06 data-playback=mock DoD 闭环）；
     S2-28 转正 done；maplibre-gl 入 deps = 依赖 2→3（观察指标）；新页面 = /atlas。
  2. **设计参考第一批·非音频段**（0ab7a4d，S2-12~S2-26 十二卡 done）：R-106 收藏全景
     /panorama（Canvas LOD + db/panorama.ts 服务端预计算）/ R-107 页脚三视图入口 +
     POST /settings/sensory 感官层开关（mg_sensory cookie）/ R-108 翻箱 /crate（CSS 3D）+
     /random 302 / R-109 流派星图 /genres（纯 SSR + db/genremap.ts 确定性力导向）。
  3. **设计参考第二批·音频段**（3532749，S2-15/18/19/27 done，check 263/263）：
     /album/:id/preview 同源代理流式（iTunes song previewUrl，经既有串行队列 +20/min 门，
     零落盘 IP 不出本机）+ audio-viz 示波器岛屿 + genre-scan 扫听岛屿 + P 键就地试听。
  4. **B5 连通性收口 + 正式导入**（IM-31 真网关两 bug 修复：Cookie 未附加等；导入实况
     fetched=188/imported=181，collection_record 5222；IM-32 封面管线两处收口）。
  5. **R-110 · B10 netease 元数据补全**（b180dd7/1da3363/ca48ba5，IM-33）：mb-calibrate
     累计 year 103 / country 105 / genres 12；pass3 遇 MusicBrainz 503 墙暂停
     （建议冷却数小时/隔日重跑，增量 resumable，剩余约 67 行未定）。
  6. **发布后迭代第三批**（d8653d0，check 273/273 = 基线 263+10）：S2-1 Topster 内容
     描述页 /topsters/about + 全站页脚入口行 / S2-29 页脚登录态行「已解锁 · Musicgraphy」+
     POST /logout / S2-30 封面墙下拉限制（autoLeft=3 自动配额转手动 + SSR wall-end 到底条 +
     #mg-top 原生回顶）/ S2-31 Genre·年份筛选原生 details 轴收纳（零新参数零 DD3 破坏）。
- **需求事实源** = 文档包 01-产品理念终稿/`需求草案-2026-11-15-发布后迭代第一批.md`
  （R-101~R-110）+ `需求草案-2026-11-15-设计参考第二批.md`（四站原理拆解 + 0→1 分割）。
  R-103 React 接入 = 用户确认裁决，实施须评审案先行（G1「依赖≤2」与「无 JS 基线」红线
  将随实施修订）。
- **门禁基线**：npm run check 273/273（HEAD d8653d0）；运行时依赖 = 3（观察指标）；
  行为类四仪表已实算（IM-28）；IM 记录至 IM-33。
- **执行序**：实现面 pending 仅 6 卡（S2-2 / S2-3 / S2-4~S2-7），均待用户排期/筛选；
  S2-3 承接 R-103。余 = 用户发布链路 + 决策门 + DR-M1 三件追认。
- **主线仓远端**：origin = `https://github.com/ivorysillegalss/musicgraphy-lightweightlightweight`，
  d8653d0 已推并验证一致；文档包仓无远端（本地仓，非缺口）。

## 8. 待用户裁决清单（agent 只能备案评审案，不能自决；2026-11-15 晚复核）

1. ~~未提交在制品的提交时机~~（2026-11-15 用户裁决令已收口：主线两笔 3378964/b3ff02c 入库）。
2. ~~双仓归属/合并~~（2026-11-15 用户裁决 = **永久封存**：原样只读保留不迁移不合并不删除，
   登记 = 文档包 00 硬约束 v1.2 + 02/12 号文档 §5）。
3. ~~alias_sources 编码归一~~（随 D2 了结：主线对象数组为唯一权威，遗留仓形态冻结）。
4. 7f95537 归属澄清追认（B5 会话文档件随 Topster 收口捎带入库，提交说明误标）。
5. IM-23 同号两则补正案（网易云评审案登记 与 P1-6 实现决策同号；IM 只增不改）。
6. colorOf(16)/13「灰」双 chip 消歧（涉种子库生命周期）。
7. **DR-M1 三件待追认**（随 S2-28 done 挂起）：① MapLibre GL JS 引擎裁决（评审案
   05-系统架构设计/评审案-地理渲染引擎选型.md 推荐）② maplibre-gl 入 dependencies
   （运行时依赖 2→3 观察指标）③ /atlas 页面挂载。
8. b180dd7 捎带并行 globe 文件待追认（提交说明已披露 = 7f95537 同族）。
9. R-103 React 接入实施立项（方向已裁决，实施须评审案先行 + 红线修订）。
10. mb-calibrate 503 墙剩余约 67 行 genres/year 补全：冷却后重跑增量（resumable，
    无需裁决即可重跑；若用户叫停则维持现状）。
（已销项：IM-14 于 2026-11-14 追认 ≤20KB；IM-17 jpeg-js 追认；IM-16 经 B1 解锁闭环；
B1–B3 追认令、B4/B5/B7 派工令、P1-10/W10/W11 批准均已于 2026-11-14 落地。）

## 9. 踩坑备忘（实测教训，勿重蹈）

- **多会话并行**：每次 Edit 前必重读目标文件（跨会话交叉编辑高频，"modified since read"
  报错对策 = 等数秒 → 重读 → 小步重试）；领取新卡前先重读 progress-data.js 最新内容。
- **只读指令不可靠**：对子 agent 的只读约束要用 mtime 核对验证；越权改动交用户追认，
  不擅自回滚。
- **node:sqlite 定案**：UNIQUE 冲突 errcode = 2067（主码 = errcode & 0xff == 19）；
  `PRAGMA busy_timeout` 读回列名是 `timeout`；**WAL 期裸复制 .db 连 schema 都读不到**
  ——备份必须 VACUUM INTO（主案 19–21ms）/backup() 备选；json_each 计数 ~0.7–4ms。
- **e2e 细节**：boot 备份产物断言须等一拍（listening resolve 后备份才落盘，同 tick
  readdir 会竞态空读）；CSV BOM 校验须用字节比较（response.text() 剥 BOM）。
- **命令链吞退出码**（2026-11-15 新教训）：`cmd1 && cmd2` 链中前置失败可能被吞——
  **提交前二次复核测试绿**（B10 会话实测；77849ca 披露）。
- **Windows 计时竞态 flake**：concurrency-covers CoverGate 串行间隔一例实测与实现无关
  （27d9e46 同族），对策 = 单文件复跑 + 全量重跑证实后再判。
- **LIKE 查询**：5000 行种子四字段 LIKE 经 listPage 实测 1–2ms，性能无忧。
- **浏览器自动化（ZCode IAB）**：输入管线会中途死亡（只读正常而点击静默无效）；
  reload 后 scrollY 归零——坐标点击前必须确认元素在 viewport 内；locator.evaluate
  回调是单元素语义非数组。**且中文输入可能以损坏编码落库**（2026-11-15 实测：W1-4
  smoke 时期经 IAB 写入的 Tag 残留两条乱码行——UTF-8 中文被错误编码成 `ð`/`ҹ`+U+FFFD，
  refs=0 潜伏 4 天后经 Tag 治理提示暴露；已清理。e2e 手输中文后必须抽查 DB 字节层）。
- **看板并发**：多会话同时更新看板时，插入 notes 前先 `node` 自检看最新条数再重读重试。
- **PATH 前置写法（2026-11-15 新教训）**：harness 的 Git Bash 里 `export PATH="C:/…:$PATH"`
  **静默失效**（`which node` 仍解析系统 Node v24，且门禁照常全绿不报错）——必须用 MSYS
  风格 `export PATH="/c/…/tools/node-v26.13.0-win-x64:$PATH"`；跑门前先 `node --version`
  核对，否则冻结口径（v26.13.0）被静默绕过（2026-11-15 晚再度复证：系统默认 Node 跑
  文档包测试挂一例）。

## 10. 产品原则精华（上游约束，源 = 文档包 04-源文档/AGENTS.md）

- 定位：**"记录、整理、找回自己听过的专辑"的个人音乐档案**；不是播放器/推荐引擎/
  Discogs 数据库/地图探索工具/社交社区。
- 核心行为闭环：`搜索专辑 → 添加到 Collection → 标签/收藏/备注 → 搜索与筛选 → 再次找到`。
- 功能准入：必须明确贡献"更快记录 / 更好整理 / 更容易找回 / 更好回顾"之一，否则暂缓。
- 优先级冲突序：**Find → Record → Organize → Review → Discover**（Find/Record 最高）。
- MVP = 搜索/确认/添加/网格/详情/Favorite/Tag/Note/Collection 内搜索/基础筛选/
  Recently Added；**暂不实现**：地图/地理聚类/Discovery Pool/全局推荐/强制评分/
  Last.fm 同步/Discogs 式版本管理/复杂后台/统计 Dashboard
  （注：UI 不建页面清单已随 IM-30 废止——/atlas /panorama /crate /genres 等新页面均为
  2026-11-15 用户实现令钦定产物）。
- 数据原则：外部元数据（title/artist/cover/year/genres）可重新同步；
  **用户数据（favorite/tags/note/addedAt/listenedAt）是用户资产，任何同步不得无条件覆盖**；
  模型围绕 Collection Record（Album 1—N Record），不围绕地图/地理实体建模型。
- 搜索是一级能力（渐进式过滤，不要求完整精确标题）；Collection 封面优先、默认
  Recently Added；Genre=外部 metadata 与 Tag=用户认知体系语义分离，Tag 低成本输入；
  MVP 用 Favorite 不用 1–10 评分；Topster = Collection 的一种 View，不得维护第二套数据。
- 工程原则：优先简单、不提前平台化（个人玩具不建微服务/消息队列/搜索集群）、
  不为单次需求顺带重构无关模块（最小影响范围→最小实现→验证）。
- UI 原则：cover-first / lightweight / playful / personal archive / low cognitive load。

## 11. 深入阅读顺序（按需，均相对文档包根）

- 需求/裁决：`01-产品理念终稿/`（含 `需求草案-2026-11-15-发布后迭代第一批.md` +
  `需求草案-2026-11-15-设计参考第二批.md`）→ `02-变现文档包/00-README.md`（方案 A/B）→
  `01-PRD` → `02-数据模型与API设计` → `07-系统架构与选型ADR`。
- 技术追溯：`05-系统架构设计/`（DESIGN.md / 存储评审 R1–R10 / 五维复审 V1–V16 /
  实现决策记录 IM-1~IM-33 / 四份评审案：网易云导入器 / 多用户并发与封面缓存 /
  netease元数据补全 / 地理渲染引擎选型）。
- 设计参考实施：`03-设计参考-Radiooooo`（v1.3，§5.5 波次表）+ 评审案 =
  主线仓 `docs/design-refs-review.md`（Q1~Q14）与 `docs/iteration-batch3-review.md`。
- 前端实现：`07-前端设计包/00-README.md` → `01-设计系统PRD` → MASTER.md（token 唯一来源）
  → `02-前端实现拆分方案.md`（实现与派工事实源）。
- 执行排期：`06-PM排期与研发可持续性计划.md`。

---
*同步：ZCode · 2026-11-15 晚（发布后迭代第三批 d8653d0 收口后） · 来源 = Musicgraphy-2.0-workspace-archive-20261113 工作区*
*（根 AGENTS.md + musicgraphy/AGENTS.md + 遗留仓 AGENTS.md + 文档包 04-源文档/AGENTS.md
+ 文档包 00-工作区关系与硬约束.md（v1.3）+ 08-进度看板/看板更新协议.md + progress-data.js
实况（73 卡）+ daily-reports.js 实况）*
