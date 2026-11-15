# AGENTS.md — Musicgraphy 2.0 工作区入口约束（自包含）

> 本文件 = 工作区根级 agent 入口说明（2026-11-13 归档整理）。
> 目标：**不依赖本机环境与任何会话记忆**，凭本工作区内的文件即可恢复全部上下文并继续开发。
> 权威顺序：用户指示 > `Musicgraphy-2.0-文档包/00-工作区关系与硬约束.md`（工作区关系唯一权威）
> > `musicgraphy/AGENTS.md`（主线仓纪律）> 本文件（环境/运维补充）> 看板 notes。
> 本文件不重复权威文件内容，只补其缺口；冲突时以权威序高者为准。

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
  同批废止）——详见文档包 00-硬约束 v1.3 + 05/实现决策记录 IM-30。

## 2. 工作区根级文件清单（归档快照 2026-11-13）

| 项 | 说明 |
|---|---|
| `AGENTS.md` | 本文件 |
| `Musicgraphy-2.0-文档包/` | 文档事实源（自述见其 `00-文件目录说明.txt`） |
| `musicgraphy/` | 主线代码仓（HEAD 4aa10b1 + 未提交在制品，见 §5） |
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
  零依赖 node:test）——9 项可用性断言（看板数据结构/依赖引用完整性/渲染三件套/事实源在档/
  登记完整性）。**所有文档/卡片修改完毕后必须先过测试再 git 提交**；测试红 = 不得提交。
- **文档包 git 仓（2026-11-14 用户新建）**：`Musicgraphy-2.0-文档包/` = 独立 git 仓
  （分支 `main`，基线 a0a4012，提交身份 `agent@musicgraphy.local`）。**新原则：所有卡片/文档
  修改完毕后过测试 → git 提交**（message 带卡片号；只 add 本次变更文件）——测试红或未提交 = 未交付；
  收口顺序 = 单元测试 → git 提交 → 线上重部署（看板数据变更时）；`/.zcode/` 已 ignore。
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
- **看板线上部署**：`progress-data.js` 每次更新后**必须重部署**才反映线上。
  stage = 工作区根 `.zcode-site/stage/`（看板三文件 + `static-server.mjs` + `start.sh`，
  SITE_DIR=. SPA_FALLBACK=0）；程序 = 从源三文件重建 stage（禁 patch 旧 stage）→
  ZCode Site CLI 部署（siteId 2120913580313718784，CLI =
  `<plugins>/zcode-site/0.4.2/scripts/zcode-site.mjs`）。链接公开无密钥
  （进度数据可被任何持链者查看——已接受）。

## 5. 归档时刻状态快照（2026-11-13，以代码实况为准）

- **主线仓** HEAD `4aa10b1`；测试基线 62/62（W3-1 时点工作树）；运行时依赖 = 2
  （hono + @hono/node-server）；RSS boot 73–94MB < 100MB。
- **主线工作树未提交（W4-6-2 找回闭环交付，勿代作主张提交）**：
  `docs/find-scenario.md`、`docs/find-scenario-screenshots/`、`tests/perf-like.test.ts`；
  另 `AGENTS.md` 有未提交改动（= 00 文档头部指引，归属 00 文档成文会话）。
  filter-cabin.ts 的 W4-6-2 改动（300ms 防抖 + popstate 守卫）已随 W3-1 提交
  `4aa10b1` 入库（提交说明已披露）。
- **遗留仓工作树未提交**（W2-2 元数据域落点 + AGENTS/README/context 等）——
  同为存档快照的一部分，与主线未提交件一样**是否提交由用户裁决**。
- **看板**：W0（6 卡）/ W1（10 卡）/ W2（2 卡）/ W3-1 全 done；W4-6-2、W4-6-3 done；
  pending = W4-6-1、W7-9-1、W10-12-1；护栏 G1–G4 watch。
- **下一步执行序**（事实源 = 文档包 `07-前端设计包/02-前端实现拆分方案.md` §8）：
  T0✅ → P2✅ → P1✅ → P3✅ → **B1 联想域 → B2 导出域 → B3 仪表域**（第三波后端
  prompt 已备好，标「待用户追认」）。

## 6. 待用户裁决清单（agent 只能备案产出评审案，不能自决）

> **2026-11-15 用户裁决令「修复 D1-D4」收口**：第 1 项（双仓归属）= **永久封存**；第 2 项
> （alias_sources 编码归一）= 主线对象数组唯一权威、遗留仓形态冻结；第 7 项（未提交在制品）
> = 主线两笔入库（3378964 W4-6-2 三件 + b3ff02c AGENTS.md）；D1 页面守卫缺口已修复
> （主线 c9e1692，check 173/173 全绿，IM-27 登记）。第 3/4/5/6 项（IM-14/15/16/17）此前已
> 随追认令/实现闭环关闭。清单清零；后续新裁决项在此追加。

1. **双仓归属/合并**：`musicgraphy/`（主线）vs `Musicgraphy-2.0-代码库/`（遗留存档）。
2. **alias_sources 编码归一**：主线 = 对象数组；遗留仓 = `"source:source_id"` 字符串
   （shared/types.ts 冻结 string[]）。
3. **IM-14**：CSS 产物 19.02KB（gzip 4.37）超 15KB 预算线——建议接受待追认
   （`05-系统架构设计/实现决策记录.md` §7）。
4. **IM-15**：add-dialog 岛屿 149 行贴线（达标，登记备查）。
5. **IM-16**：P1-5「最近艺术家联想」未渲染（主线 DAO 缺方法）→ B1 提前执行待追认；
   缺口报告 = `musicgraphy/docs/associations-gap.md`。
6. **IM-17**：jpeg-js 进 devDeps 待追认（运行时依赖仍 = 2，G1 已注记）。
7. **未提交在制品的提交时机**（主线 W4-6-2 三件 + 遗留仓 W2-2 落点）。

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

## 8. 深入阅读顺序（按需）

- 需求/裁决：文档包 `01-产品理念终稿/` → `02-变现文档包/00-README.md`（方案 A/B）→
  `01-PRD` → `02-数据模型与API设计` → `07-系统架构与选型ADR`。
- 技术追溯：`05-系统架构设计/`（DESIGN.md / 存储层评审 R1–R10 / 五维复审 V1–V16 /
  实现决策记录 IM-1~IM-20）。
- 前端实现：`07-前端设计包/00-README.md` → `01-设计系统PRD` → MASTER.md（token 唯一
  来源）→ `02-前端实现拆分方案.md`（实现与派工事实源）。
- 执行排期：`06-PM排期与研发可持续性计划.md`。
