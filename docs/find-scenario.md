# 找回闭环场景实测记录（W4-6-2 · FR-2/FR-3 收口）

> 派工来源：07-前端设计包/02-前端实现拆分方案.md §7 P2（2026-11-13 执行）。
> 验收口径：设计 PRD §5 C-CHIP/C-COVER、§6.1、§10（找回 = ≤3 次筛选 + 10s 扫视 → 一屏 20–40 张，全程封面可见）；PM §2.1 W4/W6 门禁。

## 1. 环境准备（非测试产出）

| 项 | 值 |
|---|---|
| 被测仓 | `musicgraphy/` 主线（W2-2 后工作树 + 本卡两处补强，见 §5） |
| 服务 | `tsx src/server/server.ts`，127.0.0.1:3100（dev：ACCESS_KEY=dev-local 内置默认） |
| 数据 | `data/musicgraphy.db`：5,018 专辑 / 5,001 记录 / 4,293 有 cover_color（`scripts/seed-dev.ts` 既有种子库，本次未重灌） |
| 浏览器 | ZCode IAB，1440×900，既有登录态 cookie（环境预置，非本次操作） |
| 方式 | web-gui-tester 黑盒 GUI：DOM 快照 + 截图双证据；服务端行为另以 curl 只读复核 |

## 2. 场景实测：经典找回路径 ≤3 筛一屏收敛

路径 = 设计 PRD §6.1 页脚提示的「Genre → 我听的时期 → 第三筛」。颜色轴在两筛后最大计数仅 8（棕），
不足 20–40 带内，按派工预案「主色就绪前用组合替代颜色轴」取 Favorite 为第三筛（favorite 轴实时计数 27）。

| 步 | 操作 | URL（pushState 后） | 状态行 | 证据 |
|---|---|---|---|---|
| 0 | 打开首页 | `/` | 5001 张匹配 | DOM 快照 + [t2-initial.png](find-scenario-screenshots/t2-initial.png) |
| 1 | 点 chip「Electronic (325)」 | `/?genre=Electronic` | 325 张匹配 | DOM 读数（§3-A） |
| 2 | 点 chip「2025 年听 (86)」 | `/?genre=Electronic&period=2025` | 86 张匹配 | DOM 读数（§3-B） |
| 3 | 点 chip「Favorite (27)」 | `/?genre=Electronic&period=2025&fav=1` | **27 张匹配** | 截图 [t5-converged-27.png](find-scenario-screenshots/t5-converged-27.png) |

**一屏收敛判定：3 次筛选 → 27 张 ∈ [20, 40] ✓；封面墙 27 卡无分页，全程封面可见（1:1 卡 + 收藏星标），符合 §10 口径。**

## 3. 四验收点逐条判定（chips 联调）

### A. 轴排除式计数（排除激活轴）——✓

- 筛 1 后（`?genre=Electronic`）：listened 轴重算为 2026(68)/2025(86)/2024(81)/2023(10)（Electronic 交集）；color 轴重算为棕(25)/青(23)…；**genre 轴保持全库分布**（Disco 352…Ambient 295）——`buildWhere(filters, exclude='genre')` 剔除自身轴，语义 = 轴内自由试错切换（每 chip 计数 =「换到它」的结果），设计如此（collection.ts 头注释 + PRD「其余条件计数立即重算」）。
- 筛 2 后（`?genre=Electronic&period=2025`）：year 轴重算为 2025(2)/2024(1)…交集分布。
- 单筛 `?period=2025`（curl 只读复核 `/fragment/cabin`）：genre 轴 = 摇滚(92)/Hip-Hop(91)/Soul(88)（period 交集、排除 genre 自身）✓。
- DAO 层另有既有单测覆盖（tests/dao.smoke.test.ts:101–108）。

### B. 计数 0 自动隐藏（非置灰）——✓

- 筛 2 后发行年份轴从 76 个 chip 收敛为约 20 个（交集外年份整个不渲染）；筛 3 后 color 轴橙/绿/灰(16) 消失、listened 轴只剩 4 项、Tag 轴收敛为 22 项——服务端 `cabinSection.facetChips` 过滤 `count > 0 || 是激活值`（激活值 count=0 仍显示以保证可移除）。截图 t5-converged-27.png 可数。

### C. 激活墨底 chip 可单独移除——✓

- 形态：轴内激活 chip 与已选行 chip 均墨底纸字（`.chip.active` = `--chip-active-bg`，CSS app.css:116–118 已核）；已选行 chip 尾部 `×`（`.chip-x`，aria-label=「移除条件 …」）。
- 行为：点击已选行「Electronic ×」→ URL `/?period=2025`、状态行 1197、已选行仅剩「2025 年听」——单独移除即时回流 ✓（移除 genre 保留 period，href 语义正确）。
- 无 JS 基线：chip-x 是 `<a href>`，SSR 直出可原生跳转（ADR-003 V4）。

### D. URL 即状态全程一致（pushState / popstate / 刷新还原）——✓

- pushState：每筛后 URL 立即累积（§2 表），全程无整页导航（结果区就地 swap）。
- popstate：浏览器后退一步 → URL 回两筛态、状态行 86、已选行两 chip、墙 60 卡（片段还原，非整页加载）✓。
- 刷新还原：`/?period=2025` 直接 reload → SSR 全量还原（状态行 1197、单 chip、60 卡）✓——同时覆盖「URL 可分享重开」语义。

## 4. 测试结论与记录事项

**通过**：§2 一屏收敛 + §3 A/B/C/D 四验收点全部满足（PRD §5 C-CHIP 形态、§6.1、§10 找回口径）。

**环境问题（非被测网站缺陷）**：ZCode IAB 输入管线在本次会话中途失效（reload 后所有点击——含大目标 chip、Playwright/坐标/节点三路径——静默无效；只读操作全程正常）。影响：T10「移除全部条件」按钮未能以点击方式走完 JS swap。佐证其正确性的三条旁证：① 与 chip-x 走**同一** root 级 click handler + 同一 swap 通道（C 点已验证）；② href=`/`（EMPTY_FILTER）已由 DOM 直读核实；③ no-JS 原生跳转同语义。失效前同类交互（T3–T7 大量成功）为对照组。

**竞态读数复核（非缺陷）**：T7 移除后 900ms 读到状态行 86 与 URL 不符——重读稳定态为 1197 且三处自洽；系前次 Playwright click 超时异常后事件延迟派发与读取时序交叠，最终态正确。

**观察项（移交，不属本卡）**：颜色轴出现两个「灰」chip——`cover_color=16`（保留值，colorOf 兜底显示「灰」）与 `=13`（真灰）并存；种子脚本写 1–16 而 COLOR_TABLE 有效域 1–15。与第三波 P3 卡（color-extract 16→null）相关，建议随 P3 收敛后复核。

## 5. 本卡代码改动（微调披露）

| 文件 | 改动 | 依据 |
|---|---|---|
| `src/client/islands/filter-cabin.ts` | ① 连点防抖 250ms→**300ms**（对齐拆分方案 §4.2 F1 契约「300ms 防抖合并」）；② popstate 增加 `location.pathname !== '/'` 守卫（历史条目非主页时不做片段交换，防误注入） | 行数 146→148（<150 预算 ✓）；styles/app.css 未动（只读合规，零新增样式） |
| `tests/perf-like.test.ts`（新增） | 5000 种子四字段 LIKE（标题/艺术家/Tag/Note 片段）经 DAO `listPage({filters:{q}})` 单次 <200ms 断言 ×4 + LIKE 转义回归 ×1 | 派工原文「DAO searchRecords」在主线无此方法——对应能力即 `listPage` q 路径（同一 `buildWhere` 四字段 LIKE SQL 形状），测试头注释披露对应关系 |
| `docs/find-scenario.md`（本文件） | 场景实测过程与结果 | 派工任务 3 |

## 6. 门禁

`npm run check`（typecheck + eslint + vite build + node:test）：全绿，测试 43→48（+5 = perf-like 5 项）。perf-like 四字段 LIKE 实测 1–2ms（预算 200ms 的 ~1%），种子 5000 行插入 68ms。
