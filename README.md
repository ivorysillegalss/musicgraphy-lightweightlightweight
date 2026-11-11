# Musicgraphy 2.0

个人音乐专辑档案。架构：Node 26 单进程 + `node:sqlite` + Hono（`@hono/node-server`）+ SSR HTML（`hono/html`）+ 原生 TS 岛屿。决策依据见 `../Musicgraphy-2.0-文档包/05-系统架构设计/`（DESIGN.md / 07-ADR / 两轮评审报告）。

## 本机工具链（portable）

Node v26.13.0 解压于 `../tools/node-v26.13.0-win-x64/`（不写入系统 PATH）。所有 npm/node 命令需前置：

```bash
export PATH="/c/Users/Administrator/.zcode/workspace/draft-8e6cfbb0-0eb1-401d-b0b0-e96203f0ba8a/tools/node-v26.13.0-win-x64:$PATH"
```

## 常用命令

```bash
npm.cmd run migrate        # 建表（PRAGMA user_version 迁移）
npm.cmd run seed           # 5000 条开发数据
npm.cmd run dev            # tsx watch 启动（默认 127.0.0.1:3000）
npm.cmd run check          # typecheck + lint + build + test（AGENTS §14 三件套 + 测试）
npm.cmd run spike:sqlite   # node:sqlite 特性 spike
npm.cmd run spike:mb       # MusicBrainz / Cover Art Archive 可用性 spike
```

生产启动（进程守护参数，ADR-006/复审 V8）：`node --max-old-space-size=64 dist-server/server.js`——W0 阶段 dev 直接跑 tsx。
