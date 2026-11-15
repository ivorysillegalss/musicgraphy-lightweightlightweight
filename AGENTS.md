# AGENTS.md — musicgraphy 主线仓 · agent 工作约定

> 任何 agent 在本仓库工作（实现/修复/重构）都必须遵守本文件。
> 文档事实源 = 同级 `../Musicgraphy-2.0-文档包/`（索引：00-文件目录说明.txt）。
> **工作区地图与硬约束（目录关系/遗留仓只读/看板强制/并发现实）见
> `../Musicgraphy-2.0-文档包/00-工作区关系与硬约束.md`——开工前先读它。**

## 1. 仓库身份与硬约束（改动前必读）

- 本仓 = Musicgraphy 2.0 唯一主线代码仓（方案 B · 12 周验证冲刺）。
  `../Musicgraphy-2.0-代码库/` 为遗留存档仓（V10 鉴权实现 + D2 spike 报告在此，
  W1-1 鉴权从它移植）——**不得合并/删除/改动，归属调整须用户裁决**。
- 架构红线：SQLite(node:sqlite) + Hono + SSR 岛屿；运行时依赖 ≤ 2
  （hono + @hono/node-server，devDeps 不占预算）；RSS < 100MB；
  DAO < 200 行（ADR-002 护栏）；hono/html 禁 raw 插用户数据；无 JS 基线。
- 关键规格出处：五维复审 V1–V16 与存储评审 R1–R10
  （`../Musicgraphy-2.0-文档包/05-系统架构设计/`）；实现决策 IM-1~IM-9
  （`05/实现决策记录.md`，只增不改）。

## 2. 完成定义（DoD）

`npm run check` 全绿（tsc / eslint / vite build / node:test）方可视为实现完成。
环境：Node v26.13.0 portable，工作区 `tools/node-v26.13.0-win-x64/`（命令前置 PATH）。

## 3. 进度看板强制更新（用户强制约束 · 2026-11-12）

**本工作区做的任何工作，完成之后必须立即同步进度看板——未同步看板 = 未完成交付。**
此为用户明确强制约束（2026-11-12），对所有 agent（主会话或子 agent）无例外适用：

- 文件：`../Musicgraphy-2.0-文档包/08-进度看板/progress-data.js`（唯一数据源，
  只改自己那张卡片的 `status / desc / evidence / updated`；`index.html`/`app.js` 禁改）。
- 开工置 `in_progress`；完成置 `done` 且 `evidence` 必须可核查
  （命令数字/测试计数/commit/实测值/行数），并附当天日期；受阻置 `blocked` 并写明原因。
- 置 done 前置条件：`npm run check` 全绿。
- **以代码为事实源**：看板与代码不一致时，以仓库当前状态为准修正看板
  （evidence 注明复核日期）；复核至少覆盖行数/测试数/依赖数等可实测项。
- 协议全文：`../Musicgraphy-2.0-文档包/08-进度看板/看板更新协议.md`。

> 当前实况（2026-11-12 收口复核，以代码为准）：W0 全 done；W1 全 done
> （HEAD 68f8f69，check 27/27，git status 干净，运行时依赖=2）；W2 起全部 pending。
> 领取新卡前先重读 progress-data.js 最新内容（并行会话交叉编辑频发）。

## 4. 并行会话纪律

- 本项目曾实测多会话并行交叉编辑：**动手前先重读目标文件最新内容**，
  小步 Edit，不整文件重写；不覆盖他人未提交改动。
- 在制品（未提交）要在看板 evidence 里如实标注，提交前先跑 `npm run check`。
- 新实现期决策 → 追加到 `../Musicgraphy-2.0-文档包/05/实现决策记录.md`
  （编号 IM-10 起，只增不改旧记录）。
