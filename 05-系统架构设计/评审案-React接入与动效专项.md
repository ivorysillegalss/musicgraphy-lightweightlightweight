# 评审案 · React 接入与前端动效专项（S2-3 · R-103 · 专项二 S-B）

> **状态：待用户裁决（纯文档，零代码变更）**。本评审案 = 看板 S2-3 的交付物，
> 格式对齐 `05/评审案-地理渲染引擎选型.md`（DR-M1 同族）。
> **触发**：看板 S2-3 卡（用户 2026-11-15 两令合并：①R-103 React 框架裁决**已确认**；
> ②「前端页面的动效显示」专项）——合并执行路径 = 范围清单 → 接线形态评审案 →
> 口径修订 → 分阶段迁移，本评审案覆盖前三步，第四步（迁移实施）**待用户批文**。
> **关联**：IM-30（甲-2 无 JS 基线/SSR 岛屿架构、甲-5 IM-14 CSS 预算、甲-6 首屏 JS 预算、
> 甲-7 G2 RSS 均已废止转观察指标；**废止 ≠ 实施——本卡实施前评审案照出**）；
> 维持项乙-1 DD3 URL 即状态 / 乙-3 check 全绿（273/273 基线）/ 乙-5 资产自托管零 CDN /
> 乙-6 禁 raw 插用户数据；设计事实源 = 07-前端设计包/MASTER.md（token 唯一来源）。
> **事实核查披露**：需求草案 R-103 所记基线「首屏 JS 2.33KB / CSS 19.02KB」为当时口径——
> 本评审案一律以 d8653d0 实测为准（main.js 2,847B / main.css 24,319B，见 §8 证据清单）。

---

## 1. 结论与推荐（待用户裁决）

1. **接线形态：推荐候选 A = React 局部岛屿替换**（vite 岛屿加载器扩展，逐岛迁移，
   hono/html SSR 壳与页面级无 JS 兜底形态保留）。候选 B = 整页 React 接管，排除，
   理由链见 §4。**核心判断：动效是交互层需求，不是渲染管线需求——服务端 SSR 直出
   保持不动，React 只进浏览器侧岛屿，与既有 10 岛屿 `mount(root)` 契约同构。**
2. **依赖面：`react` + `react-dom`@19.3.1（npm latest 实测 2026-11-16，MIT）**，
   均为纯客户端依赖（不进 Node 进程），运行时依赖 3→5（观察指标，随卡 evidence 报告）。
3. **动效载体三级分层（推荐口径，范围清单 §3 供用户勾选）**：
   - **T1 纯 CSS**：既有 Motion token 体系内加 transition/keyframes，键在
     `body[data-sensory="on"]` 门控下（S2-17 感官层先例），零 JS 零依赖；
   - **T2 既有岛屿增强**：原生 TS 岛屿内加 class/逻辑（不引 React）；
   - **T3 React 承载**：迁移该岛屿或新建 React 岛屿——仅当 T1/T2 达不成
     （列表增删 FLIP、跨元素联动、焦点编排类动效）才升级到 T3。
4. **迁移只服务动效需求，不为框架化而框架化**：10 岛屿中推荐 React 化约 4–6 个
   （试点 audio-viz → keyboard-flow → search-box/add-dialog → wall-scroll/filter-cabin），
   globe-view/panorama-view 等命令式岛屿**推荐维持原生**（§4.6）。
5. **分期路线 P0–P4**（§6）：每阶段独立提交独立 check，check 基线 273/273 顺延；
   全部代码动工点均标注裁决归属。

## 2. 背景

- **需求事实源**：`01-产品理念终稿/需求草案-2026-11-15-发布后迭代第一批.md`
  R-103（框架裁决已确认）+ 专项二 S-B（动效范围与形态主人，React 为实现载体）。
  实施前置清单原文 = 动效范围清单 → 接线形态评审案 → G1/G2 口径修订（用户追认）→
  分阶段迁移 → IM 登记。本评审案产出前三项，IM 登记留实施批文环节（IM 只增不改）。
- **IM-30 效力边界**：甲组废止项（依赖≤2 / 无 JS 基线 / 无 hydration / CSS 20KB /
  首屏 2.33KB / RSS<100MB）自登记起不再是交付门槛，转观察指标随卡 evidence 如实报告；
  **但「废止 ≠ 实施」明文要求逐项实施前照出评审案**——本文件即该评审案。
  维持项（乙-1/乙-3/乙-5/乙-6/乙-10）逐条核对见 §5.5。
- **代码现状基线（d8653d0，2026-11-16 实测）**：
  - 首屏入口 main.js **2,847B**（vite 单入口 `src/client/main.ts`，岛屿经 ISLANDS
    注册表动态 import 自动切 chunk 懒加载）；10 岛屿 chunk 自 508B（keyboard-flow）
    至 1,082,011B（globe-view，内含 maplibre-gl）不等；
  - main.css **24,319B**（IM-14 已废止，观察值）+ globe-view.css 71,339B（随 globe chunk 懒加载）；
  - 运行时依赖 = 3（hono + @hono/node-server + maplibre-gl）；
  - `npm run check` = **273/273**（tsc / eslint / vite build / node:test，2026-11-16 复证）。
- **既有动效家底（盘点详见 §3）**：Motion token 体系已建（MASTER.md「Motion 3/10 —
  Subtle」：--dur-fast 150ms / --dur-base 200ms / --dur-slow 300ms / --ease-out/in，
  tokens.css 已实现并含 **prefers-reduced-motion 全局尊重段**）；感官层开关已上线
  （S2-17，评审案 Q8：`mg_sensory` cookie 缺省低动、`body[data-sensory="on"]` 门控、
  POST /settings/sensory 无表 + POST+303）；skeleton shimmer / toast-in / spine 对焦
  滑动 / 封面卡 hover 阴影过渡等已有实现。

## 3. 动效范围清单（提案——⚠️ 最终范围以用户勾选为准，本清单仅供裁决）

> 分级：**T1** = 纯 CSS transition/keyframes（零 JS 零依赖，键在 `body[data-sensory="on"]`
> 门控下，缺省安静）；**T2** = 既有原生岛屿内增强（加 class/逻辑，不引 React）；
> **T3** = React 承载（迁移该岛屿或新建 React 岛屿）。价值轴按产品原则优先级序
> **Find → Record → Organize → Review → Discover** 标注（序即建议权重）。

| # | 动效候选（页面/岛屿） | 用户价值 | 价值轴 | 分级 | 说明 |
|---|---|---|---|---|---|
| A1 | 封面墙首屏/追加进场 stagger（列表页 `/`，wall-scroll 追加页淡入落位） | 找回时逐张「翻检」的现场感，追加页无跳变 | **Find** | T1（首屏）/ T2（追加页给 `.cover-card` 加入场 class） | 出场 ≤ 入场（D-P4），y 偏移 ≤12px 读作淡入非滑动（MASTER GSAP 预设同口径） |
| A2 | 封面卡 hover 精修（meta 显隐 + 阴影/focus-ring 过渡） | 扫视墙时低成本确认目标 | Find | T1 | `.cover-card` 已有 box-shadow 过渡，补 meta 透明度过渡即成 |
| A3 | 筛选舱开合平滑过渡（S2-31 `<details>` 收纳后展开收起） | 筛选状态变化可感知、位置感不丢 | **Find** | T3（推荐）或 T1 降级 | `<details>` 原生无高度动画；T1 可用 grid-template-rows 0fr→1fr 近似（零 JS），T3 由 React 岛屿接管 filter-cabin 得到精确高度动画 + chips 增删 FLIP |
| A4 | chips 激活/去激活过渡与增删 FLIP（筛选舱、Tag 轴） | 筛选反馈即时；URL 即状态不变（chips 仍 `<a href>`） | Find | T1（激活态已有）/ T3（FLIP 需 JS） | ⚠️ DD3 红线：chips=`<a>` 语义必须保留，动效只作用于视觉层 |
| A5 | 墙到底/加载更多反馈过渡（`.wall-end` 淡入、回顶 #mg-top 平滑滚动） | 下拉限制后行为边界可感知 | Find | T1 | S2-30 产物之上的纯样式增量 |
| A6 | 搜索框建议面板展开/收起（search-box 双意图候选） | 添加/找回双入口的即时反馈 | **Find/Record** | T2 | 建议面板容器加 data-sensory 门控的 opacity/translate 过渡，岛屿内一行级 |
| A7 | 添加弹层 add-dialog 进出场 + 焦点编排（Modal C-规格） | 添加主路径仪式感与焦点不丢 | **Record** | T3（推荐） | 焦点陷阱 + 进出场动画是 React 擅长区（单组件状态机）；现状 add-dialog 149 行原生实现迁移风险低（有 add-dialog smoke 钉住） |
| A8 | flash banner / C-DUP 重复提示进出场 | 添加结果反馈可感知 | Record | T1 | `.flash`/`.dup-banner` 加入场动画（keyframes，门控下） |
| A9 | Favorite 心形填充过渡（♥ 激活瞬间 scale/填充动画） | 个人数据操作的即时确认 | **Organize** | T1 | `.cover-fav`/详情页 ♥，CSS 即可（transition + keyframes） |
| A10 | Tag chip 添加/删除/合并过渡（flash TAGS MERGED 之上） | Tag 低成本输入的反馈感 | Organize | T3（列表增删）或 T1（仅闪烁强调） | T3 候选：Tag 输入区 React 化后增删有 FLIP；T1 先行零风险 |
| A11 | 详情页（`/album/:id`）区块入场次序（封面→线索→回响卡 stagger） | 回顾页叙事节奏 | **Review** | T1 | MASTER GSAP 预设的纯 CSS 等价实现（scroll-triggered 可用 IO 一行级 T2，亦可纯 CSS animation） |
| A12 | 翻箱 crate 对焦滑动精修（crate-flip spine 之上：翻面过渡、抽屉感） | 回顾「翻箱子」触感 | Review | T2 | `.spine` 已有 data-sensory 门控 transition，微调时长/缓动即可 |
| A13 | 收藏全景 panorama-view 悬停命中/滚动 lerp 精修 | 回顾全景流畅度 | Review | T2 | panorama-view 348 行已有 hitTest/lerp 基座，属参数级增强 |
| A14 | Topster 网格构建入场（卡片逐格落位） | 策展成果呈现仪式感 | Review | T3（推荐） | 网格重排/落位 = 列表动画，React 承载自然；Topster = View 零第二套数据不受影响（乙-7） |
| A15 | 星图 genre-scan 节点入场 + 扫描波（gnode-playing ♫ 之上） | 探索流派的引导感 | Discover | T2 | SVG/CSS 可达；逐节点顺序试听逻辑不动 |
| A16 | 图集 /atlas 五态染色过渡与相机（已有 flyTo 1200ms + feature-state 染色） | 探索地图的连续感 | Discover | **维持现状** | maplibre 内建过渡已是 Radiooooo 同款；不重做 |
| A17 | 随机页 /random 揭示动画（抽卡感） | 回顾/探索的惊喜点 | Discover | T1 或 T3 | T1 = 卡片翻转/淡入 keyframes；T3 若日后做连续抽卡流 |
| A18 | 声音层（就地试听点缀、滚动叙事声效） | 档案的声音身份 | Discover | **不在本专项** | 归 S2-5/R-107 声音层评审（音频源合规先行）；本专项只管视觉动效 |

**诚实标注**：上表 = agent 提案，**做哪些、做到什么深度，判定权在用户**（勾选即范围定稿）。
建议裁决口径：**先勾 T1/T2 项**（零依赖零风险、全部键在感官层门控下），T3 项随 React
基座落地逐项再裁——T3 不与 T1/T2 抢排期，且每个 T3 项独立成卡可单独否决。
**合规底盘（非选项，随动效批自动生效）**：全部动效键在 `body[data-sensory="on"]` 下
（缺省安静 = S2-17 红线）；`prefers-reduced-motion: reduce` 全局尊重已在 tokens.css
在档（0.01ms 收敛）；新动效一律引用既有 Motion token，**禁发明新时长/缓动值**
（MASTER.md token 唯一来源纪律，新 token 须先进 MASTER.md 再进代码）。

## 4. React 接线形态评审（候选 A vs 候选 B）

### 4.1 候选定义

- **候选 A · React 局部岛屿替换**：`react`/`react-dom` 入 dependencies；TSX 岛屿与
  原生岛屿共用既有加载器契约——React 岛屿模块对外仍导出 `mount(root)`，内部
  `createRoot(root).render(<Island/>…)`；vite 单入口 + 动态 import 机制不变
  （React 运行时经 chunk 共享自动懒加载）；hono/html SSR 壳、页面级无 JS 兜底
  （chips=`<a>`、GET form、POST+303）全部保留。
- **候选 B · 整页 React 接管**：SSR 侧引入 `react-dom/server`（renderToString 或
  流式渲染）替换/并行于 hono/html；pages/*.ts 全量 JSX 化；客户端整页 hydrate。

### 4.2 候选矩阵（八维度）

| 维度 | **候选 A（推荐）** | 候选 B（整页接管） |
|---|---|---|
| 首屏体积 | ✅ main.js 2,847B 不涨：React 经 ISLANDS 动态 import 进懒加载共享 chunk，未挂 React 岛的页面零加载 | ❌ react-dom/client + hydration 运行时进每页首屏（即便页面无动效区） |
| 服务端 RSS | ✅ 零增量：React 纯浏览器侧，Node 进程不 require react | ❌ react-dom/server 进 Node 进程，SSR 渲染内存峰值随页面规模涨（G2 观察指标虽废止，真实成本仍在） |
| 迁移风险与节奏 | ✅ 逐岛迁移、逐岛可回滚；每岛独立提交独立 check；失败岛屿回退原生版零损伤 | ❌ 大爆炸迁移：pages/*.ts 12 文件 + 7 routes 域 JSX 化一次到位，中间态不可发布 |
| 与 hono/html SSR 耦合面 | ✅ 零耦合：服务端零改动；乙-6 禁 raw 纪律照旧（SSR 侧），React 侧 JSX 自动转义 = 乙-6 等效纪律天然成立 | ⚠️ 耦合深：转义纪律改由 react-dom/server 承担（等效成立），但 V9 评审清单/上下文纪律全要重写 |
| DD3 URL 即状态（乙-1） | ✅ 不动：chips=`<a>`、GET form、pushState/popstate 全在 SSR/岛屿层，React 化岛屿内部沿用既有 url-state 模式（wall-scroll/filter-cabin/globe-url-state 先例三件在档） | ⚠️ 全页接管后 fragment 交换（/fragment/wall、/fragment/cabin）、rel=next 服务端顺链等 DD3 内建形态需重新对齐，漏一处破红线 |
| 无 JS 基线形态（IM-30 废止后） | ✅ 页面级兜底保留（补核心路径表述修订，§5.2）——JS 失败时页面仍可浏览/筛选/添加 | ❌ 随整页接管消失（无 JS = 白页） |
| 四站后波次载体兼容（S2-4~S2-7：WebGL vs CSS 3D vs Canvas） | ✅ 全兼容：WebGL/Canvas 是命令式内核，React 岛屿以 ref/useEffect 挂载即可（globe-view 端口契约「换实现零改地图」先例同构）；框架选择与渲染载体解耦 | ⚠️ 无额外收益：整页接管对 WebGL/Canvas 载体没有帮助，反而把命令式内核硬塞进声明式全页模型 |
| 构建管线改动 | ✅ 最小：vite 已在（v8.3.7）；tsconfig 增 `jsx: react-jsx` + include 增 `*.tsx` 两行级；ESM 产物形态不变 | ❌ SSR 构建链新增（服务端 bundle 或 tsx 直跑 JSX），check 四件套外可能增第五件 |

### 4.3 推荐理由链（候选 A）

**4.3.1 需求本质决定形态：动效 = 交互层增强，数据仍由 SSR 直出。**
Musicgraphy 的页面是「查一次、看一屏」的个人档案页（cover-first、low cognitive
load），不是强客户端状态应用；列表/详情/筛选的全部数据已经由 hono/html SSR 直出
且无 JS 可用。React 在候选 A 里只做一件事：**接管需要复杂交互状态的容器**（弹层
焦点编排、列表增删 FLIP、开合高度动画），这些正是 React 声明式状态机的优势区；
数据获取、路由、URL 状态全部留在既有层。候选 B 为此重写整条渲染管线，收益面
却没有变大——动效需求被 2 个 React 依赖撬动，不该以 12 个页面文件的迁移为代价。

**4.3.2 首屏体积与服务端 RSS 双守恒（观察指标下的真实体验守恒）。**
IM-30 虽废止了硬预算，但「首屏 JS 2,847B」「5000 张压测可交互 34.4ms」（IM-20）
是产品体验资产，不是待突破额度。候选 A 下 React 运行时（react+react-dom min 约
130KB+ / gzip 约 40KB+，bundlephobia 口径观察值，以实际构建为准）只落在懒加载
共享 chunk：未挂 React 岛的页面不加载，挂了的页面按需加载——与 globe-view
1.08MB chunk 懒加载不进首屏完全同构。服务端 RSS 零增量（乙-10 内存纪律四条维持）。

**4.3.3 mount(root) 契约让加载器改动趋近于零。**
既有加载器（main.ts）按 `data-island` 名动态 import 并调 `mount(root)`，对模块内部
用什么框架**无感知**——React 岛屿导出同样的 `mount(root)`（内部 createRoot）即可
入表注册。唯一的加载器级改动 = 契约注释补一句「mount 可为 React 根」，零行为变更；
vite 单入口动态切 chunk 机制原样复用（10 岛屿先例）。这是候选 A 工程成本的下限来源。

**4.3.4 逐岛可回滚 = 12 周验证冲刺能承受的迁移节奏。**
每岛迁移 = 独立提交 + 独立 check 全绿 + smoke 测试钉行为；任何一岛出问题回退
原生版本即可（岛屿模块文件独立，无共享状态）。大爆炸迁移（候选 B）一旦中途受阻，
仓内不存在可发布中间态——违反「同一仓库先收口提交再开新工作」的并发现实纪律。

**4.3.5 四站后波次载体与 React 解耦。**
S2-4~S2-7 后波次载体（WebGL vs CSS 3D vs Canvas）在本评审案内**不预先裁决**，
但形态结论对三者全部成立：渲染内核（three/maplibre/原生 Canvas/CSS 3D transform）
都是命令式或纯样式，候选 A 的 React 岛屿以 ref/useEffect 挂载命令式内核即达
（globe-view 的 ports/adapter 端口契约是同构先例——「换实现零改地图」）；
候选 B 对任何一种载体都没有额外收益。

### 4.4 排除候选 B 的理由链（汇总）

① 服务端 RSS 真实上涨（react-dom/server 进 Node 进程）且带来 SSR 构建链第二套
管线；② pages/*.ts 12 文件 + routes 7 域 JSX 化 = 违反工程原则「不为单次需求顺带
重构无关模块」（最小影响范围→最小实现→验证）；③ DD3 大量内建于服务端渲染形态
（fragment 交换、rel=next 顺链、无 JS 兜底三件套），整页接管后每处都要重新对齐，
红线回归面最大；④ 无 JS 基线兜底消失（页面级降级能力归零）；⑤ 对四站载体无收益。
仅当未来出现「整页级强交互应用」（如全站实时协作、复杂客户端路由）才值得重评——
个人档案产品看不到该触发条件。

### 4.5 依赖面与版本口径

- **新增 dependencies**：`react@19.3.1` + `react-dom@19.3.1`（npm registry latest
  实测 2026-11-16，**MIT**；双包同版本锁定，lockfile 钉死）。运行时依赖 3→5，
  观察指标随卡 evidence 报告（G1 口径修订见 §5.1）。
- **构建产物形态**：ESM（vite 既有 target es2022 产出不变）；React 19 使用
  automatic JSX runtime（vite 内建支持，无需引入 JSX 工厂 import）；
  react-dom/client 仅客户端（Node 进程零 require——与 maplibre-gl 同款披露口径）。
- **tsconfig 影响**（实施期两行级）：`compilerOptions` 增 `"jsx": "react-jsx"`；
  `include` 增 `*.tsx`（现值仅 `src/**/*.ts`）。eslint 现有 typescript-eslint
  配置按需增 tsx 解析（实施时按 lint 实报调）。
- **测试面**：node:test 对 React 岛屿的测法 = 逻辑抽纯函数（岛屿先例同构）+
  createRoot 冒烟（jsdom 不引入——如需 DOM 断言，优先沿用「纯函数 + 服务端
  片段断言」既有测法，实施时按首个试点岛实测定型并留档）。

### 4.6 迁移顺序提案（10 岛屿逐个 or 分批——推荐「按需小批」）

> 原则：**迁移只服务动效需求**（§1.4）。无动效诉求的岛屿保持原生 = 最小改动原则；
> 每批独立提交独立 check，任何批可单独否决/跳过。

| 波次 | 岛屿（行数） | 动效驱动 | 风险评估 |
|---|---|---|---|
| R1 试点 | audio-viz（73） | 验证「React + 命令式 Canvas」interop 模式定型（ref + useEffect 挂 rAF 波形） | 最低：最小岛 + audio-viz smoke 已有 |
| R2 | keyboard-flow（33）→ search-box（106）→ add-dialog（149） | Record 主路径：弹层焦点编排（A7）、建议面板过渡（A6） | 低：三岛均有 smoke；add-dialog 为 A7 主收益 |
| R3 | wall-scroll（144）→ filter-cabin（91） | Find 主路径：追加进场（A1）、开合高度动画 + chips FLIP（A3/A4） | 中：DD3 热区——chips=`<a>` 语义与 url-state 模式原样保留，smoke 全量钉住 |
| R4 | crate-flip（104）→ genre-scan（81） | Review/Discover：翻箱触感（A12）、星图入场（A15） | 低 |
| R5 | panorama-view（348）/ globe-view（1,156 目录） | **推荐维持原生，不迁移** | —：两岛命令式内核（lerp/hitTest、maplibre）已稳定上线且无 React 化收益；仅当用户点名才立项 |

（10 岛屿中 React 化候选 = R1–R4 共 8 个，其中按动效勾选结果可能仅做 4–6 个；
panorama-view/globe-view 两岛建议明确豁免，写进实施批文防范围蔓延。）

## 5. 口径修订案（IM-30 效力内——修订文本只入本评审案附录，正式修订随实施批文落）

### 5.1 G1 依赖数预期值

- 预期：**运行时依赖 3→5**（+react +react-dom，均纯客户端）。IM-30 甲-1 口径下
  为观察指标：随每张动效卡 evidence 如实报告「依赖数 = N（本批 Δ±x）」；
  不设硬上限，**但单卡新增依赖须在该卡评审案中具名**（防依赖静默增长——
  观察指标 ≠ 不看，乙-5 零 CDN 仍逐依赖核对「构建进 dist」）。

### 5.2 「无 JS 基线」形态存废表述（修订文本见附录 B）

- 现状：「无 JS 基线」作为红线已废止（甲-2），但 ADR-003/IM-19 的**架构遗产仍在
  服役**（chips=`<a>`、GET form、POST+303、fragment 无 JS 兜底——它们是 DD3 与
  乙-1 的载体，候选 A 下继续保留）。
- 修订方向：把「无 JS 基线」从**架构门槛**改述为**产品兜底承诺**——新表述 =
  「SSR 直出为默认形态；客户端脚本（原生岛屿或 React 岛屿）为增强层；核心路径
  （浏览 / 筛选 / 添加）保持无 JS 可用」。效力变化：允许岛屿形态自由（React 化
  不再需要架构豁免），但核心路径的 `<a>`/form 语义升级为**产品承诺**受乙-1 保护
  （即：React 化不得把 chips 改成 div-onClick——DD3 URL 即状态锁死）。
- 修订文本全文见附录 B，**只随实施批文落 00-硬约束/主线 AGENTS.md 正式文件**，
  本评审案不直接改正式文件（文件边界纪律）。

### 5.3 首屏体积与 CSS 预算重算口径

- **口径 = 观察指标 + 证据模板，不设硬线**（甲-5/甲-6 已废止）：
  - 首屏 JS：每批动效卡 evidence 报「main.js = N B（Δ±x B）」——React 运行时
    不进 main.js（§4.3.2），预期 main.js 稳定在 ~2.8KB±0.3KB；
  - chunk 表：React 化批次 evidence 附 `dist/static/chunks/` 尺寸表（既有提交
    说明习惯沿用），React 共享 chunk（react+react-dom）单列观察值；
  - CSS：IM-14 废止后转观察值，每批报「main.css = N B（Δ±x B）」；**软提醒线
    （非门槛）**：单批 ΔCSS > 2KB 时 evidence 须说明增量构成（防无意识膨胀；
    globe-view.css 71KB 与 main.css 分轨，不计入 main.css 观察）。
- **测量命令（可核查）**：`npm run build` 后 `ls -la dist/static/ dist/static/chunks/
  dist/static/assets/`（本评审案 §2/§8 数字即此法实测）；gzip 值沿用提交说明
  既有口径（如 main.css 24,319B / gzip 口径随批披露）。

### 5.4 RSS / 性能观察指标测量方案

- **服务端 RSS**：React 为纯浏览器侧依赖，Node 进程 RSS **零增量**——维持既有
  看门狗口径（--max-old-space-size=64 冻结项不变），随卡 evidence 报 boot RSS +
  5000 张压测口径（IM-20 基线沿用）。
- **客户端性能**（动效批专项观察）：
  - 首屏：main.js 字节（§5.3）+ dev server 手测 LCP 一次/批（IAB 浏览器实测先例）；
  - 动效帧率：长列表（5000 张）封面墙 stagger 开启态手测无卡顿（ sensory on/off
    两态对照）；帧率不设数字门槛，肉眼流畅 + reduced-motion 收敛即为过；
  - 交互基线回归：动效批收口时复跑 perf-like（LIKE 1–2ms）与压测可交互基线，
    防止动效批次悄悄伤 Find 主路径。
- **check 基线**：乙-3 锁死不变——每批收口前置 `npm run check` 全绿，
  273/273 基线顺延（§6 每阶段预估增量）。

### 5.5 维持红线逐条核对表（候选 A 实施面）

| # | 红线/口径 | 核对结果与处置 |
|---|---|---|
| 1 | **乙-1 DD3 URL 即状态** | ✅ chips=`<a>` / GET form / pushState 语义全部保留；React 化岛屿内部沿用既有 url-state 模式（wall-scroll/filter-cabin/globe-url-state 先例）；A3/A4 明文标注 |
| 2 | **乙-5 资产自托管零 CDN** | ✅ react/react-dom 经 vite 构建进 dist/static（ESM 本地 import，禁 unpkg/esm.sh 类外链写法）；无字体/图标新增 CDN |
| 3 | **乙-6 禁 raw 插用户数据** | ✅ 服务侧 hono/html 纪律不动；React 侧 JSX 默认转义 = 等效纪律天然成立；dangerouslySetInnerHTML **禁用**（进实施批文纪律条款） |
| 4 | **乙-10 内存四纪律** | ✅ 服务端零改动；LIMIT≤60/封面流式/禁 base64/stmt 缓存全部不受影响 |
| 5 | **乙-3 check 全绿** | ✅ 273/273 基线顺延，每批独立全绿（§6） |
| 6 | **隐私红线（缺省低动）** | ✅ 全部动效键在 `body[data-sensory="on"]` 门控下（S2-17 既有开关），缺省安静 |
| 7 | **可访问性** | ✅ prefers-reduced-motion 全局尊重已在 tokens.css 在档；焦点编排类动效（A7）顺带补齐弹层焦点陷阱（既有 a11y 增量） |
| 8 | **设计系统一致性** | ✅ 新动效 token 先进 MASTER.md 再进代码（token 唯一来源）；y 偏移 ≤12px / 出场 ≤ 入场沿用既有 Motion 规范 |

## 6. 分期实施路线（每阶段裁决点标注）

> 基线：check 273/273（d8653d0）。每阶段 = 独立派工单 + 独立提交 + 独立看板卡
> （或挂 S2-3 分段 evidence）；阶段间可间隔，无顺序锁死的标 ✚ 可并行。

| 阶段 | 内容 | check 基线预估 | 裁决点（须用户批准才动代码） |
|---|---|---|---|
| **P0** | 本评审案获批：①动效范围勾选（§3 表）②接线形态追认（候选 A）③口径修订案追认（§5）④迁移豁免单确认（panorama-view/globe-view 维持原生） | —（纯文档） | **本评审案全部裁决项（§7）** |
| **P1** | React 基座：react/react-dom@19.3.1 入 deps + tsconfig/eslint 两行级 + 试点岛 audio-viz React 化（interop 模式定型）+ 契约注释更新 | 273 → ~276±3 | react/react-dom 入 dependencies；试点岛选择 |
| **P2** ✚ | T1 动效批（§3 中用户勾选的 T1 项）：纯 CSS + data-sensory 门控，零依赖零 React——**可在 P0 后立即先行**，不依赖 P1 | +2~4 smoke | 范围 = P0 勾选结果；新 Motion token 增补 MASTER.md（文档批） |
| **P3** | React 迁移波次 R2→R3→R4（§4.6），每波独立提交；T3 动效项随所属波次落地 | 每波 +3~6 | 每波开工令（用户按批次放行）；R3 涉 DD3 热区 = 波内 smoke 全量钉住后放行 |
| **P4** | 四站后波次载体同批裁决（S2-4~S2-7：WebGL vs CSS 3D vs Canvas）——各载体均以候选 A 岛屿为可选壳实施；与 React 基座解耦，P4 排期权在用户 | 随各卡另评 | 四站各卡独立评审案（本评审案只锁定「载体选择不受框架约束」） |

**验收口径**：每阶段收口 = check 全绿 + 看板同步（四字段）+ daily 日报 + 证据可核查
（§5.3/§5.4 模板）；P1–P3 完成后 IM 登记一次（IM 编号顺延，只增不改）。

## 7. 待裁决清单（用户逐项批——批前零代码动工）

| # | 事项 | 建议 |
|---|---|---|
| 1 | 接线形态裁决 | **候选 A（React 局部岛屿替换）**；候选 B 排除（§4.4） |
| 2 | react/react-dom@19.3.1（MIT）入 dependencies | 批准（运行时依赖 3→5，观察指标如实披露） |
| 3 | 动效范围勾选 | §3 表逐项勾选；建议先勾 T1/T2 项，T3 随波次逐项再裁；A16 维持现状 / A18 移交 S2-5 |
| 4 | 「无 JS 基线」表述修订 | 批准附录 B 文本方向，正式落文随实施批文 |
| 5 | 预算口径 | 批准「观察指标 + 证据模板，不设硬线；单卡新增依赖须具名评审」（§5.1/§5.3） |
| 6 | 分期路线与波次 | 批准 P0–P4 结构与 R1–R5 顺序；每波开工另行放行 |
| 7 | 迁移豁免单 | panorama-view / globe-view 维持原生不 React 化，写入实施批文 |
| 8 | T1 先行授权（可选） | 若 P2（纯 CSS 批）与 React 基座解耦先行，可单独批（✚ 标注依据） |

> 否决/变更的回滚路径：候选 A 每岛独立可回退原生版；依赖层回滚 = package.json
> 移除 react/react-dom + 删除 tsx 文件（无服务端牵连）；P2 纯 CSS 批零依赖零回滚成本。

## 8. 证据清单（可核查）

**Web 核查（2026-11-16 实取）**

| 事实 | 出处 |
|---|---|
| react latest = 19.3.1，license = MIT | <https://registry.npmjs.org/react/latest> |
| react-dom latest = 19.3.1，license = MIT | <https://registry.npmjs.org/react-dom/latest> |

**仓内证据（d8653d0，2026-11-16 实测）**

| 事实 | 出处 |
|---|---|
| 首屏 main.js = 2,847B；chunks：add-dialog 3,785 / audio-viz 1,252 / crate-flip 1,869 / filter-cabin 1,439 / genre-scan 1,357 / globe-view 1,082,011 / keyboard-flow 508 / panorama-view 5,316 / search-box 1,697 / wall-scroll 2,064 B；main.css 24,319B + globe-view.css 71,339B | `musicgraphy/dist/static/` `ls -la`（vite build 产物，2026-11-16 00:00 构建） |
| 运行时依赖 = 3（hono + @hono/node-server + maplibre-gl） | `musicgraphy/package.json` dependencies |
| 10 岛屿行数：add-dialog 149 / audio-viz 73 / crate-flip 104 / filter-cabin 91 / genre-scan 81 / globe-view 目录 1,156 / keyboard-flow 33 / panorama-view 348 / search-box 106 / wall-scroll 144 | `wc -l src/client/islands/*` |
| 加载器契约（data-island 名 → 动态 import → mount(root)，岛屿失败不拖垮页面） | `src/client/main.ts`（ISLANDS 注册表 + mountIslands） |
| vite 单入口动态切 chunk（base /static/，entryFileNames [name].js） | `musicgraphy/vite.config.ts` |
| Motion token 实现（--dur-fast 150ms/--dur-base 200ms/--dur-slow 300ms/--ease-out/in）+ prefers-reduced-motion 全局尊重段 | `src/client/styles/tokens.css`（Motion 段 + 尾部 media 段）；MASTER.md「Motion Tokens（Motion 3/10 — Subtle）」 |
| 感官层开关（mg_sensory cookie / body[data-sensory="on"] 门控 / POST /settings/sensory 无表 POST+303） | `src/server/html.ts` sensoryToggle + `routes/pages.ts:698` + 评审案 docs/design-refs-review.md Q8 |
| 既有动效实现（skeleton shimmer / toast-in / spine 门控过渡 / cover-card hover） | `src/client/styles/app.css:267/291/372/148` |
| 页面与路由全景（本评审案动效盘点范围） | `src/server/routes/pages.ts`（`/` `/album/:id` `/crate` `/genres` `/panorama` `/random` `/topsters*` `/add` `/settings/sensory` 等）+ routes 域 7 文件 |
| SSR 资产形态（构建缺失照常 SSR；layout 挂 keyboard-flow 隐藏岛） | `src/server/html.ts` asset()/layout() |
| check 基线 273/273 | 看板 progress-data.js + 提交 d8653d0 说明（2026-11-16 实跑复证在档） |
| tsconfig 现值（无 jsx 配置、include 仅 *.ts——实施期两行级增量） | `musicgraphy/tsconfig.json` |

**文档证据**

| 事实 | 出处 |
|---|---|
| R-103 裁决状态与实施前置清单原文 | `01-产品理念终稿/需求草案-2026-11-15-发布后迭代第一批.md` §R-103 |
| 专项二 S-B 范围与合并执行路径原文 | 同上 §专项二 S-B |
| IM-30 废止/维持全清单（甲-2/5/6/7 废止；乙-1/3/5/6/10 维持） | `05-系统架构设计/实现决策记录.md` IM-30 |
| IM-19 岛屿形态与 htmx 不引入沿革（历史参考） | 同上 IM-19 |
| 「废止 ≠ 实施」效力说明 | 同上 IM-30 尾段 + 需求草案「红线批注记录·效力说明」 |
| 硬约束 v1.3 修订落点 | `00-工作区关系与硬约束.md` §二.5 |
| 格式与先例（评审闸门卡同族） | `05-系统架构设计/评审案-地理渲染引擎选型.md` |

---

## 附录 A · 口径修订案文本（G1 观察指标——随实施批文落，本附录仅为定稿底稿）

> 落点预写：00-工作区关系与硬约束.md §二.5 / 主线 AGENTS.md §1 / 根 AGENTS.md §1 的
> G1 行；00-硬约束 v1.3 → v1.4（版本号随实施批文顺延）。

修订文本（替换「运行时依赖 ≤2」相关表述处）：

> 运行时依赖数为**观察指标**（IM-30 甲-1）：随卡 evidence 如实报告当前值与批量变化，
> 不作交付门槛。纪律：① 任何新增运行时依赖须在该卡评审案中具名并核对乙-5
> （构建进 dist，零 CDN）；② 服务端进程新增 require 型依赖另行评审（RSS 观察
> 口径联动）；③ 当前值基线 = 5（hono + @hono/node-server + maplibre-gl +
> react + react-dom@19.3.1，S2-3/R-103 批登记）。

## 附录 B · 「无 JS 基线」表述修订文本（随实施批文落，本附录仅为定稿底稿）

> 落点预写：00-硬约束 §二.5 废止清单甲-2 行补注 + 主线 AGENTS.md §1 架构红线段 +
> ADR-003 状态注记（05-系统架构设计/DESIGN.md 或五维复审报告 V4 处按索引事实源
> 就近补注，不改 V4 原文）。

修订文本（新表述，替换各处「无 JS 基线」门槛措辞）：

> **SSR 直出为默认形态；客户端脚本（原生 TS 岛屿或 React 岛屿）为增强层**——
> 「无 JS 基线」自 IM-30 甲-2 起由架构门槛转为**产品兜底承诺**：核心路径
> （浏览 / 筛选 / 添加）保持无 JS 可用（chips=`<a href>`、搜索=GET form、
> 添加=POST+303、fragment 无 JS 兜底），该语义受乙-1（DD3 URL 即状态）保护——
> 任何框架化改造不得将其降级为 div-onClick 类 JS-only 交互。
> 岛屿实现形态自由（原生 TS / React 均可），沿用 `data-island` + `mount(root)`
> 加载契约（React 岛屿内部 createRoot，对外契约不变）。ADR-003 的「岛屿 =
> 渐进增强」理念作为设计取向保留，不再作为架构约束条款引用。

---

*记录：ZCode · S2-3 评审会话 · 2026-11-16 · 依据 = 需求草案 R-103/S-B 原文 +
IM-30/IM-19 实读 + 主线仓 d8653d0 代码现状实读（islands/main.ts/html.ts/vite.config/
package.json/tsconfig/tokens.css/app.css/routes 全只读）+ dist 产物实测 + npm registry
双包版本核查（react/react-dom 19.3.1 MIT）。本评审案 = 纯文档零代码变更；S2-3 卡
evidence 明写「实施阶段待用户批文」。裁决完整记录（IM 登记）留实施批文环节
（IM 只增不改）。S2-3 · R-103 · 专项二 S-B · IM-30 · 乙-1 · 乙-3 · 乙-5 · 乙-6 · MASTER.md*
