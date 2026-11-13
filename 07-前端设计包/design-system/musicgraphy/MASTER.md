# Design System Master File — Musicgraphy 2.0

> **LOGIC:** When building a specific page, first check `design-system/musicgraphy/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Musicgraphy 2.0（个人音乐线索库 / 档案馆）
**Generated:** 2026-11-11（ui-ux-pro-max skill `--design-system --persist` 生成后，经 designer fit 校准）
**Category 校准说明:** 工具初判 "Music Instrument Learning"（音乐教学，高能量红调）。经 `--domain product` 复核，最贴近的参照产品为 **Bookmark & Read-Later**（关键词 archive / collection / pocket / raindrop——与"个人专辑档案"同构），故本文件已按该行的风格与配色策略校准；逐 token 来源见《01-设计系统PRD.md》§3 证据链。
**Design Dials:** Variance 3/10 (Centered / Minimal) | Motion 3/10 (Subtle) | Density 6/10 (Standard)

---

## Global Rules

### Style

**Style:** Minimalism & Swiss Style + Flat Design（主）· Editorial Grid / Magazine（辅，服务于封面墙）

**Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, grid-based, essential, archival

**Best For:** personal archive / collection tools（bookmark-read-later 同类）、content-first 产品

**Key Effects:** Subtle hover (150–250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading

> 页面模式注记：工具返回的 "Product Demo + Features" 为**营销落地页**模式，仅适用于 `02-变现文档包/06-landing.html`；产品本体（本设计包范围）的形态是**单一核心页（Collection）+ 弹层（Add）+ 详情页**的低页面数架构——这是终稿性质判据"不新增页面"在设计侧的直接体现。

### Color Palette（semantic 层）

| Role | Hex | CSS Variable | 来源注记 |
|------|-----|--------------|----------|
| Background | `#FFFBEB` | `--color-background` | DB 行「Warm ink + amber accent on cream」奶油纸底，原值保留 |
| Card | `#FFFFFF` | `--color-card` | 通用白卡 |
| Card Foreground | `#1C1917` | `--color-card-foreground` | DB `#0F172A`（冷 slate）→ 暖墨 stone-900 校准，暖色一致性 |
| Foreground | `#1C1917` | `--color-foreground` | 同上（暖墨黑），对奶油底对比 ≈13.6:1 |
| Primary（主操作/墨章） | `#292524` | `--color-primary` | DB 行原 primary `#78716C` 对白字仅 ≈4.0:1（AA 不过）→ 加深至 stone-800，白字 ≈12.6:1 |
| On Primary | `#FAF6EE` | `--color-on-primary` | 纸白字（暖于纯白） |
| Secondary（钢墨/次级描边） | `#78716C` | `--color-secondary` | DB 行原 primary 降级复用 |
| On Secondary | `#FFFFFF` | `--color-on-secondary` | |
| Accent/CTA（琥珀注记） | `#D97706` | `--color-accent` | DB 行原值保留：图标/大字号/装饰层使用 |
| Accent Text（小字琥珀，AA） | `#B45309` | `--color-accent-text` | 校准新增：`#D97706` 在奶油底上小字仅 ≈3.2:1，小号文字一律用 `#B45309`（≈4.7:1） |
| On Accent | `#1C1917` | `--color-on-accent` | DB `#000000` → 暖墨微调，对比 ≈7:1 |
| Muted | `#F7F3EA` | `--color-muted` | DB `#F6F6F6`（中性灰）→ 暖纸灰校准 |
| Muted Foreground | `#57534E` | `--color-muted-foreground` | DB `#475569`（冷 slate）→ stone-600 暖校准，对比 ≈6.9:1 |
| Border | `#E9E2D2` | `--color-border` | DB `#EEEDED` → 暖纸边校准 |
| Destructive | `#DC2626` | `--color-destructive` | 工具初判的"音乐红"从 primary **降级**至此唯一席位（与"安静档案"支柱冲突，见 PRD §3 裁决记录） |
| On Destructive | `#FFFFFF` | `--color-on-destructive` | |
| Ring（焦点） | `#D97706` | `--color-ring` | DB `#DC2626` → 琥珀：奶油底上更醒目且不携带"错误"语义 |

**Color Notes:** 暖墨 + 琥珀注记于奶油纸面（warm ink + amber annotation on cream）——"档案馆纸面 + 铅墨盖章 + 琥珀手写注记"的隐喻；红色仅用于破坏性操作。

### Cover 主色数据色板（primitive 层，D3 数据决定的 UI 侧映射）

`--swatch-*` 系列 = 封面主色提取的 14 离散色板（P0-4/D3 存字段；P1-4 色板筛选 chips 直接引用）。**它是数据轴色板，不是 UI 强调色板**——禁止用于按钮/链接等 UI 语义。

| 色名 | Hex | 变量 | | 色名 | Hex | 变量 |
|------|-----|------|---|------|-----|------|
| 红 | `#DC2626` | `--swatch-red` | | 青 | `#0D9488` | `--swatch-teal` |
| 橙 | `#EA580C` | `--swatch-orange` | | 蓝 | `#2563EB` | `--swatch-blue` |
| 琥珀 | `#D97706` | `--swatch-amber` | | 靛 | `#4F46E5` | `--swatch-indigo` |
| 黄 | `#CA8A04` | `--swatch-yellow` | | 紫 | `#7C3AED` | `--swatch-purple` |
| 黄绿 | `#65A30D` | `--swatch-lime` | | 品红 | `#DB2777` | `--swatch-magenta` |
| 绿 | `#16A34A` | `--swatch-green` | | 棕 | `#92400E` | `--swatch-brown` |
| 灰 | `#78716C` | `--swatch-gray` | | 黑 | `#1C1917` | `--swatch-black` |
| | | | | 白 | `#F5F5F4` | `--swatch-white` |

### Typography（三层字体栈）

| 层 | 字体 | 用途 | 来源 |
|----|------|------|------|
| Display（题名） | **Playfair Display** → 回退 `Noto Serif SC` / 宋体系 | 页面题名、空态引语、"个人音乐自传"叙事面 | DB「Classic Elegant」（Playfair + Inter） |
| UI/Body（界面） | **Inter** → 回退 `Noto Sans SC` / `PingFang SC` / `Microsoft YaHei` | 全部界面文本、按钮、表单、专辑名正文 | DB「Classic Elegant」 |
| Meta（目录卡标签） | **JetBrains Mono** | 日期、计数、Tag/Genre 标签、`cat.no.` 式元信息——全大写 + `letter-spacing: 0.08em` | DB「Minimalist Monochrome Editorial」的 mono 层（tags/dates/labels 用法） |

**Mood:** archival, editorial, calm, bookish —— "一部可以检索的个人音乐自传"。

**Google Fonts:** [Playfair Display + Inter + JetBrains Mono](https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap)

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

--font-display: 'Playfair Display', 'Noto Serif SC', 'Songti SC', serif;
--font-body: 'Inter', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
--font-meta: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Consolas, monospace;
```

> 字体裁决记录：工具初判 Righteous + Poppins（music/entertainment/energetic 行）被否决——与支柱四"档案偶尔开口，永不开口猜你"的安静气质冲突；三行 DB 证据（Classic Elegant / Minimalist Monochrome Editorial / product 行 Editorial Grid）合成三层栈。

### Type Scale

| Token | 值 | 用途 |
|-------|-----|------|
| `--text-display` | 40px / 1.1 / 700 | 空态引语、大题名（Playfair） |
| `--text-h1` | 28px / 1.2 / 700 | 页题 |
| `--text-h2` | 20px / 1.3 / 600 | 区块题 |
| `--text-h3` | 16px / 1.4 / 600 | 卡片题、专辑名 |
| `--text-body` | 14px / 1.5 / 400 | 正文（基准 UI 字号，英文 UI 惯例；中文正文 ≥ 14px） |
| `--text-small` | 12px / 1.5 / 400 | 辅助说明（下限 12px，禁更小） |
| `--text-meta` | 11px / 1 / 500 | JetBrains Mono 标签层（大写 + 宽字距） |

### Spacing Variables（Density 6/10 — Standard）

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` | 图标与文字微调 |
| `--space-sm` | `8px` | chip 间距、行内留白 |
| `--space-md` | `16px` | 标准内边距 |
| `--space-lg` | `24px` | 区块内边距 |
| `--space-xl` | `32px` | 大间距 |
| `--space-2xl` | `48px` | 区块间 |
| `--space-3xl` | `64px` | 页首/页尾 |

### Radius / Shadow / Border

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `6px` | chips、小按钮 |
| `--radius-md` | `10px` | 输入框、中按钮、回响卡 |
| `--radius-lg` | `14px` | 弹层、大卡 |
| `--radius-cover` | `4px` | 封面卡——最小圆角，保持"实体唱片"的方正感 |
| `--shadow-sm` | `0 1px 2px rgba(28,25,23,0.06)` | 封面静置 |
| `--shadow-md` | `0 4px 10px rgba(28,25,23,0.10)` | 卡片 hover、弹层内件 |
| `--shadow-lg` | `0 16px 40px rgba(28,25,23,0.18)` | 弹层整体 |
| `--border-hairline` | `1px solid var(--color-border)` | 默认描边 |

### Motion Tokens（Motion 3/10 — Subtle）

| Token | Value | Usage |
|-------|-------|-------|
| `--dur-fast` | `150ms` | chip 激活、按钮 hover |
| `--dur-base` | `200ms` | 卡片 hover、弹层内状态 |
| `--dur-slow` | `300ms` | 弹层进出、回响卡入场 |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | 入场 |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | 出场（exit faster than enter：出场用时 ≤ 入场） |

GSAP 预设（仅详情页/落地页大区块入场；产品内核不依赖 JS 动效）：

```js
gsap.from(el, { opacity: 0, y: 12, duration: 0.35, ease: 'power1.out',
  scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
```

- ✅ y 偏移 ≤12px，读作淡入而非滑动
- ❌ reduced-motion 用户直接呈现最终状态（`prefers-reduced-motion` 全局尊重）

### Icons

**Lucide（SVG）** 统一图标集；24px 网格，`stroke-width: 1.75`；禁止 emoji 充当图标。常用：search / plus / heart / tag / sticky-note / clock / x / chevron-down / download / shuffle / archive / library。

### 深色模式（P1 设计扩展，token 预案）

Light（奶油纸面）为 v1 默认；Dark（墨底琥珀注记反转）token 预案已定，实现排在 P1：

| Role | Dark 值 |
|------|---------|
| Background / Card | `#1C1917` / `#292524` |
| Foreground / Muted FG | `#FAF6EE` / `#A8A29E` |
| Border | `#44403C` |
| Accent / Accent Text / Ring | `#F59E0B` / `#FBBF24` / `#F59E0B` |
| Destructive | `#EF4444` |

---

## Component Specs（组件层一律引用 `var(--…)`，禁裸 hex）

### Buttons

| 属性 | Default | Hover | Active | Disabled |
|------|---------|-------|--------|----------|
| bg（primary） | `var(--color-primary)` | `var(--color-foreground)` | `#000` | `var(--color-muted)` |
| text | `var(--color-on-primary)` | `var(--color-on-primary)` | `var(--color-on-primary)` | `var(--color-muted-foreground)` |
| border | none | none | none | `var(--color-border)` |
| shadow | `--shadow-sm` | `--shadow-md` | none | none |

`.btn-primary`：padding 10px 20px / radius `--radius-md` / font `--text-body` 600 / transition `--dur-fast`。次级按钮：纸面透明底 + `1.5px` 钢墨描边；危险按钮：`--color-destructive` 白字，仅限"移除记录"等不可逆操作。

### Inputs

底白卡、`--border-hairline`、radius-md、padding 10px 14px、font `--text-body`；focus：border `var(--color-ring)` + `0 0 0 3px rgba(217,119,6,0.18)` 外环；placeholder 色 `--color-muted-foreground`。**占位符永不替代可见标签**（skill 表单规则）。

### Filter Chips（筛选舱核心件，规格详见 PRD §6.2）

- 值态（可点选）：纸面卡底 + hairline 描边 + mono 计数 `Electronic (86)`
- 激活态：**墨底纸字**（`--color-primary` 底 + `--color-on-primary` 字）+ 可单独移除的 `×`
- 计数为 0：自动隐藏（非置灰——为 0 的选项对试错无意义）
- 容器 `flex-wrap`（skill UX「Chip Collection Reflow」High 级规则：禁止单行裁切）

### Cover Card（封面卡）

固定宽高比 1:1（防 CLS，skill 性能规则）、radius `--radius-cover`、`--shadow-sm` 静置；hover：`--shadow-md` + 底部 meta 条淡入（专辑名/艺术家/年份，200ms）；Favorite 星标琥珀色右上角常驻（已收藏时）。整卡可点，enter 详情 ≤1 步。

### Modal（Add 弹层）

overlay `rgba(28,25,23,0.45)` + `blur(4px)`；容器白卡 radius-lg shadow-lg max-width 520px；**默认态 = 完成态**（点击"添加"即落库，补充字段不阻塞关闭）；Esc 关闭、焦点回到触发元素（skill 表单焦点管理规则）。

---

## Anti-Patterns（Do NOT Use）

- ❌ **推荐/猜你喜欢的组件形态**（轮播、"猜你想找"、自动播放）——支柱四：档案可以主动，但不可以殷勤
- ❌ **推送式红点/徽章轰炸**——唯一被允许的主动组件是"一年前的今天"单卡
- ❌ **列表优先的信息架构**——Collection 一律封面墙（cover-first 是形态铁律）
- ❌ **"应用/重置"筛选按钮**——状态即所见，chips 移除即回流
- ❌ **在 chips 行内裁切溢出**——必须 wrap（UX High 规则）
- ❌ **裸数字 live region**——"还剩 N 张"必须是有语义的完整短句（`role="status"`）
- ❌ **仅靠颜色传达状态**——色板筛选同时给文字标签（可访问性基线）
- ❌ Emojis as icons / missing cursor:pointer / 布局位移式 hover / 4.5:1 以下文字对比 / 无过渡的瞬变 / 不可见焦点

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use Lucide SVG instead)
- [ ] All icons from consistent icon set (Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150–300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px / 768px / 1024px / 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
- [ ] 封面图固定宽高比（CLS < 0.1）+ lazy loading + WebP/AVIF
- [ ] 数据区均有 loading / empty / error 三态（AGENTS.md §14/§15）
