# 07-前端设计包 · README

> v1.2 · 2026-11-15 · 角色：前端设计师 · 方法论：ui-ux-pro-max skill（v2.15.0）工作流
> （v1.2：新增 03-设计参考-Radiooooo 外部站点拆解档）

## 这是什么

Musicgraphy 2.0 的**设计侧交付包**：设计系统 PRD + 可双击评审的基础设计页面 + **前端实现拆分方案（F0 骨架交付记录 + F1–F4 子 Agent 派工 prompt）**。

- 工程 PRD（`02-变现文档包/01`）管"做什么 / 做到什么数值"；
- 本包管"长什么样 / 怎么动 / 凭什么这样设计 / 按什么顺序实现"。
- 两文冲突时：功能与验收数值以工程 PRD 为准，视觉与交互实现以本包为准。

## 快速开始

1. 先读 `01-设计系统PRD.md` §0–§2（立场 + 证据链）；
2. 浏览 `pages/index.html`（静态设计稿，双击可开）；
3. **实现阶段读 `02-前端实现拆分方案.md`**——F0 骨架契约（代码库已交付）+ F1–F4 自包含派工 prompt；
4. 实现期以 `design-system/musicgraphy/MASTER.md` 为 token Source of Truth
   （代码实现 = 代码库 `src/client/styles/tokens.css` + `app.css`）。

## 可交互演示点

- `collection.html`：筛选舱 chips 实时计数（轴排除式 facet 计数）、激活/移除、空态、`/` 聚焦搜索、全文检索过滤。推荐体验 PRD 里的经典找回路径：Genre「Electronic」→ 我听的时期「2010–2013」→ 颜色「蓝」→ 收敛到 2 张。
- `add-flow.html`：打开 Add 弹层，体验 Favorite 开关（`F` 键）、Tag 最近使用一键挂载、Note 折叠框、听期快捷选择、落库 toast、Esc 关闭。
- `album-detail.html`：重听动作 toast、双区布局与第一人称记忆条。

## 方法论执行记录（ui-ux-pro-max）

```
--design-system（--variance 3 --motion 3 --density 6 --persist）
→ domain 复核：product（Bookmark & Read-Later 同类行）/ color（Warm ink + amber on cream）
  / typography（Classic Elegant + mono 层）/ ux（chips reflow · live badge · label semantics）
→ fit 校准三条裁决（配色降红 / 字体换栈 / 对比度修正）→ MASTER.md 定稿
→ 检索日志全文：01-设计系统PRD.md 附录 A
```

## 目录

```
07-前端设计包/
├── 00-README.md                    本文件
├── 01-设计系统PRD.md                设计侧需求文档（主交付）
├── 02-前端实现拆分方案.md            分步实现 + F0 骨架契约 + F1–F4 子Agent prompt（实现事实源）
├── 03-设计参考-Radiooooo-2026-11-15.md  外部站点技术拆解（音频管线/Canvas 可视化/Mapbox 地球展现——
│                                       设计参考素材，非需求；实施引用须走评审案）
│                                       · v1.1 增 §5 模拟实现 0→1 草案卡 DR-G/M/A/V/I 线 14 张
│                                         （落点/依赖/规模/波次建议——供 PM 排期分析，未建看板卡）
│                                       · v1.2 增 §5.5 PM 排期登记：地图模块 0→1 复现收敛排期
│                                         （DR-M0 契约先行 + 五步波次 + 换实现零改地图 DoD）
├── design-system/musicgraphy/
│   ├── MASTER.md                   设计系统 Source of Truth（工具持久化 + 裁决校准）
│   └── pages/                      页面级覆盖（collection / album-detail）
└── pages/                          基础设计页面（静态 HTML）
    ├── assets/tokens.css           三层 token（primitive → semantic → component）
    ├── assets/app.css              C-* 组件样式实现
    ├── index.html                  导航页
    ├── style-guide.html            PG-SYSTEM 设计系统总览
    ├── collection.html             PG-COLLECTION（可交互）
    ├── add-flow.html               PG-ADD（可交互弹层）
    ├── album-detail.html           PG-DETAIL
    └── states.html                 PG-STATES 九组三态
```

## 设计稿 → 代码实现对照（F0 已落地部分）

| 设计稿（本包 pages/） | 代码库实现 |
|---|---|
| tokens.css / app.css | `src/client/styles/`（同源移植，demo 件裁剪） |
| collection.html（筛选舱/封面墙/回响卡） | `src/server/routes/pages.ts` GET `/`（无 JS 基线 + 三态） |
| add-flow.html（确认层三件套） | GET/POST `/add` 基线 + `islands/add-dialog.ts`（F2 增强） |
| album-detail.html（双区 + 联想） | GET `/album/:id` |
| states.html（三态规范） | `html.ts` 三态助手 + 9 组在真实页面落位 |
