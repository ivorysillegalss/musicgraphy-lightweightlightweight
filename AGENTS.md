# AGENTS.md — musicgraphy 主线仓 · agent 工作约定

> 任何 agent 在本仓库工作（实现/修复/重构）都必须遵守本文件。
> 文档事实源 = 同级 `../Musicgraphy-2.0-文档包/`（索引：00-文件目录说明.txt）。

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

## 3. 进度看板强制更新（本仓 agent 的硬性义务）

**实现完成后，必须立即更新进度看板对应卡片**——这是交付的一部分，未更新 = 未交付：

- 文件：`../Musicgraphy-2.0-文档包/08-进度看板/progress-data.js`（唯一数据源，
  只改自己那张卡片的 `status / desc / evidence / updated`；`index.html`/`app.js` 禁改）。
- 开工置 `in_progress`；完成置 `done` 且 `evidence` 必须可核查
  （命令数字/测试计数/commit/实测值），并附当天日期；受阻置 `blocked` 并写明原因。
- 协议全文：`../Musicgraphy-2.0-文档包/08-进度看板/看板更新协议.md`。
- 领取哪张卡，先看看板 W1 区。当前实况（2026-11-12）：W1-2 元数据代理已完成（7c79b40）；
  W1-1 鉴权 / W1-3 封面落盘 / W1-4 垂直切片 / W1-5 启动备份均有未提交在制品——
  续作前先核对 git status 与 npm run check 基线，避免与他人冲突。

## 4. 并行会话纪律

- 本项目曾实测多会话并行交叉编辑：**动手前先重读目标文件最新内容**，
  小步 Edit，不整文件重写；不覆盖他人未提交改动。
- 在制品（未提交）要在看板 evidence 里如实标注，提交前先跑 `npm run check`。
- 新实现期决策 → 追加到 `../Musicgraphy-2.0-文档包/05/实现决策记录.md`
  （编号 IM-10 起，只增不改旧记录）。
