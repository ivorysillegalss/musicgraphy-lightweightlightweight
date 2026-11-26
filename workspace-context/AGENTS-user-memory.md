# 用户级记忆 · Musicgraphy 2.0（同步自工作区，2026-11-27 · 全量同步会话）

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
- **核心架构红线**（**2026-11-15 用户批注修订 = IM-30**；文档包 00-硬约束 v1.5）：
  SQLite(node:sqlite) + Hono；hono/html 禁 raw 插用户数据；全局串行限流 ≥1s；
  备份 = VACUUM INTO；隐私红线 + 资产自托管零 CDN；DD3 URL 即状态。
  ~~运行时依赖 = 2~~ / ~~SSR 岛屿（无 JS 基线）~~ / ~~RSS < 100MB~~ / ~~DAO < 200 行~~
  已废止（数值转观察指标；IM-14 CSS 预算、首屏 JS 预算、IM-19、无 hydration、
  UI 不建页面清单同批废止）。
  **v1.4（2026-11-17）= 并行 worktree 约定**（wt/<task-id> 任务分支 / 主树 = 收口位 /
  detached+update-ref 零扰动通道 / 建卡编号段预分配）；**v1.5（2026-11-18）= §二.10
  展示质量条款**（展示质量与 check 全绿同级交付门槛，UI 批次置 done 前置 = 展示质量门八项）。
- **GitHub 双分支结构**（2026-11-15 晚建立）：
  origin = `github.com/ivorysillegalss/musicgraphy-lightweightlightweight`；
  `main` = 主线代码仓（HEAD `c4c6a13` = 9fbc513 + 2026-11-27 门禁可重复性修复）；
  `workspace-context` = 文档包全量历史 + workspace-context/ 附件（AGENTS×3 + tools ps1×2 +
  RESTORE.md 重建指引）——新工作环境 clone 同仓 checkout 两分支即可还原完整开发上下文。
  **远端实况（2026-11-27 全量同步会话核验）**：main = `c4c6a13`；workspace-context =
  `d8b6a2d` + 2026-11-27 同步收口笔（附件与看板元数据按实况更新）。
- **看板线上镜像**：<https://musicgraphy-progress-ohqn.zai-ai.site>（公开无密钥，已接受；
  2026-11-27 同步会话重部署后复核 = progress-data.js / daily-reports.js 线上 sha256 与本地
  git blob 逐字节一致，lastSync '2026-11-27'；部署记录见 §5）。
- **当前环境**（2026-11-27 全量同步会话确认）：工作区根 =
  `C:\Users\Administrator\.zcode\workspace\draft-8e6cfbb0-0eb1-401d-b0b0-e96203f0ba8a`
  （ZCode draft 工作区；由 2026-11-13 归档快照经 GitHub 双分支对齐而来）。
  历史参考（旧机器归档，路径已失效）：
  `C:\Users\13762\Desktop\Musicgraphy-2.0-workspace-archive-20261113\`。

## 1. 工作区地图与权限边界

| 目录 | 身份 | agent 权限 |
|---|---|---|
| `musicgraphy/` | **主线仓 · 唯一开发位**（origin/main，HEAD `c4c6a13`，工作树干净；check 318/318） | ✅ 开发（守仓内 AGENTS.md 门禁） |
| `Musicgraphy-2.0-代码库/` | **遗留仓 · 只读存档**（D2 spike 报告、冻结 DAO 契约 dao/interface.ts 十方法、V10 鉴权参考实现） | ❌ 禁写禁删禁新开发；**2026-11-15 用户裁决 = 永久封存**（原样只读保留，不迁移不合并不删除；D3 alias_sources 主线对象数组为唯一权威） |
| `Musicgraphy-2.0-文档包/` | **文档事实源**（索引 = `00-文件目录说明.txt`；**git 仓 = workspace-context 分支工作树**，含 workspace-context/ 附件目录；origin = 同 GitHub 仓；本地 `main` 为旧收口分支，内容落后、永不 push） | ✅ 回写：原地替换 + 同步索引 + 过测试（node --test tests/）+ git 提交并 push `workspace-context` |
| `…文档包/08-进度看板/` | **进度唯一事实源**（progress-data.js） | ✅ 按协议只改自己负责的卡 |
| `tools/` | Node v26.13.0 portable + rezip-docpackage.ps1 + rezip-workspace.ps1 | ✅ 使用，不改 |
| `workspace-context/`（文档包内） | 随行附件（RESTORE.md/AGENTS×3/tools ps1） | ✅ 读；RESTORE.md 为新环境重建唯一指引 |
| `_downloads/` | ui-ux-pro-max skill 克隆 | ❌ 只读 |
| `review/` `变现文档包/` `LIKE全扫` `-p` 根级 `docs/` | 历史杂项/早期副本/误建文件，**非事实源** | ❌ 禁当依据；清理须用户裁决 |
| 根级 `Musicgraphy 2.0 新版产品理念（终稿）.md` | 副本；权威 = 文档包 `01-产品理念终稿/` | — |
| `.zcode-site/stage/` | 看板线上部署 stage（六件 + static-server.mjs + start.sh） | ✅ 从源重建（禁 patch 旧 stage） |

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
   （基线顺延，当前 318/318）；hono/html 禁 raw 插用户数据；DD3 URL 即状态；隐私红线 +
   资产自托管零 CDN；提交说明引用需求编号（FR-x/P1-x/ADR-x/IM-x）。
   ~~运行时依赖 ≤2~~ / ~~RSS <100MB~~ / ~~DAO <200 行~~ / ~~无 JS 基线~~ 已废止
   （转观察指标；依赖数/RSS/DAO 行数仍随卡 evidence 如实报告）。
5. **并发现实**：宿主并行子 Agent 上限随配额浮动（实测 1 / 3 两档，超限报
   "user concurrency limit exceeded"，分批补派）；多会话并行按"文件边界零交集"分割；
   同一仓库**先收口提交再开新工作**（未提交在制品会挡他人门禁）。
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
10. **展示质量条款**（2026-11-18 用户钦定最高权重；00-硬约束 v1.5 §二.10）：一切 UI 产出的
    展示质量与 `npm run check` 全绿为**同级交付门槛**——token 唯一来源（MASTER.md → tokens.css，
    禁裸 hex/裸 px 字号逃逸）/ UI 批次展示质量门八项 / 动效全量 `body[data-sensory="on"]` 门控且
    禁 ambient 自动循环 / 设计变更先过 ui-ux-pro-max 方法论 / 高度·对比度·密度实测复校。

## 4. 环境重建（新机器从零跑通）

0. **首选路径 = 分支内 `workspace-context/RESTORE.md`**（clone 同仓双分支 → 摆布局 →
   AGENTS 落位 → Node → npm install → check）；本节为速记。
1. **Node v26.13.0（冻结口径，勿用其他版本）**：解压 `tools/node-v26.13.0-win-x64.zip`
   至 `tools/node-v26.13.0-win-x64/`；命令前置 PATH（不写系统 PATH，**必须 MSYS 风格**）：
   `export PATH="/…/tools/node-v26.13.0-win-x64:$PATH"`；跑任何门前先 `node --version` 核对。
2. **主线安装**：`cd musicgraphy && npm install`（package-lock.json 在）。
   **esbuild postinstall 必须被允许**：`npm install-scripts approve esbuild`（npm 11.20.0 实测）；
   等效 = config `ignore-scripts=false`。vite build 报 esbuild 缺失即此步未生效。
3. **git 身份**：本机无全局身份，提交用仓库级参数
   `git -c user.name="…" -c user.email="agent@musicgraphy.local" commit …`。
4. **门禁基线**（2026-11-27 全量同步会话实跑复证）：HEAD `c4c6a13`（工作树干净）；
   测试 318/318（Node v26.13.0；tsc/eslint/vite build/node:test）；运行时依赖 = 3
   （hono + @hono/node-server + maplibre-gl，观察指标）；main.css 24,319B（观察指标）。
   注：`public/maplibre-gl-worker.mjs` 为 prebuild 派生物，已入 eslint ignores（2026-11-27 修复
   check 可重复性——否则二次 check 会扫出 1098 条 error）。
5. **遗留仓**：默认只读不动；验证存档状态同样 npm install + check，任何写操作须用户裁决。
6. **GitHub 网络不稳时的搬运通道**（2026-11-16 实测）：origin 直连可能 21s 超时/拒连交替——
   若已有完整 clone（如 /tmp 临时仓），可本地路径 fetch 零网络完成对齐：
   `git fetch <本地clone路径> '+refs/heads/*:refs/remotes/origin/*'`；
   push 需真实网络，等恢复窗口重试（2026-11-16 实测数分钟后恢复成功）。
7. **随行件同步规则**（2026-11-27 用户令「Agent约束这类工作区内容必须同步」）：根 `AGENTS.md`
   与 `~/.zcode/AGENTS.md` 变更后，必须同步 `workspace-context/AGENTS-workspace-root.md` /
   `AGENTS-user-memory.md` 并 push；看板 `meta.lastSync` 与 daily `meta.lastEntry` 同步更新。

## 5. 运维程序

- **文档包 git 仓**（2026-11-14 用户新建；2026-11-16 起本环境 = workspace-context 工作树）：
  **内容修改直接提交 `workspace-context` 并 push**（2026-11-17 起实际内容流，主工作树即该分支；
  e57a09a/9e8a5c5/d4483ef/d8b6a2d 为先例）。本地 `main`（ddea53b）= 旧收口分支，内容落后、
  无独有内容、**永不 push**，不作事实源。提交身份 `agent@musicgraphy.local`；只 add 本次变更
  文件；`/.zcode/` 已 ignore。
- **收口三步 = node --test tests/（11 项，cwd = 文档包根，零依赖）全绿 → git 提交 →
  看板数据变更时线上重部署**；测试红或未提交 = 未交付。
- **文档包 zip（2026-11-14 起降级）**：仅**用户显式要求**时执行，工作区根
  `powershell -ExecutionPolicy Bypass -File tools/rezip-docpackage.ps1`；默认收口不做。
- **工作区全量归档**：`powershell -ExecutionPolicy Bypass -File tools/rezip-workspace.ps1`。
- **⚠️ 禁用 tar.exe/bsdtar 重建任何 zip**（2026-11-12/13 两轮实测证伪）：中文 locale 下
  条目名与 `-f` 文件名被 GBK 化，且 `.zcode/` 会话状态泄漏进包。ps1 是唯一可靠路径。
- **ps1 编码纪律**：含中文的 ps1 必须 UTF-8 **with BOM**（PowerShell 5.1 无 BOM 按
  ANSI/GBK 读必炸）；辅助校验脚本一律纯 ASCII + 通配路径。
- **看板线上部署**：progress-data.js / daily-reports.js 每次更新后必须重部署才反映线上。
  stage 重建纪律（2026-11-16 实测改良）：**六件从 git blob 提取**（`git show
  "HEAD:08-进度看板/<file>" > stage/<file>`）= 字节级与仓库一致且免 autocrlf 污染
  （工作树文件经 autocrlf=true 是 CRLF，直拷会与线上 LF 口径不符）；
  static-server.mjs + start.sh 为基建件原样随行（start.sh 必须 LF）；
  stage = 工作区根 `.zcode-site/stage/`（2026-11-16 已换位为六件版），
  SITE_DIR=. SPA_FALLBACK=0；程序 = 重建全新 stage（禁 patch 旧 stage）→
  `zcode-site.mjs check <stage>`（可先本地自检）→ `zcode-site.mjs deploy <stage> --site
  2120913580313718784`。历史部署记录：2026-11-16 = 2121999319969476608；
  2026-11-18 = 2122744373392732160；2026-11-27 同步会话重部署（id 见收口笔补记）。

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
- **协议 §7 建卡特例已登记**（agent 不得随意建卡，特例外须用户批准）：
  ⑥ 设计参考第二批 S2-8~S2-27 分割候选建卡（0c8c2d8）；⑦ R-110 → B10 建卡（f3923c4）；
  ⑧ S2-28 Radiooooo 实施转正建卡（77b90f6）；⑨ B10 范式（2a6a920）；
  ⑩ R-111/R-112 → S2-32/S2-33 双卡（9e8a5c5）；⑪ S2-34 页面×数据元图谱建卡（e57a09a）；
  ⑫ 展示升级专项 S2-35~S2-41 七卡（d8b6a2d）。

## 7. 进度快照（同步时点 2026-11-27，以看板/代码实况为准）

- **看板 7 tracks × 83 卡 = done 66 / pending 12 / watch 4（G1–G4）/ blocked 1**；
  lastSync = 2026-11-27。
  - DESIGN 4 done；CRAWL 6 done；BACKEND 17 done + B10 blocked；FRONTEND 8 done；
    SHIP 5 done（余 = 用户亲手发布 landing/赞助链接/全渠道 + W12 决策门）；
    OPS 1 done + 4 watch；SPECIAL 25 done + 12 pending（S2-4~S2-7 设计参考四站 /
    S2-32 爬取限流 / S2-33 多用户账户 / S2-36~S2-41 展示升级六批——排期判定权在用户）。
- **2026-11-15 实现潮（全部当日收口、看板与日报均同步）**：
  1. **Radiooooo 地图模块 0→1**（D1–D4 四会话）→ /atlas；S2-28 转正 done；
     maplibre-gl 入 deps = 依赖 2→3（观察指标）。
  2. **设计参考第一批·非音频段**（0ab7a4d，S2-12~S2-26 十二卡 done）：
     /panorama /crate /random /genres 四入口上线。
  3. **设计参考第二批·音频段**（3532749，S2-15/18/19/27 done，check 263/263）：
     /album/:id/preview 同源代理流式 + audio-viz + genre-scan + P 键就地试听。
  4. **B5 连通性收口 + 正式导入**（IM-31/IM-32；导入实况 fetched=188/imported=181，
     collection_record 5222）。
  5. **R-110 · B10 netease 元数据补全**（b180dd7/1da3363/ca48ba5，IM-33）：mb-calibrate
     累计 year 103 / country 105 / genres 12；pass3 遇 MusicBrainz 503 墙暂停
     （冷却后重跑增量 resumable，剩余约 67 行未定）。
  6. **发布后迭代第三批**（d8653d0，check 273/273 = 基线 263+10）：S2-1 /topsters/about +
     页脚入口行 / S2-29 登录态行 + POST /logout / S2-30 封面墙下拉限制（autoLeft=3 +
     wall-end + #mg-top）/ S2-31 Genre·年份筛选原生 details 轴收纳。
- **2026-11-16~18 实现潮（同样全部收口）**：
  7. **S2-2 搜索分字段**（34d4837，方案 b = q 内前缀 artist:/title:/tag:/note:，零新 URL
     参数；search-parse 纯函数 + buildWhere 字节同形向后兼容 + 外部链逐源透传；
     check 318/318 = 273+45；评审案-搜索分字段定向.md §8 三项待追认）。
  8. **S2-28 验收实跑修两缺陷**：五态染色 match 数组标签 → 平铺（b6ca383）+ MapLibre v6
     worker 404（ff0a187 自托管 worker + setWorkerUrl / 6f17795 gitignore）；浏览器终验四项
     全过（世界球 / France URL 选中 / 暗色 / 主题按钮双向）。
  9. **S2-34 页面×数据元关系图谱**（e57a09a，纯文档）：33 行页面×数据元总表 + 反向索引 +
     用户资产写入点全清单。
  10. **S2-32/S2-33 双专项登记**（9e8a5c5）：R-111 爬取限流对策（评审案-爬取限流对策.md，
      503 墙 = 政策性速率墙；推荐链 B3 熔断 + B6 负缓存 → B1 多源回退 → B2 多 token/BYO）+
      R-112 多用户账户系统（架构级，接管 R-102 开放问题，评审案待出）。
  11. **展示升级专项**（d8b6a2d，R-113~R-118）：需求草案-2026-11-18 六令 + 五路分析件
      （字体零交付 / 主页密度 / 顶部入口 / Hover 卡 / 星图漫游评审案）+ PM 排期四批 +
      00-硬约束 v1.5 §二.10 + 看板 S2-35~S2-41 七卡。
  12. **check 门禁可重复性修复**（c4c6a13，2026-11-27）：`public/maplibre-gl-worker.mjs`
      （prebuild 派生物）入 eslint ignores——此前二次 `npm run check` 必红 1098 条。
- **需求事实源** = 文档包 01-产品理念终稿/：`需求草案-2026-11-15-发布后迭代第一批.md`
  （R-101~R-110）+ `需求草案-2026-11-15-设计参考第二批.md` + `需求草案-2026-11-17-爬取限流
  对策与多用户账户系统.md`（R-111/R-112）+ `需求草案-2026-11-18-展示升级专项.md`
  （R-113~R-118）。R-103 React 接入 = 用户确认裁决（11-18「充分利用 react 和 js」= P0 批文），
  实施须评审案 + 红线修订。
- **门禁基线**：npm run check **318/318**（HEAD c4c6a13；2026-11-27 本环境实跑复证，
  可重复）；IM 至 IM-33。
- **执行序**：实现面 pending 仅 12 卡（S2-4~S2-7 / S2-32 / S2-33 / S2-36~S2-41），
  均待用户排期/批文；B10 blocked（DB 不纳入同步，用户 2026-11-27 口径）。
  余 = 用户发布链路 + 决策门。
- **远端同步实况（2026-11-27 全量同步会话核验）**：origin =
  `https://github.com/ivorysillegalss/musicgraphy-lightweightlightweight`——
  `main` = `c4c6a13`（代码，本地 = 远端一致）；`workspace-context` = `d8b6a2d` +
  2026-11-27 同步收口笔（附件 + 看板元数据；已推 origin 并 `ls-remote` 核验）。

## 8. 待用户裁决清单（agent 只能备案评审案，不能自决；2026-11-27 同步会话整理）

1. 7f95537 归属澄清追认（B5 会话文档件随 Topster 收口捎带入库，提交说明误标）。
2. IM-23 同号两则补正案（网易云评审案登记 与 P1-6 实现决策同号；IM 只增不改）。
3. colorOf(16)/13「灰」双 chip 消歧（涉种子库生命周期）。
4. **DR-M1 三件待追认**：① MapLibre GL JS 引擎裁决（评审案-地理渲染引擎选型）② maplibre-gl
   入 dependencies（运行时依赖 2→3 观察指标）③ /atlas 页面挂载。
5. b180dd7 捎带并行 globe 文件待追认（提交说明已披露 = 7f95537 同族）。
6. R-103 React 接入实施立项（方向已裁决 = 2026-11-18「充分利用 react 和 js」P0 批文；
   实施须评审案 + 红线修订，S2-37 React 基座批）。
7. mb-calibrate 503 墙剩余约 67 行 genres/year 补全：冷却后重跑增量（resumable，
   无需裁决即可重跑；若用户叫停则维持现状）。
8. **展示升级专项批文**：06-PM排期-展示升级专项-2026-11-18.md §8 共 54 项裁决点，S2-36~S2-41
   实施前置（含 R-116 星图漫游评审案 §8 八项）。
9. **B10 数据裁决**：旧机 DB 搬运 vs 本环境重导入（用户 2026-11-27 明确 DB/封面不纳入云端
   同步范围；执行方式仍待定，看板维持 blocked）。
（已销项：未提交在制品提交时机、双仓归属=永久封存、alias_sources=D3 了结、IM-14/15/16/17、
B1–B3 追认令、B4/B5/B7 派工令、P1-10/W10/W11 批准、S2-2/S2-3 排期——均已于 2026-11-14/15/17 落地。）

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
- **命令链吞退出码**（2026-11-15 新教训；2026-11-16 再证新形态）：`cmd1 && cmd2` 前置失败
  可能被吞；**管道尾巴（`git push | tail`）成功码会掩盖 push 失败**导致重试循环提前
  break——正确写法 = 无管道捕获 `rc=$?` 或 PIPESTATUS，再判分支。
- **Windows 计时竞态 flake**：concurrency-covers CoverGate 串行间隔一例实测与实现无关
  （27d9e46 同族），对策 = 单文件复跑 + 全量重跑证实后再判。
- **LIKE 查询**：5000 行种子四字段 LIKE 经 listPage 实测 1–2ms，性能无忧。
- **浏览器自动化（ZCode IAB）**：输入管线会中途死亡（只读正常而点击静默无效）；
  reload 后 scrollY 归零——坐标点击前必须确认元素在 viewport 内；locator.evaluate
  回调是单元素语义非数组。**且中文输入可能以损坏编码落库**（2026-11-15 实测 W1-4 时期
  IAB 写入 Tag 残留乱码行；e2e 手输中文后必须抽查 DB 字节层）。
- **看板并发**：多会话同时更新看板时，插入 notes 前先 `node` 自检看最新条数再重读重试。
- **PATH 前置写法**：harness 的 Git Bash 里 `export PATH="C:/…:$PATH"` **静默失效**——
  必须 MSYS 风格 `export PATH="/c/…/tools/node-v26.13.0-win-x64:$PATH"`；跑门前先
  `node --version` 核对，否则冻结口径（v26.13.0）被静默绕过。
- **autocrlf=true 与镜像一致性口径**（2026-11-16 新教训）：本机 autocrlf=true 使工作树
  文件 = CRLF，与线上 LF 产物 sha256 **必然不等**（每行 +1 字节）——判定「本地 vs 线上
  是否一致」必须用 **git blob hash vs 线上文件 hash**，工作树文件 hash 不可作判据；
  线上大小差 = CRLF 行数时先疑换行符再疑内容。
- **GitHub 直连不稳**（2026-11-16 实测）：21s 超时与拒连交替、数分钟后自行恢复——
  fetch 可走本地 clone 搬运通道（§4.6），push 等恢复窗口重试；部署走 ZCode Site 通道
  与 GitHub 无关，不受影响（2026-11-27 推送实测正常）。
- **命令管道吞退出码**（2026-11-27 实测）：`npm run check | tail` 会把 lint 的 1098 条 error
  遮成 exit 0——一律重定向文件后 `rc=$?` 或 PIPESTATUS 再判。
- **并行 worktree 约定**（2026-11-17 v1.4）：wt/<task-id> 任务分支 + 主树收口位 +
  detached/update-ref 零扰动通道；worktree 只消编辑期冲突，合并期同区域冲突仍在。
  并行提交后主工作树索引可能残留 staged-D 假象——提交前复核 `git diff --cached --stat`。
- **子 agent 并发上限浮动**：实测 1（11-16）/ 3（11-18）两档，超限报错后分批补派。
- **镜像一致性**：autocrlf → 工作树 CRLF / blob+线上 LF；一致性判定用 git blob hash，
  工作树 hash 不可作判据；stage 必须从 git blob 提取。
- **MapLibre v6**：worker URL 由 import.meta.url 非字面量拼接 → vite 不识别 → 产物缺 worker
  → 404 静默停摆；修复 = prebuild 拷 public/ + setWorkerUrl。GPU 侧 style 校验只在浏览器运行时
  发生（node:test 抓不到），match 分支标签只接受数字/字符串。
- **IAB 补充**：截图合成器可能有伪影（以 DOM 为准）；异步 evaluate 不 await 会读旧值
  （window 暂存 + 同步轮询）；`window.__mgMap` 可直读引擎内部。

## 10. 产品原则精华（上游约束，源 = 文档包 04-源文档/AGENTS.md）

- 定位：**"记录、整理、找回自己听过的专辑"的个人音乐档案**；不是播放器/推荐引擎/
  Discogs 数据库/地图探索工具/社交社区。
- 核心行为闭环：`搜索专辑 → 添加到 Collection → 标签/收藏/备注 → 搜索与筛选 → 再次找到`。
- 功能准入：必须明确贡献"更快记录 / 更好整理 / 更容易找回 / 更好回顾"之一，否则暂缓。
- 优先级冲突序：**Find → Record → Organize → Review → Discover**（Find/Record 最高）。
- MVP = 搜索/确认/添加/网格/详情/Favorite/Tag/Note/Collection 内搜索/基础筛选/
  Recently Added（注：UI 不建页面清单已随 IM-30 废止——/atlas /panorama /crate /genres
  等新页面均为 2026-11-15 用户实现令钦定产物）。
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

- 需求/裁决：`01-产品理念终稿/`（2026-11-15 两份 + 2026-11-17 R-111/R-112 + 2026-11-18
  R-113~R-118 需求草案）→ `02-变现文档包/00-README.md`（方案 A/B）→ `01-PRD` →
  `02-数据模型与API设计` → `07-系统架构与选型ADR`。
- 技术追溯：`05-系统架构设计/`（DESIGN.md / 存储评审 R1–R10 / 五维复审 V1–V16 /
  实现决策记录 IM-1~IM-33 / 评审案：网易云导入器、多用户并发与封面缓存、netease 元数据补全、
  地理渲染引擎选型、搜索分字段定向、爬取限流对策、星图漫游与双维筛选）+ `页面数据元关系图谱.md`。
- 设计参考实施：`03-设计参考-Radiooooo`（v1.3，§5.5 波次表）+ 评审案 =
  主线仓 `docs/design-refs-review.md`（Q1~Q14）与 `docs/iteration-batch3-review.md`。
- 前端实现：`07-前端设计包/00-README.md` → `01-设计系统PRD` → MASTER.md（token 唯一来源）
  → `02-前端实现拆分方案.md`（实现与派工事实源）。
- 执行排期：`06-PM排期与研发可持续性计划.md` +
  `06-PM排期-展示升级专项-2026-11-18.md`（展示升级四批 + 展示质量门八项 + 54 裁决点）。

---
*同步：ZCode · 2026-11-27（全量同步会话：双分支远端核验 + check 318/318 复证与门禁可重复性
修复 + 看板 lastSync/daily 收口 + 随行 AGENTS 与 RESTORE 按实况重同步 + 重部署） ·
来源 = 本工作区实况*
*（根 AGENTS.md + musicgraphy/AGENTS.md + 遗留仓 AGENTS.md + 文档包 04-源文档/AGENTS.md
+ 文档包 00-工作区关系与硬约束.md（v1.5）+ 08-进度看板/看板更新协议.md + progress-data.js
实况（83 卡）+ daily-reports.js + workspace-context/RESTORE.md）*
