# AGENTS.md — Musicgraphy 2.0 工作区入口约束（自包含）

> 本文件 = 工作区根级 agent 入口说明（2026-11-13 归档整理；**2026-11-27 全量同步会话更新**：
> HEAD/门禁基线/看板计数/部署与随行口径按实况校准，并补齐 2026-11-15~18 实现潮与展示质量条款）。
> 目标：**不依赖本机环境与任何会话记忆**，凭本工作区内的文件即可恢复全部上下文并继续开发。
> 权威顺序：用户指示 > `Musicgraphy-2.0-文档包/00-工作区关系与硬约束.md`（工作区关系唯一权威）
> > `musicgraphy/AGENTS.md`（主线仓纪律）> 本文件（环境/运维补充）> 看板 notes。
> 本文件不重复权威文件内容，只补其缺口；冲突时以权威序高者为准。
>
> ⚠️ **2026-11-18 用户钦定最高权重：展示质量条款生效**（00-硬约束 v1.5 §二.10）——一切 UI
> 产出的展示质量与 check 全绿为同级交付门槛（token 唯一来源 / UI 批次展示质量门八项 /
> 动效感官层门控 / ui-ux-pro-max 方法论前置 / 实测复校）。任何 agent 做前端工作前必读该条款。

---

## 1. 这是什么工作区（30 秒版）

- **项目**：Musicgraphy 2.0，个人音乐线索库 Web 应用（个人专辑档案 + 线索回响）。
- **执行主线**：方案 B（增长验证优先）· 12 周验证冲刺；PM 排期锚点 W0 = 2026-11-16，
  **实际实现超前于日历**（W0 已于 2026-11-11 完成，截至归档日 W0–W3 + W4-6-2/W4-6-3 全部 done）。
- **三层结构**：
  | 层 | 位置 | 说明 |
  |---|---|---|
  | 文档事实源 | `Musicgraphy-2.0-文档包/` | PRD / 数据模型 / ADR / 评审存档 / PM 排期 / 设计包 / 拆分方案 / 看板；索引 = `00-文件目录说明.txt` |
  | 唯一开发位 | `musicgraphy/` | git 主线仓，一切代码只写这里 |
  | 只读存档 | `Musicgraphy-2.0-代码库/` | 遗留仓：D2 spike 报告（docs/spike-d2.md）、冻结 DAO 契约（dao/interface.ts 十方法）、V10 鉴权参考实现；**禁写禁删；2026-11-15 用户裁决 = 永久封存**（原样只读保留，不迁移不合并不删除；D3 alias_sources 以主线对象数组为唯一权威，登记 = 文档包 00 硬约束 v1.2 + 02/12 号文档 §5） |
- **进度唯一事实源** = `Musicgraphy-2.0-文档包/08-进度看板/progress-data.js`
  （线上镜像 <https://musicgraphy-progress-ohqn.zai-ai.site>）。
- **开工三读**：① `00-工作区关系与硬约束.md` → ② 看板最新内容（重读）→ ③ 主线 `AGENTS.md` + `git log`/`git status`。
- **核心架构红线**（**2026-11-15 用户批注修订 = IM-30**）：SQLite(node:sqlite) + Hono；
  hono/html 禁 raw 插用户数据；全局串行限流 ≥1s；备份 = VACUUM INTO；隐私红线 +
  资产自托管零 CDN。~~运行时依赖 = 2~~ / ~~SSR 岛屿（无 JS 基线）~~ / ~~RSS < 100MB~~ /
  ~~DAO < 200 行~~ 已废止（转观察指标；IM-14 CSS 预算、首屏 JS 预算、IM-19、无 hydration
  同批废止）——详见文档包 00-硬约束 **v1.5**（§二.4 红线 + **§二.10 展示质量条款**：
  与 check 全绿同级交付门槛）+ 05/实现决策记录 IM-30/IM-33。

## 2. 工作区根级文件清单（2026-11-27 校准）

| 项 | 说明 |
|---|---|
| `AGENTS.md` | 本文件 |
| `Musicgraphy-2.0-文档包/` | 文档事实源（自述见其 `00-文件目录说明.txt`） |
| `musicgraphy/` | 主线代码仓（origin/main HEAD `9fbc513`，工作树干净；check 318/318，见 §5） |
| `Musicgraphy-2.0-代码库/` | 遗留存档仓（只读；工作树含未提交改动 = 存档快照的一部分，同样不得擅动） |
| `tools/node-v26.13.0-win-x64.zip` | 便携 Node 安装包（解压后即运行时，见 §3） |
| `tools/rezip-docpackage.ps1` | 文档包 zip 重建脚本（UTF-8 条目名 + 排除 .zcode + 回读自检） |
| `tools/rezip-workspace.ps1` | 工作区全量归档脚本（2026-11-13 新增） |
| `Musicgraphy 2.0 新版产品理念（终稿）.md` | 根级副本；**权威 = 文档包 `01-产品理念终稿/`** |
| `Musicgraphy-2.0-文档包.zip` | 文档包同步导出（重建法见 §4） |
| `变现文档包/` `review/` `docs/` `LIKE全扫` `-p` | 历史杂项 / 早期副本 / 误建文件，**非事实源**；清理须用户裁决 |
| `.zcode-site.json` | 看板线上部署 siteId 记录（2120913580313718784） |

## 3. 环境重建（新机器从零跑通）

1. **Node v26.13.0（冻结口径，勿用其他版本）**：解压 `tools/node-v26.13.0-win-x64.zip`
   至 `tools/node-v26.13.0-win-x64/`（目录名与文档引用一致）；所有命令前置 PATH，不写系统 PATH：
   ```bash
   export PATH="/<解压目标>/tools/node-v26.13.0-win-x64:$PATH"
   ```
2. **主线安装**：`cd musicgraphy && npm install`（package-lock.json 在）。
   **esbuild 的安装脚本必须被允许**（vite build 依赖其 postinstall 产物）：
   本环境实测命令 `npm install-scripts approve esbuild`（npm 11.20.0）；等效状态 =
   `.npmrc`/config `ignore-scripts=false`（本仓实测值 false）。若 `vite build` 报
   esbuild 二进制缺失/版本不符，即此步未生效。
3. **git 身份**：本机无全局 git 身份，提交用仓库级参数
   `git -c user.name="..." -c user.email="..." commit ...`。
4. **门禁**：主线仓 `npm run check`（typecheck + eslint + vite build + node:test）；
   当前基线见 §5。
5. **遗留仓**：默认只读不动。如需验证其存档状态（历史 79/79），同样 npm install + check，
   但任何写操作都须用户裁决。
6. **Python 3.12 + scrapling（2026-11-14 新增，skill 运行时配套）**：winget 用户级安装
   （免管理员，不写系统 PATH）：
   `winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements`
   → `C:/Users/13762/AppData/Local/Programs/Python/Python312/`（PrependPath 只写用户 PATH，
   新开终端生效；既有会话直接用绝对路径前调）。scrapling（`~/.zcode/skills/scrapling/` 配套）
   **钉版本 0.4.9**：`python -m pip install "scrapling[fetchers]==0.4.9"` + `scrapling install`
   （浏览器引擎）。**勿装 0.5.x**：0.5（2026-10）重写了 Response API 且移除 DynamicFetcher，
   与 skill 文档不兼容。playwright 大文件下载慢时前置
   `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/`。
   详见 `_downloads/SKILLS-INSTALLED.md`。

## 4. 运维程序（zip 重建 / 看板 / 线上部署）

- **文档包 zip（2026-11-14 起降级）**：仅**用户显式要求**时执行，工作区根
  `powershell -ExecutionPolicy Bypass -File tools/rezip-docpackage.ps1`
  （.NET ZipArchive；UTF-8 条目名；排除 `.zcode/`；末尾回读自检输出 entries/泄漏数）；默认收口不做。
- **文档包单元测试（2026-11-14 用户新原则）**：文档包内 `node --test tests/`（cwd = 文档包根，
  零依赖 node:test）——11 项可用性断言（看板数据结构/依赖引用完整性/渲染三件套/事实源在档/
  登记完整性）。**所有文档/卡片修改完毕后必须先过测试再 git 提交**；测试红 = 不得提交。
- **文档包 git 仓（2026-11-14 用户新建；2026-11-16 起工作树 = `workspace-context` 分支）**：
  `Musicgraphy-2.0-文档包/` = 独立 git 仓（origin = 同 GitHub 仓；提交身份
  `agent@musicgraphy.local`）。**内容修改直接提交 `workspace-context` 并 push**（2026-11-17 起
  实际内容流；附件目录零冲突）；本地 `main` 是旧收口分支（`ddea53b`，内容落后、永不 push、
  不作事实源）。收口顺序 = 文档包测试 → git 提交 → 看板数据变更时线上重部署；
  `/.zcode/` 已 ignore。
- **⚠️ 禁用 `tar.exe`/bsdtar 重建任何 zip**：2026-11-12/13 两轮实测，中文 locale 下
  bsdtar 把非 ASCII 条目名写成 GBK、`-f` 输出文件名同样被 GBK 化（磁盘出现乱码名），
  且 `.zcode/` 会话状态会泄漏进包。ps1 是唯一可靠路径。
- **ps1 编码纪律**：含中文的 ps1 必须 UTF-8 **with BOM**（PowerShell 5.1 无 BOM 按
  ANSI/GBK 读，必炸）；辅助校验脚本一律**纯 ASCII + 通配路径**（中文路径进 GBK 解析的
  ps1 必炸）。
- **工作区全量归档**：`powershell -ExecutionPolicy Bypass -File tools/rezip-workspace.ps1`
  ——生成整个工作区归档 zip（排除 `.zcode/`、`.zcode-site/`、各仓 `node_modules/`、
  tools 解压版目录与 zip 产物本身；恢复方法 = §3 环境重建）。
- **看板更新**：只改 `progress-data.js` 对应卡片的 `status/desc/evidence/updated` 四字段
  （协议 = `08-进度看板/看板更新协议.md`）。**完成即同步，未同步 = 未交付**
  （用户 2026-11-12 钦定，对所有 agent 无例外）。置 done 前置 = `npm run check` 全绿；
  evidence 必须可核查（数字/路径/hash）；看板与代码不一致时以代码为准修正。
  语法自检：`node -e "global.window={};require('./08-进度看板/progress-data.js');console.log('ok')"`（cwd = 文档包根）。
- **看板线上部署**：`progress-data.js` / `daily-reports.js` 每次更新后**必须重部署**才反映线上。
  stage = 工作区根 `.zcode-site/stage/`（**六件** index.html / app.js / progress-data.js /
  daily.html / daily.js / daily-reports.js + `static-server.mjs` + `start.sh`，
  SITE_DIR=. SPA_FALLBACK=0）。程序 = **重建全新 stage（禁 patch 旧 stage）**：六件用
  `git show "HEAD:08-进度看板/<file>" > stage/<file>` 从 git blob 提取（字节级 = 仓库 LF 口径，
  免 autocrlf 污染；工作树直拷是 CRLF 会比线上每行多 1 字节），基建两件原样随行（start.sh 必须 LF）
  → `zcode-site.mjs check <stage>` → `zcode-site.mjs deploy <stage> --site
  2120913580313718784`——**命令必须从工作区根执行**（2026-11-18 实测）。siteId
  2120913580313718784，CLI = `<plugins>/zcode-site/0.4.2/scripts/zcode-site.mjs`
  （0.5.0 同装；以实测可用版本为准）。链接公开无密钥（进度数据可被任何持链者查看——已接受）。
- **部署记录**：2026-11-16 = 2121999319969476608；2026-11-18 = 2122744373392732160；
  **2026-11-27 = 2125994850625380352**（线上 progress-data.js sha256 `e54ee770…` /
  daily-reports.js `32410057…` = git blob 逐字节一致；同日前次部署 2125993859788169216 已被
  日报勘误笔取代）。

## 5. 状态快照（2026-11-27 全量同步会话实况，以代码/看板为准）

- **主线仓** HEAD `c4c6a13`（= 9fbc513 + 2026-11-27 门禁可重复性修复；origin/main 一致），
  工作树干净、无 stash；`npm run check` **318/318** 全绿实跑复证（tsc/eslint/vite build/node:test，
  Node v26.13.0）；运行时依赖 = 3（hono / @hono/node-server / maplibre-gl，观察指标）；
  main.css 24,319B（观察指标）。
- **门禁可重复性修复（2026-11-27）**：`public/maplibre-gl-worker.mjs` 为 prebuild 派生物
  （519KB，gitignored，源 node_modules）——此前首轮 build 落盘后，二次 `npm run check` 的
  `eslint .` 会把它当源码扫出 1098 条 error，check 在 lint 步必红（管道 tail 吞退出码故此前
  未暴露）。修复 = `eslint.config.js` ignores 增 `'public/**'` 一行；修复后全量 check 可重复。
- **文档包** = `workspace-context` 分支（`d8b6a2d` + 2026-11-27 同步收口笔）；
  `node --test tests/` 11/11 绿。本地 `main`（ddea53b）为旧收口分支，内容落后、**永不 push**、
  不作事实源。
- **看板** 7 tracks × 83 卡 = **done 66 / pending 12 / watch 4（G1–G4）/ blocked 1**；
  lastSync = 2026-11-27。
  - pending 12 = S2-4~S2-7（设计参考四站总卡）+ S2-32（爬取限流）+ S2-33（多用户账户）+
    S2-36~S2-41（展示升级六批，待 PM §8 裁决点批文）。
  - blocked 1 = B10（netease 元数据补全）：本环境 DB 为 11-13 前快照；**用户 2026-11-27
    明确 DB/封面不纳入云端同步范围**，维护 blocked 状态；旧机 DB 搬运 or 重导入仍待裁决。
- **2026-11-15~18 实现潮（均已收口，看板与日报同步）**：
  1. 11-15 Radiooooo 地图 0→1 → `/atlas`（S2-28）；设计参考第一/二批 16 卡 done
     （`/panorama` `/crate` `/random` `/genres` + preview/audio-viz/genre-scan）；B5 导入
     实况 fetched=188/imported=181（IM-31/32）。
  2. 11-16 发布后迭代第三批 `d8653d0`（S2-1 `/topsters/about`、S2-29 登录态+logout、
     S2-30 封面墙下拉、S2-31 筛选 details 收纳），check 273/273。
  3. 11-17 S2-2 搜索分字段（方案 b，`34d4837`，check 318/318 = 273+45）；S2-28 验收实跑修
     两缺陷（五态 match 平铺 `b6ca383` + worker 404 `ff0a187`/`6f17795`）；S2-34 页面×数据元
     关系图谱；S2-32/S2-33 双专项登记（R-111/R-112，评审案随批）。
  4. 11-18 展示升级专项（R-113~R-118）：需求草案 + 五路分析件 + PM 排期四批 + 00-硬约束
     v1.5 §二.10 展示质量条款 + 看板 S2-35~S2-41 七卡（S2-35 done，余待裁决）。
- **SHIP 余项**：landing / 赞助链接 / 全渠道发布 + W12 决策门——均在用户手上。

## 6. 待用户裁决清单（agent 只能备案产出评审案，不能自决；2026-11-27 同步会话整理）

> 已销项（2026-11-14/15 落地）：双仓归属=永久封存、alias_sources=D3 了结、IM-14/15/16/17、
> B1–B3 追认令、B4/B5/B7 派工令、P1-10/W10/W11 批准、未提交在制品提交时机。以下为现行清单。

1. **7f95537 归属澄清追认**（B5 会话文档件随 Topster 收口捎带入库，提交说明误标）。
2. **IM-23 同号两则补正案**（网易云评审案登记 与 P1-6 实现决策同号；IM 只增不改）。
3. **colorOf(16)/13「灰」双 chip 消歧**（涉种子库生命周期）。
4. **DR-M1 三件待追认**：① MapLibre GL JS 引擎裁决（评审案-地理渲染引擎选型）
   ② maplibre-gl 入 dependencies（运行时依赖 2→3 = 观察指标）③ `/atlas` 页面挂载。
5. **b180dd7 捎带并行 globe 文件待追认**（7f95537 同族）。
6. **R-103 React 接入实施立项**：方向已裁决（2026-11-18「充分利用 react 和 js」= S2-3 P0
   批文）；实施须评审案 + 红线修订（S2-37 React 基座批）。
7. **mb-calibrate 503 墙剩余约 67 行 genres/year 补全**：冷却后重跑增量（resumable，
   无需新裁决即可重跑；用户叫停则维持现状）。
8. **展示升级专项批文**：PM 排期 `06-PM排期-展示升级专项-2026-11-18.md` §8 收拢 54 项裁决点
   ——S2-36~S2-41 实施前置（另含 R-116 星图漫游 §8 八项待裁决）。
9. **B10 数据裁决**：旧机 DB 搬运 vs 本环境重导入（DB/封面不纳入云端同步 = 用户 2026-11-27
   口径；具体执行方式仍待定）。

## 7. 踩坑备忘（实测教训，勿重蹈）

- **多会话并行**：宿主同时只能跑 1 个子 agent（实测超限报错）；同一仓库先收口提交
  再开新工作（未提交在制品会挡他人门禁与提交）；**每次 Edit 前必重读目标文件**——
  本项目跨会话交叉编辑高频发生（看板 progress-data.js 曾出现 8→10→11 条 notes
  连续膨胀，Edit 连报 "modified since read"，对策 = 等数秒 → 重读 → 小步重试）。
- **派工接单**：目标仓与依赖以 **prompt 原文 + 前置 Agent 交付实况**为第一判断依据，
  勿凭「主线 = 唯一仓」旧印象改写目标仓（W1-7/W1-8 派工落遗留仓为先例）。
- **只读指令不可靠**：对子 agent 的只读约束要用 mtime 核对验证；越权改动交用户追认，
  不擅自回滚。
- **node:sqlite 实测定案**：UNIQUE 冲突 errcode = 2067（SQLITE_CONSTRAINT_UNIQUE
  扩展码，主码 = errcode & 0xff == 19）；`PRAGMA busy_timeout` 读回列名是 `timeout`
  （IM-7）；**WAL 期裸复制 .db 连 schema 都读不到（R1）**——备份必须 VACUUM INTO
  （主案 19–21ms）/模块级 backup() 备选；json_each 计数 ~0.7–4ms。
- **e2e 细节**：boot 备份产物断言须等一拍（listening resolve 后备份才微秒级落盘，
  同 tick readdir 会竞态空读）；CSV BOM 校验须用字节比较（response.text() 剥 BOM）。
- **LIKE 查询**：5000 行种子四字段 LIKE 经 listPage 实测 1–2ms（W4-6-2），性能无忧。
- **浏览器自动化（ZCode IAB）**：输入管线会中途死亡——只读全正常而所有点击路径
  静默无效；reload 后 scrollY 归零，**坐标点击前必须确认元素在 viewport 内**
  （曾致连点视口外空白误判为网站 bug）；locator.evaluate 回调是单元素语义非数组。
- **看板并发**：多会话同时更新看板时，插入 notes 前先 `node` 自检看最新条数再重读重试。
- **命令链/管道吞退出码**（2026-11-15/16/27 三次实测）：`cmd1 && cmd2` 前置失败可能被吞；
  `cmd | tail` 的退出码 = tail 的——**2026-11-27 实测 `npm run check | tail` 把 lint 的 1098 条
  error 全遮成 exit 0**。正确写法 = 重定向到文件后 `rc=$?`，或 `PIPESTATUS`，再判分支。
- **镜像一致性口径（autocrlf）**：本机 autocrlf=true → 工作树 CRLF、git blob LF、线上 LF。
  判定「本地 vs 线上一致」必须用 **git blob hash vs 线上文件 hash**（工作树 hash 不可作判据）；
  线上比工作树少的字节数 = 行数时先疑换行符。
- **并行 worktree 约定**（2026-11-17 用户裁决 v1.4）：多会话开发一律 `git worktree add
  wt/<task-id> -b task/<task-id>`；主树 = 收口位（只 merge/push/部署）；主树被占时走 detached
  worktree + `git update-ref` 零扰动通道。worktree 只消编辑期冲突，**合并期同区域冲突仍在**
  （按「代码为事实源」+ 双方披露解决）；同内容双谱系用 cherry-pick 归并。
- **并行提交的索引假象**：在临时 worktree 提交后，主工作树索引可能残留 staged-D 假象——
  提交前 `git restore --staged` 非自己的 D 项并复核 `git diff --cached --stat` 恰为自己文件集，
  否则会毁掉他人刚提交的文件。
- **子 agent 并发上限浮动**：实测 1（2026-11-16）与 3（2026-11-18）两档，按宿主配额分批派工；
  超限报 "user concurrency limit exceeded"，补派即可。
- **GitHub 直连不稳**：21s 超时/拒连交替，数分钟后恢复；fetch 可走本地 clone 搬运通道，
  push 等恢复窗口重试（2026-11-27 实测推送正常）；部署走 ZCode Site 通道，与 GitHub 无关。
- **看板部署**：`zcode-site.mjs deploy` **必须从工作区根执行**；stage 六件从 git blob 提取
  （工作树直拷 = CRLF，线上会每行多 1 字节）。
- **图引擎（MapLibre v6）**：worker URL 由 `import.meta.url` 非字面量拼接 → vite 静态分析
  不识别 → 产物缺 worker 文件 → 运行时 404 且构造期错误无监听 = 首次实例永久静默。修复 =
  prebuild 拷 worker 进 `public/` + `setWorkerUrl` 显式指路；GPU 侧 style 表达式校验只在浏览器
  运行时发生（node:test 结构断言抓不到），`match` 分支标签只接受数字/字符串。
- **ZCode IAB 补充**（2026-11-17/18）：截图合成器可能产生伪影（以 DOM 状态为准）；
  异步 `evaluate` 结果不 await 会读到旧值（用 `window` 暂存 + 同步轮询）；调试钩子
  `window.__mgMap` 可直读引擎内部。

## 8. 深入阅读顺序（按需）

- **需求/裁决**：文档包 `01-产品理念终稿/`（含 2026-11-15 两份 + 2026-11-17 R-111/R-112 +
  2026-11-18 R-113~R-118 需求草案）→ `02-变现文档包/00-README.md`（方案 A/B）→
  `01-PRD` → `02-数据模型与API设计` → `07-系统架构与选型ADR`。
- **技术追溯**：`05-系统架构设计/`（DESIGN.md / 存储层评审 R1–R10 / 五维复审 V1–V16 /
  实现决策记录 IM-1~IM-33 / 评审案：网易云导入器、多用户并发与封面缓存、netease 元数据补全、
  地理渲染引擎选型、搜索分字段定向、爬取限流对策、星图漫游与双维筛选）+ `页面数据元关系图谱.md`。
- 前端实现：`07-前端设计包/00-README.md` → `01-设计系统PRD` → MASTER.md（token 唯一
  来源）→ `02-前端实现拆分方案.md`（实现与派工事实源）。
- 执行排期：`06-PM排期与研发可持续性计划.md`。
