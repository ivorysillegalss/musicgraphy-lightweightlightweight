# RESTORE.md — 新工作环境全量重建指引（workspace-context 分支）

> 本分支 = `Musicgraphy-2.0-文档包` 仓 **main 全量历史** + `workspace-context/` 附件目录。
> 用户 2026-11-15 指令：「文档包包括 AGENTS.md 全量 push 到新分支，切换新工作环境
> 直接读取便可获得完全一致的开发体验」。
> 分支根目录（00-工作区关系与硬约束.md 等）= 文档包全量内容；附件在本目录。

## 0. 新环境目录布局目标

```text
<工作区根>/                          # 任意盘符目录，如 Desktop/Musicgraphy-2.0/
├── AGENTS.md                        # ← workspace-context/AGENTS-workspace-root.md
├── musicgraphy/                     # ← 同一 GitHub 仓库的 main 分支（主线代码仓）
├── Musicgraphy-2.0-文档包/          # ← 本分支根目录内容（= 文档包全量）
│   └── workspace-context/           #    本目录随行（AGENTS 副本 + tools + 本指引）
└── tools/                           # ← workspace-context/tools/（两份 ps1）
```

## 1. 重建步骤（从零到门禁全绿）

1. **克隆**（一个仓库拿全两份内容）：
   ```bash
   git clone https://github.com/ivorysillegalss/musicgraphy-lightweightlightweight.git <工作区根>/repo
   ```
   - `main` 分支 = 主线代码仓（`musicgraphy/`，HEAD `c4c6a13` 起持续顺延）。
   - `workspace-context` 分支 = 文档包全量 + 本附件目录。
2. **摆布局**：按 §0 把两份内容放到位——
   - `main` 分支工作树 → `<工作区根>/musicgraphy/`
   - `workspace-context` 分支工作树 → `<工作区根>/Musicgraphy-2.0-文档包/`
     （连同 `workspace-context/` 子目录一起保留，勿删）。
3. **放置 AGENTS.md**（完全一致开发体验的关键三件）：
   | 本分支文件 | 新环境落位 | 说明 |
   |---|---|---|
   | `AGENTS-workspace-root.md` | `<工作区根>/AGENTS.md` | 工作区根入口约束（环境/运维自包含） |
   | `AGENTS-user-memory.md` | `~/.zcode/AGENTS.md`（即 Windows `C:\Users\<user>\.zcode\AGENTS.md`） | **ZCode 用户级记忆**（2026-11-27 全量同步版：83 卡 / 318 基线 / HEAD c4c6a13 / 待裁决清单 9 项） |
   | `AGENTS-legacy-repo.md` | 仅参考，不落位 | 遗留仓 AGENTS.md 历史副本；遗留仓本体已**永久封存**（2026-11-15 用户裁决），不在任何远端 |
   - 已在档无需复制：`文档包/04-源文档/AGENTS.md`（= 本分支根 `04-源文档/`）、
     `musicgraphy/AGENTS.md`（= main 分支内）。
4. **Node v26.13.0（冻结口径，勿用其他版本）**：
   ```bash
   # 官方源（或国内镜像 npmmirror.com/mirrors/node/v26.13.0/ 同名文件）
   curl -LO https://nodejs.org/dist/v26.13.0/node-v26.13.0-win-x64.zip
   # 解压到 <工作区根>/tools/node-v26.13.0-win-x64/；每次会话前置 PATH（MSYS 风格）：
   export PATH="/c/.../tools/node-v26.13.0-win-x64:$PATH"
   node --version   # 必须 = v26.13.0，否则冻结口径被静默绕过
   ```
5. **主线安装**：`cd musicgraphy && npm install`；**esbuild postinstall 必须被允许**：
   `npm install-scripts approve esbuild`（npm 11.20.0 实测；等效 = config
   `ignore-scripts=false`）。vite build 报 esbuild 缺失即此步未生效。
6. **git 身份**：本机无全局身份时，提交一律用仓库级参数
   `git -c user.name="…" -c user.email="…" commit …`。
7. **验证**：`cd musicgraphy && npm run check`（基线 = **318/318 @ c4c6a13**，
   2026-11-27 实跑复证；Node v26.13.0）；文档包测试 `cd Musicgraphy-2.0-文档包 &&
   node --test tests/`（11 项）。
   - ⚠️ 门禁可重复性：`public/maplibre-gl-worker.mjs` 为 prebuild 派生物，已入 eslint ignores
     （c4c6a13）——若从旧提交起环境，二次 `npm run check` 会因该文件扫出 1098 条 error。

## 2. 看板线上重部署（可选）

- stage 重建纪律：**六件从 git blob 提取**（`git show "HEAD:08-进度看板/<file>" > stage/<file>`，
  免 autocrlf CRLF 污染）→ 基建两件（`static-server.mjs` / `start.sh`，start.sh 必须 LF）随行 →
  `zcode-site.mjs check <stage>` → `zcode-site.mjs deploy <stage> --site 2120913580313718784`——
  **命令从工作区根执行**（2026-11-18 实测）。
- siteId = `2120913580313718784`，domainLabel = `musicgraphy-progress-ohqn`
  （即工作区根 `.zcode-site.json` 内容；该文件刻意不入库 = 7f95537 披露先例）。
- 线上镜像：https://musicgraphy-progress-ohqn.zai-ai.site（公开无密钥，已接受）。
- 部署记录：2026-11-16 = 2121999319969476608；2026-11-18 = 2122744373392732160；
  2026-11-27 = 2125993859788169216（线上双数据文件 sha256 与 git blob 逐字节一致）。

## 3. 权威序与开工三读（不变）

- 裁决顺序：用户指示 > 文档包《00-工作区关系与硬约束.md》> `musicgraphy/AGENTS.md`
  > 工作区根 `AGENTS.md` > 看板 notes。
- 开工三读：① 00-工作区关系与硬约束 → ② 看板最新内容（重读）→ ③ 主线 AGENTS.md +
  `git log`/`git status`。

## 4. 本分支不含的东西（如实披露）

- **遗留仓本体**（`Musicgraphy-2.0-代码库/`）：永久封存仅本地存档，不入远端；
  其 AGENTS.md 历史副本已随行（见 §1.3 表）。
- **Node 便携 zip 二进制**：体积原因不入库，按 §1.4 从官方/镜像源下载同版本即可
  （冻结口径 = v26.13.0）。
- **主线代码**：不在本分支——走同仓 `main` 分支（历史完全独立，属正常双分支结构）。
- **`.zcode-site.json` / `.zcode/` 会话态**：刻意不入库，内容已写进 §2。

## 5. 后续同步约定

- 文档包更新 = 测试 → 提交 → 看板变更时重部署（**直接提交 `workspace-context` 并 push**；
  2026-11-17 起实际内容流）。本地 `main` 为旧收口分支（内容落后、无独有内容、永不 push）。
- **Agent 约束类随行件必须同步**（2026-11-27 用户令）：根 `AGENTS.md` →
  `AGENTS-workspace-root.md`；`~/.zcode/AGENTS.md` → `AGENTS-user-memory.md`；
  看板 `meta.lastSync` / daily `meta.lastEntry` 同步更新——变更即复制 + 提交 + push。
- 用户级记忆（`~/.zcode/AGENTS.md`）以工作区实况为准同步（其文件头自带同步时间戳）。
- **数据文件不随行**（2026-11-27 用户口径）：SQLite DB / 封面 / backups 不入云端，
  新环境按需重导入。
