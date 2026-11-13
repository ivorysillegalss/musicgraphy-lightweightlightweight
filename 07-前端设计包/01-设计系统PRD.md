# Musicgraphy 2.0 · 设计系统 PRD（前端设计侧）

> 版本 v1.0 · 2026-11-11 · 作者角色：前端设计师
> 上游：《Musicgraphy 2.0 新版产品理念（终稿）》（设计原则之源）、`02-变现文档包/01-PRD-产品需求文档.md`（工程规格之源，下称"工程 PRD"）
> 方法论：ui-ux-pro-max skill（v2.15.0）工作流——`需求分析 → --design-system 生成 → 持久化 MASTER.md → domain 补充检索 → fit 校准 → 交付前 checklist`
> 文档关系：工程 PRD 管"做什么/做到什么数值"，本文管"长什么样/怎么动/凭什么这样设计"。两文冲突时，功能与验收数值以工程 PRD 为准，视觉与交互实现以本文为准。

---

## 0. 一句话设计立场

> **一座安静的纸面档案馆：封面是唯一的主角，墨色负责秩序，琥珀负责"当时"；界面不殷勤、不猜测、不喧哗——让找得回这件事快到不需要思考。**

---

## 1. 设计愿景与六条设计原则（可检验）

每条原则由终稿四支柱推导，并附可检验口径——与工程 PRD 的验收口径同风格。

| # | 原则 | 推导自 | 可检验口径 |
|---|------|--------|-----------|
| D-P1 | **封面即内容（cover-first）** | 支柱二"找回的完成态是再认" | 默认视图 = 封面墙；任何检索结果页封面 100% 可见、无"仅列表"回退；封面卡固定 1:1（CLS < 0.1） |
| D-P2 | **纸面档案室隐喻** | 支柱三"档案是'为什么留下它'的索引" | 奶油纸底 + 暖墨 + 琥珀注记三层色仅此三职；红色只出现在破坏性操作；详情页公共/个人数据双区分区可见 |
| D-P3 | **试错式筛选舱** | 支柱二"模糊记忆是试错式的" | chips 常驻、无"应用/重置"按钮、计数实时（≤300ms 防抖）、为 0 选项自动隐藏、结果页始终显示"N 张匹配" |
| D-P4 | **零打扰动效** | 支柱四"档案偶尔开口，永不开口猜你" | 全站动效 150–300ms；无推送形态、无轮播、无自动播放；`prefers-reduced-motion` 全局尊重 |
| D-P5 | **三态完备** | 工程约束 §14/§15 | 每个数据区组件交付 loading/empty/error 三态设计稿（见 PG-STATES） |
| D-P6 | **可访问性是底线不是加分** | skill Priority 1（Accessibility CRITICAL） | 正文对比 ≥4.5:1；键盘可达全路径；"还剩 N 张"用带语义 live region；色板筛选带文字标签 |

**设计侧北极星**：线索覆盖率（工程 PRD §6）在 UI 上的支撑点 = Note 折叠框在 Add 弹层中**始终可见**（折叠但可见，placeholder 即提问"为什么留下它？"）+ 详情页记忆条把"当时"呈现为全页唯一 Playfair Italic。设计不制造填写压力，但让每一根线索都有体面的位置。

---

## 2. 方法论与证据链（ui-ux-pro-max 检索记录）

> 本节记录设计决策的检索证据——与本项目"决策可追溯"文化（收敛标注/裁决案号）同构。检索日志全文见附录 A。

### 2.1 工作流执行记录

| 步骤 | 命令/查询 | 命中结果 | 采纳情况 |
|------|-----------|----------|----------|
| 1 需求分析 | 产品类型 = 个人档案工具（archive/collection）；受众 = RYM/Discogs/Letterboxd 同好；风格关键词 = calm/archival/cover-first；stack = 静态 HTML+CSS 设计稿（工程栈为 Hono SSR+岛屿，见 07-ADR） | — | 设计稿用零依赖静态页表达 token 与形态 |
| 2 design-system | `"personal music archive collection library calm archival cover gallery" --design-system --variance 3 --motion 3 --density 6` | Style = **Minimalism & Swiss Style**；Palette = "Musical red + warm amber"；字体 Righteous+Poppins | 风格**采纳**；调色板/字体**否决**（见 2.2 裁决①②） |
| 2 persist | `--persist -p "Musicgraphy" --output-dir 07-前端设计包` | `design-system/musicgraphy/MASTER.md` | 已生成并经 fit 校准（§2.2） |
| 3a product | `"collection library catalog archive tool" --domain product` | **Bookmark & Read-Later** 行：Minimalism & Swiss + Flat / Editorial Grid 辅 / "Paper warm white + ink neutral + minimal accent" | **全盘采纳**为风格与配色策略基准（同类产品最贴近命中） |
| 3b color（重试后） | `"vintage vinyl warm cream sepia music" --domain color` | **Notes & Writing App** 行："Warm ink + amber accent on cream" | **采纳**为配色基座；逐 token 微调见 MASTER.md 来源注记 |
| 3c typography | `"editorial archive library elegant serif" --domain typography` | **Classic Elegant**（Playfair Display + Inter）；**Minimalist Monochrome Editorial** 的 mono 层（tags/dates/labels） | **合成采纳**：三层字体栈 |
| 3d ux | `"filter chips real-time result count progressive" --domain ux` | Chip Collection Reflow（High）/ Contextual Live Badge Updates（High）/ Compact Label Semantics（High）/ Heading Line Balance | **全部采纳**进 C-CHIP / 计数行 / 色板标签规格 |
| 4 stack | 静态设计稿不适用框架检索；工程实现期对 Hono SSR 岛屿补 `html-tailwind` 域检索 | — | 留待实现阶段 |

### 2.2 三条设计裁决（对工具初判的校准）

**裁决① 配色降红**：工具初判"音乐红 `#DC2626` 作 primary"。否决依据——支柱四"档案偶尔开口，永不开口猜你"要求界面默认态安静，红色主按钮与"档案馆"气质冲突；且 product 域同类命中行的配色策略是"纸白 + 墨中性 + 极简强调"。处理：红降级至 `--color-destructive` 唯一席位；primary = 暖墨 `#292524`（"墨章"）；强调 = 琥珀 `#D97706`（"注记"）。**DB 原行信息未丢弃**：warm-amber 保住了琥珀强调色的位置。

**裁决② 字体换栈**：工具初判 Righteous + Poppins（entertainment/energetic 行）。否决依据——同裁决①；且 Editorial Grid 辅风格的"目录卡"美学需要 mono 元信息层。处理：Playfair Display（display）+ Inter（UI）+ JetBrains Mono（meta）三层栈，全部有 DB 行依据（Classic Elegant / Minimalist Monochrome Editorial）。

**裁决③ 对比度修正**：warm-ink 行原 primary `#78716C` 配白字对比 ≈4.0:1，不达 AA（skill Priority 1）。处理：primary 加深至 `#292524`（≈12.6:1），`#78716C` 降级为 secondary 描边钢墨；琥珀小字统一用 `#B45309`（≈4.7:1），`#D97706` 限图标/大字号/装饰。冷 slate（`#0F172A`/`#475569`）全部换暖 stone 系——纸面隐喻的一致性优先。

---

## 3. 信息架构与页面清单

### 3.1 IA 原则：低页面数架构

终稿性质判据要求支线"不新增页面"。设计侧对应决策：**产品本体 = 1 个核心页 + 1 个详情页 + 弹层**，全部高频操作（记录、找回、整理）发生在 Collection 单页内，Topster/导出/设置为延伸页（P1/P2）。

```
Collection（默认首页 / 找回主场）
 ├─ 搜索框（双意图：添加 + 找回）──→ Add 弹层（确认层三件套）
 ├─ 筛选舱 chips ──→ 状态即所见，无路由跳转
 ├─ 回响卡片（一年前的今天）──→ 专辑详情
 └─ 封面卡 ──→ 专辑详情（双区：外部元数据 / 个人记忆条）
                  └─ 联想入口 ──→ 专辑详情 / 反向筛选回 Collection
延伸页（P1/P2，不在 v1 设计稿内）：设置（线索采集开关/导出）· Topster · 命名视图侧栏
```

### 3.2 页面清单与映射

| 页面 | 编号 | 覆盖的工程 PRD 条目 | 设计稿文件 |
|------|------|---------------------|-----------|
| Collection 主页 | PG-COLLECTION | FR-2 / FR-3 / FR-5 / P1-1 | `pages/collection.html` |
| Add 弹层（含搜索焦点态） | PG-ADD | FR-1 / FR-4(D2) / P1-7 / P1-8 | `pages/add-flow.html` |
| 专辑详情 | PG-DETAIL | P1-2 / P1-5 / §4 二分 | `pages/album-detail.html` |
| 三态规范页 | PG-STATES | FR-6 记录可靠性 | `pages/states.html` |
| 设计系统总览 | PG-SYSTEM | 本文 §4–§5 的可视化 | `pages/style-guide.html` |
| （工程 PRD §5 其余）设置页 | PG-SETTINGS（规格级） | 线索采集开关 / 导出入口 | 本文 §6.5，稿后补 |

---

## 4. 设计系统规格（三层 token 架构）

> 完整值表见 `design-system/musicgraphy/MASTER.md`（工具持久化 + 裁决校准后的 Source of Truth）；本节定义架构与引用关系。组件层一律 `var(--…)`，禁裸 hex（design-system skill 铁律）。

```
Primitive（原料）             Semantic（语义）                Component（组件）
--stone-900 #1C1917      →   --color-foreground         →   --chip-active-bg
--amber-600  #D97706     →   --color-accent             →   --echo-card-accent
--cream      #FFFBEB     →   --color-background         →   --page-bg
--swatch-red …black     →   （独立数据轴，不进 UI 语义）  →   --filter-color-chip
```

| 层 | 内容 | 约束 |
|----|------|------|
| Primitive | stone/amber/cream 原色 + **14 离散封面主色板**（`--swatch-*`） | 主色板是 D3 数据轴的可视化，**禁止**用于按钮/链接 |
| Semantic | 15 个 `--color-*` 角色 + 字体/间距/圆角/阴影/动效 token | 页面代码只允许引用本层与组件层 |
| Component | `--chip-*` / `--cover-*` / `--echo-*` 等组件级别名 | 仅组件 CSS 内部使用 |

**深色模式**：token 预案已定（MASTER.md），v1 不实现（Light 纸面即产品气质本体），P1 落地。

---

## 5. 核心组件规格

> 状态表沿用 design-system skill 的 Default/Hover/Active/Disabled 范式。尺寸均含 44×44px 最小触达热区（skill Priority 2）。

### C-BTN 按钮
| 属性 | Default | Hover | Active | Disabled |
|------|---------|-------|--------|----------|
| 背景 | `--color-primary` 墨 | `--color-foreground` | `#000` | `--color-muted` |
| 文字 | `--color-on-primary` | 同 | 同 | `--color-muted-foreground` |
| 描边 | none | none | none | hairline |
| 阴影 | sm | md | none | none |

次级 = 纸面透明 + 1.5px 钢墨描边；危险 = 红/白字（仅"移除记录"类不可逆操作）。过渡 `--dur-fast`。

### C-INPUT 输入框
白卡底 + hairline + radius-md；focus = 琥珀描边 + 3px 半透明外环；**可见标签永远在**，placeholder 只是示例。

### C-SEARCH 搜索框（双意图） 〔FR-1/FR-3〕
居中 ≥480px；占位文案「搜索专辑、艺术家、Tag，或粘贴链接 / 一句当时……」。焦点即候选（零输入候选 = 最近艺术家 + 最近搜索词）；`/` 键全局聚焦（P1-8）。同一入口承载三种意图：快速添加（Enter 首候选）/ 找回（内容检索）/ 粘贴识别（URL / "Artist - Album"）——入口合一，意图由输入内容判别，**不设模式切换器**（零新概念）。

### C-CHIP 筛选 chip 〔FR-2〕
| 态 | 形态 | 行为 |
|----|------|------|
| 值态 | 纸面卡底 + hairline + mono 计数「Electronic (86)」 | 点击激活 |
| 激活态 | **墨底纸字** + 尾部 `×` | 单独移除，即时回流 |
| 计数 0 | 自动隐藏（非置灰） | 对试错无意义的选项不出现 |
| 容器 | `flex-wrap`，禁单行裁切（UX High 规则） | 移动端轴行横向滚动 |

**轴命名硬规则**：「发行年份」与「我听的时期」并列、命名写全、绝不共用控件（A3 半格偏差修正，5/5 二轮确认）。颜色轴（P1-4）chip = 14 色板圆点 + 色名文字。

### C-COVER 封面卡 〔FR-5 / D-P1〕
1:1 固定比例 + radius 4px（方正实体唱片感）+ shadow-sm 静置 → hover shadow-md + 底部 meta 条淡入（专辑名/艺术家/年份，200ms）；已收藏右上角琥珀星标常驻；整卡可点进详情。虚拟滚动在此层实施（5000 张 <1s 首屏交互）。

### C-ADD 记录弹层（确认层三件套） 〔FR-1〕
1. 候选区：零输入候选 / 粘贴识别结果；已收藏候选前置墨色标记「IN YOUR COLLECTION」防重复确认；
2. 确认层：主按钮「添加」即落库；Favorite 心形开关；Tag 输入 + **自动补全**（上方常驻最近 5–8 个 tag）+ Note 折叠框（placeholder =「为什么留下它？留一句当时……」）+ 快捷听取时间单选（刚刚/今年/去年/更早年份粒度）；
3. **默认态 = 完成态**：补充字段不阻塞关闭，"先添加、稍后补"合法。
键盘路径：`Enter` 添加首候选 → `F` 快速 Favorite → `Esc` 关闭且不阻塞。失败 toast 不阻塞关闭（"一次失败的添加比慢 0.5 秒更伤害记录意愿"）。

### C-DUP 重复添加转化提示 〔FR-4/D2〕
重复添加**永不产生第二条记录**：提示条「已在你 Collection 中 · [去补线索] [又听了一次]」——两个出口分别指向详情页补 Tag/Note 与更新 listenedAt（P1-7）。此组件是集合语义的 UI 化，禁止出现"再建一条记录"路径。

### C-MEMO 记忆条（个人档案区） 〔P1-2〕
第一人称重组：「2023 年 8 月记录 · 听的时期：2023 夏 · Tags：夏天 / 海边 · 当时：青旅的天台」；"当时"一句用 Playfair Italic + 琥珀 quote 图标——全产品唯一斜体场景（手写注记隐喻）；与外部元数据区之间 hairline + mono 区题「PERSONAL RECORD」分隔（§4 数据二分视觉执行）。

### C-ECHO 回响卡片（一年前的今天） 〔P1-1〕
位置：Collection 顶部；形态：单张轻卡 ≤88px 高、`--color-muted` 底 + 琥珀左边线 2px + mono「ON THIS DAY · 2025-11-11」；**四条形态约束全部落地**：无推送、单入口、单卡片、确定性时间锚；无周年记录则整个区域不渲染（无占位）。

### C-STATE 三态 〔FR-6 / D-P5〕
| 态 | 形态 | 文案基调 |
|----|------|----------|
| Loading | 封面墙 = 骨架占位（1:1 灰块，保持布局稳定防 CLS）；搜索 = 内联 spinner | 不夸张 |
| Empty | 引语式（Playfair 大字）+ 单一恢复动作 | 档案馆口吻，不卖萌 |
| Error | 内联错误条（红左线）+ 重试 + 失败不阻塞关闭的承诺 | 说清"你的数据没丢" |

三态全量画廊见 `pages/states.html`。

---

## 6. 页面规格

### 6.1 PG-COLLECTION（默认主页）
布局（1440）：sticky 纸面毛玻璃 Header（品牌字标 + C-SEARCH 居中 + 「＋添加」）→ 回响区（条件渲染）→ 筛选舱（轴行 + 已激活 chips 行）→ 结果状态行（mono「37 MATCHES · RECOGNITION VIEW」，`role="status"` 完整短语「37 张匹配」）→ 封面墙（`auto-fill minmax(148px,1fr)` gap16，虚拟滚动）。
- 密度三档切换（大封面/中+标题/紧凑列表）= P1；v1 只交付中密度。
- 空结果态：引语「没有符合条件的专辑——也许线索还不够，试着移除一个条件。」+ 移除全部 chips 的文字按钮（非主按钮——找回失败不该有"推销感"）。
- 响应式：375px 封面 minmax(104px,1fr)、轴行横滚、搜索图标展开式；768/1024 两档过渡。

### 6.2 PG-ADD（记录弹层）
状态机：`搜索焦点态（零输入候选）→ 候选态（识别结果）→ 确认层（弹层）→ 落库 toast`；重复候选 → C-DUP。
设计稿演示四条路径：粘贴 URL 识别、零输入候选一键添加、键盘全程（`/`→`Enter`→`F`→`Esc`）、失败 toast。

### 6.3 PG-DETAIL（专辑详情）
布局见页面覆盖文件 `design-system/musicgraphy/pages/album-detail.md`：外部元数据区（钢墨语气 + 数据源标注 mono「VIA MUSICBRAINZ」）/ 个人记忆条（琥珀语气）/ 动作行（Favorite · 又听了一次 · 补线索）/ 联想入口（同期听的 / 同天添加的 / 同 Tag 的，各 ≤6 张，组题 = 确定性语义，禁"猜你喜欢"字样）。

### 6.4 PG-STATES（三态规范页）
收集全产品 9 组三态：封面墙 / 搜索结果 / 回响区 / Add 候选 / Tag 补全 / 导出 / 主色提取 / 联想入口 / 详情。每组给 loading/empty/error 三态并附文案。此页是 D-P5 的验收基准。

### 6.5 PG-SETTINGS（规格级，稿后补）
三件事：线索采集全局开关（"当时/为什么" ≤2 次点击、可跳过、可关闭的"关闭"在这里）；导出入口（JSON/CSV，永久免费红线）；Tag 治理提示开关（P1-6）。无统计仪表盘（不做清单）。

---

## 7. 交互与动效规范

| 场景 | 规格 | 依据 |
|------|------|------|
| 弹层进出 | 入 300ms `--ease-out`（8px 上移淡入）/ 出 200ms `--ease-in`（出场 ≤ 入场） | skill Priority 7 |
| chip 激活 | 背景/文字 150ms 直切（不做位移动画——试错流里每秒可能点 3 次） | UX "rapid chip animation interrupted" 场景 |
| 封面 hover | meta 条 200ms 淡入，**无 scale 位移**（防布局抖动） | skill 反模式"Layout-shifting hovers" |
| 计数更新 | 300ms 防抖 + `role="status"` 完整短句 | ux 域「Contextual Live Badge Updates」High |
| 回响卡入场 | 首屏 350ms 淡入一次，之后常驻 | Motion 3/10 Subtle |
| 全局 | `prefers-reduced-motion: reduce` → 全部过渡时长归零、GSAP 不注册 | skill Priority 7 + MASTER checklist |

**触碰与反馈**（Priority 2）：可点热区 ≥44×44px、chips 间距 ≥8px、一切异步有 loading 反馈、禁 0ms 瞬变。

---

## 8. 可访问性与响应式

- **对比**：全部文字 ≥4.5:1（本 token 表已逐对验证）；琥珀小字必须 `--color-accent-text`；灰字禁止放在灰底上。
- **键盘**：`/` 聚焦搜索 → 方向键选候选 → `Enter` 添加 → `F` Favorite → `Esc` 关闭返回；焦点环 = 2px 琥珀，永不 `outline: none` 裸删。
- **读屏**：chips = `<button aria-pressed>`；计数 = `role="status"` 完整短句；状态 badge 与值 chip 语义分离（badges 传状态、chips 传值/动作，ux 域「Compact Label Semantics」）；色板筛选有文字标签；图标一律 `aria-hidden` 或带 label。
- **响应式断点**：375 / 768 / 1024 / 1440 四档（skill checklist）；无横向滚动；mobile-first 实现。

---

## 9. 性能设计预算（与 FR-5 对齐）

| 项 | 预算 | 设计侧执行 |
|----|------|-----------|
| 5000 张首屏可交互 | <1s | 封面墙虚拟滚动 + 封面 WebP/AVIF + lazy loading + 固定 1:1 占位 |
| CLS | <0.1 | 封面卡/骨架占位恒定比例；meta 条用 overlay 不占布局 |
| 计数响应 | 毫秒级 | chips 计数 300ms 防抖内呈现 |
| 字体 | — | display swap；三族共 ≤4 个字重档 |
| 设计稿本身 | 零依赖 | 静态 HTML+CSS，可离线打开评审 |
| CSS 构建产物 | ≤20KB（raw） | 全为活组件规则；19.02KB 实测达标（IM-14 追认口径，2026-11-14） |

---

## 10. 设计侧验收口径（合并工程 FR-6）

| 维度 | 口径 | 来源 |
|------|------|------|
| 记录 | 理想键盘路径 ≤5s；普通 ≤3 步/15s | FR-6 |
| 找回 | ≤3 次筛选 + 10s 扫视 → 一屏（20–40 张）；全程封面可见 | FR-6 |
| 线索埋点 | ≤2 次点击、可跳过、可全局关闭 | FR-6 |
| 三态 | 9 组全备（PG-STATES 验收） | FR-6 + D-P5 |
| 交付前 checklist | MASTER.md §Pre-Delivery 12 条全过 | skill |
| 设计红线 | 无推荐组件/无推送形态/无"应用"按钮/封面墙铁律/红=破坏性唯一 | 本文 §1 + MASTER 反模式 |

---

## 11. 交付物与目录

```
07-前端设计包/
├── 00-README.md                        本包导读
├── 01-设计系统PRD.md                    本文
├── design-system/musicgraphy/
│   ├── MASTER.md                       设计系统 Source of Truth（工具持久化 + 裁决校准）
│   └── pages/
│       ├── collection.md               PG-COLLECTION 页面覆盖
│       └── album-detail.md             PG-DETAIL 页面覆盖
└── pages/                              基础设计页面（静态 HTML，双击可开）
    ├── assets/tokens.css               Primitive→Semantic→Component 三层 CSS 变量
    ├── assets/app.css                  组件层样式（C-* 组件实现）
    ├── index.html                      设计包导航页
    ├── style-guide.html                PG-SYSTEM 设计系统总览
    ├── collection.html                 PG-COLLECTION
    ├── add-flow.html                   PG-ADD
    ├── album-detail.html               PG-DETAIL
    └── states.html                     PG-STATES
```

## 12. 设计观察池（用证据决定下一步设计投入）

| 信号 | 设计侧响应 |
|------|-----------|
| 线索覆盖率低 → 检查 Add 弹层 Note 框可见性与提问文案 A/B | 编码窗口假设验证 |
| 回响卡点击率低 → 回响卡视觉权重实验（边线/底色/位置） | Review 触发器有效性 |
| 搜索失败率高 → 空态文案增加"线索建议"（联动观察池"手动建卡"） | 红线预锁：用户值只进个人层 |
| 色板轴点击率（P1 上线后） → 决定色环/光谱墙是否出 P2 | 双用途范本验证 |

---

## 附录 A · 检索日志

```
# 1  --design-system  "personal music archive collection library calm archival cover gallery"
#    --variance 3 --motion 3 --density 6 -p Musicgraphy  → Style: Minimalism & Swiss Style
# 2  --persist（输出 design-system/musicgraphy/MASTER.md）
# 3  --domain product   "collection library catalog archive tool"   → Bookmark & Read-Later 行
# 4  --domain color     "library archive calm paper warm muted"    → 命中不佳（医疗/冥想系）
# 5  --domain color     "vintage vinyl warm cream sepia music"（窄化重试）→ Warm ink + amber on cream 行
# 6  --domain typography "editorial archive library elegant serif"  → Classic Elegant + Mono 层
# 7  --domain ux        "filter chips real-time result count progressive" → 4 条 High/Medium 规则
```

## 附录 B · 引用对照

| 本文 | 工程 PRD | 终稿 |
|------|----------|------|
| D-P1 封面即内容 | FR-2 / FR-5 | 支柱二 |
| D-P2 纸面档案室 | §4 数据二分 | 支柱三 |
| D-P3 试错式筛选舱 | FR-2 | 支柱二 / 案 6 |
| D-P4 零打扰动效 | §5 非功能 | 支柱四 / 案 2 四约束 |
| C-ADD | FR-1 | P0-1 |
| C-CHIP | FR-2 | P0-2 |
| C-DUP | FR-4 D2 | 案 1 集合语义 |
| C-ECHO | P1-1 | 案 2 |
| C-MEMO | P1-2 | §5.2 记忆条 |
