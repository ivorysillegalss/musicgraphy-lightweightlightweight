# 分析 · 展示升级 R-117 Hover 信息卡（详情不点进去）

> **性质**：R-117 分析件（子 agent 并行分析五路之一）——纯分析零代码零看板改动；
> 格式对齐需求草案《需求草案-2026-11-18-前端展示与动效升级.md》执行序第 1 步。
> **需求原文（R-117）**：「另外 我不希望所有的介绍页面只有点进去的详情 可以通过Hover的形式来展现
> 当前的一些基本信息 如词曲制作人」。
> **依据实读**：需求草案 R-117 节 + 主线 d8653d0 全只读（html.ts / pages/album.ts / db/types.ts /
> db/queries.ts / db/panorama.ts / db/migrations/0001·0003·0005 / pages/collection.ts·crate.ts·
> genremap.ts / client/main.ts / islands/ wall-scroll·crate-flip·panorama-view·genre-scan·
> keyboard-flow·globe-view 五态 / styles/app.css·tokens.css / metadata/sources.ts·musicbrainz.ts /
> config.ts）+ 文档包（评审案-React接入与动效专项 / 评审案-网易云专辑导入器 / 评审案-netease元数据补全 /
> 05/实现决策记录 IM-25/26/31/32/33 / 07-前端设计包 MASTER.md）。
> **诚实纪律预告**：词曲制作人（credits）在现有 schema **不存在**（§2.2 逐列核对）——
> 本分析按两阶段拆解：阶段一 = 现有字段立刻可做；阶段二 = credits = **迁移 0006 + 补全管线，
> 须另立评审案**，本文只给成本量级与数据源选项，不承诺覆盖率。

---

## ① 现状诊断：hover 面只承载「身份」，不承载「基本信息」

### 1.1 现有 hover 面盘点（d8653d0 实读）

| 触点 | 现状 | 承载内容 | 键盘同权 | 出处 |
|---|---|---|---|---|
| 封面墙卡 `/`（含详情页 ASSOCIATIONS 区、/random 复用同件） | hover 显 `cover-meta` 渐显 | 仅标题 / 艺术家·年份（身份三件套） | ✅ 已有 `:focus-visible` 同权（先例） | html.ts `coverCard()` L201；app.css L163-171 |
| 翻箱侧脊 `/crate` | hover/`.current` 显书脊标签 | 仅标题（艺术家在 `title` 属性=浏览器原生 tooltip，移动端不显示） | ⚠️ 部分：键盘流 `.current` 显标签，但 Tab 直达无 `:focus-visible` 态 | pages/crate.ts `spineCard()`；app.css L371 |
| 流派星图节点 `/genres` | 仅浏览器原生 tooltip | `N 张 · 流派——点按筛选`（count 有、唱片名无） | ❌ 无 focus 态（节点是 `<a>` 可聚焦，样式没跟上） | pages/genremap.ts L39-41；app.css L358 |
| 收藏全景 `/panorama` | 指针 cursor 反馈（pointer/grab） | 零文字（`hoverId` 已算出但只喂给 P 键试听） | ❌ Canvas 无可聚焦节点 | islands/panorama-view.ts L239-247（hitTest/hoverId 基座已在） |
| 星图地图 `/atlas` | 国家面五态 hover 染色 | 国家名 DOM 标注（labels.ts Marker 先例）——**国家级、无专辑级实体** | ❌（role="img" 岛根内后代对 AT 不可达，globe-view.ts L85 注记自认） | globe-view/five-state.ts、labels.ts |

### 1.2 问题诊断

1. **详情-only 的信息断层**：基本信息（Genre / 来源 / 国家 / 用户的 note / Tags / 听的时期 /
   Favorite）全部只存在于详情页 `meta-table` 与个人区（pages/album.ts L79-92）——
   找回场景里用户必须逐张点进去才能确认「是不是这张」，违反 Find 优先级（渐进式过滤、低成本确认）。
2. **hover 面与 hover 卡是两件事**：现 `cover-meta` 是「卡内 meta 条」（裁切在 `.cover` 的
   `overflow:hidden` 内、app.css L150-155），承载不了多行富内容；R-117 要的是**信息卡**
   （可多行、可含 note 等用户数据），形态必须升级。
3. **触屏零处理**：全站没有任何 `@media (hover: none)` / `(pointer: coarse)` 适配——
   hover 类展示在触屏上天然不可用（现状可接受的原因：点按 = 跳详情，详情就是触屏的信息面；
   升级后须显式写明降级纪律，见 §2.4）。
4. **需求原文点名的词曲制作人 = 纯数据缺口**，不是前端缺口：`album_metadata` 全列
   （0001 + 0003 迁移逐列核对）= id/source/source_id/title/artist/release_year/cover_url/
   cover_local/genres/country/alias_sources/created_at/updated_at——**无 credits 列**；
   `AlbumRow`/`CollectionItem`/`CollectionDetail` 三类型同口径（db/types.ts L10-66）。
   iTunes 无结构化 credits（仅 ℗ 版权文本行）；MusicBrainz relation 可取（覆盖不稳）；
   Discogs extraartists 结构化最好（需 token）——与需求草案 R-117 现状锚点判词一致。

---

## ② 两阶段方案

### 2.1 阶段一：现有字段 hover 卡（零迁移零管线，立刻可做）

#### 字段集（建议稿，终稿随评审案由用户勾选）

**卡面两段式 = 外部元数据（可替换）+ 个人线索（你的资产）**，对齐详情页双区分野：

| 分段 | 字段 | 来源（墙/翻箱路径） | 数据可得性 |
|---|---|---|---|
| 身份行 | 标题（粗体）+ 艺术家 | `CollectionItem.album.title/artist` | ✅ 已在 LIST_COLS |
| 元信息行 | 发行年份 · Genre（前 2-3 项 + …）· VIA 来源 | `release_year` / `genres` / `album.source` | ✅ 全在 LIST_COLS（零 SQL 改动） |
| 个人线索行 | 当时（note，截断 ~60 字）· 听的时期 · ♥ Favorite | `note` / `listened_at`+`listened_precision` / `is_favorite` | ✅ 全在 LIST_COLS（r.note 一直在查、只是没渲染） |
| 可选第二行（待裁决） | Tags · 国家 | tags 需逐记录聚合查询（SQL_RECORD_TAGS 是按单 id 查）；country 仅在 DETAIL_COLS | ⚠️ 两项都**不在**墙查询现选列——tags 进卡 = 查询聚合改动（中）；country = LIST_COLS +1 列（小）；建议阶段一先不上（R-114 减量精神：卡面克制） |

**诚实标注**：`CollectionItem`（mapItem）确实没映射 country/alias_sources——但根因在
`LIST_COLS` 没选（queries.ts L3-5），不是「拿不到」；凡涉及增列的都在开放问题清单里明示。

#### 各触点承载与阶段一覆盖面

| 触点 | 阶段一覆盖 | 载体形态 | 依赖改动 |
|---|---|---|---|
| 封面墙 `/`（首屏 60 + 岛屿追加 3×60） | **全覆盖** | SSR `coverCard()` 输出加 `data-hc-*` 数据属性（hono/html 自动转义）；**追加页同源**——wall-scroll 注入的是服务端转义片段（`tpl.innerHTML = text` 后原样并入，wall-scroll.ts L66-75「禁再加工」），SSR 模板改一处首屏/追加自动同权 | coverCard 模板 + 新岛屿 + CSS |
| 详情页 ASSOCIATIONS 区 / 回响卡 / /random | **自动继承**（复用 coverCard / CollectionItem 同族） | 同上 | 零额外改动 |
| 翻箱侧脊 `/crate`（含 /fragment/crate 续箱） | **全覆盖** | `spineCard()` 加同一套 data 属性；书脊本体太窄，hover 卡浮层是唯一合理形态 | spineCard 模板 + 同岛屿委托 |
| 流派星图 `/genres` gnode | **部分**：名称 + 张数立刻可做（现有 title 属性内容升级为卡）；「代表唱片 N 张标题」须新增按流派聚合查询（GROUP_CONCAT 类，小但独立） | gnode 是 DOM `<a role="listitem">`（非 canvas）——同一岛屿委托即可 | 可选查询增量 |
| 收藏全景 `/panorama` | **全覆盖（字段减配）**：卡 = t/a（payload 已有，截断 24/18 字）；year/genre = payload +2 字段（SQL 已 SELECT、只是丢弃——`SQL_ATLAS_ROWS` 取了 year/genre 用于布局，panorama.ts L33-36/L80-82）；note/tags 进卡 = payload 增重 + SQL 改（note 须服务端截断，建议缓议） | Canvas 命中已有 `hitTest`/`hoverId`（S2-15 P 键先例）——DOM 浮层挂在 canvas 上方、按节点屏幕坐标定位；**零重绘**（浮层是兄弟 DOM，不进 draw()） | panorama-view 岛屿内 +60 行级 + payload 微扩 |
| `/atlas` 星图地图 | **阶段一不覆盖（诚实缓议）**：地图实体 = 国家非专辑，五态 hover 已有染色反馈 + DOM 标注先例；「国家 → 该国专辑数/代表专辑」是另一种卡（须 availability/聚合数据面），不属于 R-117「专辑基本信息卡」范畴 | — | 建议不进本卡范围 |

#### 交互纪律（建议稿）

- **触发延迟**：hover-intent ~200ms 定时器（对齐 `--dur-base` 200ms，MASTER Motion token，
  禁发明新时长）；扫墙快速掠过不闪卡；移出即隐（+~100ms 宽限防跨卡抖动）；滚动/Escape 立即隐。
- **定位策略**：单例浮层 `position: fixed`，锚 = 触发卡 getBoundingClientRect，默认下方、
  视口边缘翻转（上/左右）；`max-width ~280px`；**浮层自身 `pointer-events: none`**
  （非交互卡 → 不抢点击、无嵌套交互问题、移出即隐语义干净）。
- **键盘同权（focus-within 同权纪律）**：cover-card / spine / gnode 全是原生 `<a>` 可聚焦——
  `focusin` 触发同一张卡（无延迟），`focusout` 隐；CSS 侧保留 `:focus-visible` 显现兜底
  （app.css L169 既有先例的延伸）。卡内内容同时被 `aria-label`（现有 title · artist）覆盖读屏基线，
  扩展字段用 `role="tooltip"` + `aria-describedby` 关联（实施评审案定稿）。
- **触屏降级**：`matchMedia('(hover: hover)')` 不匹配 → 岛屿不布防、零监听——触屏行为完全
  维持现状（**点按 = 进详情，详情就是触屏的信息面**，不劫持首 tap）。长按显示卡 = 可选后置项
  （contextmenu/touchstart 计时），阶段一不建议（见开放问题 #5）。
- **no-JS 基线**：岛屿全挂后，无 JS 时各触点维持现有形态（cover-meta / spine-label /
  title 属性）——符合 React 评审案附录 B「SSR 直出为默认形态；客户端脚本为增强层；
  核心路径无 JS 可用」的产品兜底承诺（浏览路径不受影响，hover 卡是纯增强）。

### 2.2 阶段二：词曲制作人（credits）数据扩展——**须另立评审 + 迁移，本文不承诺**

#### 结论先行（诚实第一）

**credits 在现有 schema 不存在，任何 credits 上墙 = 阶段二，前置 = 另立评审案 +
迁移 0006 + 补全管线（B10/mb-calibrate 同族）。阶段一 hover 卡先上、credits 字段留
卡面扩展位（有则显、无则隐），两阶段解耦——阶段一不含糊、阶段二不画饼。**

#### 迁移案轮廓（乙-8 口径：0006+ 顺延，DDL 包事务）

- 形态建议：`ALTER TABLE album_metadata ADD COLUMN credits TEXT NULL`——**纯加列**，
  无 CHECK 重建（对比 0003 改 source CHECK 才被迫四步重建表），成本远低于 0003；
  内容 = JSON 数组 `{role, name}[]`（role 口径建议 = 作词/作曲/制作人三槽起步，UTF-8 原文存储，
  渲染层不做 role 翻译映射——诚实保留上游原词）。
- 只补空语义沿用 IM-12 / B10 Q2（行现值优先，不覆盖）；fail-soft 延续（单字段失败不连坐整行）。
- 备份纪律不受影响（乙-8 VACUUM INTO 口径照旧；WAL 期禁文件复制）。

#### 补全管线案轮廓（mb-calibrate 同族）

- 复用件：`resolveReleaseByArtistAndTitle` + `fetchJson`（限流 + 503 退避 + 错误归一，
  b180dd7 产物）+ alias_sources 已记 MBID 的行**零搜索直接 lookup**（B10 已补 105 行 country
  → 这些行有 musicbrainz 关联）；resumable 幂等续跑；dry-run 预演先行（B10 Q4 同款，
  503 退避 min(Retry-After ?? 60, 120)s 已在档）。
- 新增件：lookup 方法（MB relations 解析或 Discogs release lookup）+ calibrate 脚本扩展
  credits 合并 + 回归测试 +10~15 项级（B10 规模 = b180dd7 一笔的量级）。

#### 上游源覆盖诚实矩阵（不承诺覆盖率——须 dry-run 实测后才知道）

| 数据源 | credits 结构化程度 | 覆盖预期（诚实） | 成本与前置条件 | 判定建议 |
|---|---|---|---|---|
| **MusicBrainz** | release/release-group artist-relations（producer/mixer 等）；**作曲/作词常在 work 级**——钻取 = 每张多次调用 | 华语/独立厂牌覆盖不稳，欧美主流较好；B10 经验：resolve 前 16 张全命中后级联 503 | 1~3 lookup/张 @30/min；181 张 netease 行 ≈ 6~17 分钟/轮；503 墙先例在档（剩余 ~67 行 genres 未定） | **主源候选**（零新增凭据、管线全现成） |
| **Discogs** | `/releases/{id}.extraartists`——Producer / Written-By 等**结构化最好** | 西方 catalog 强、华语弱；冷门兜底定位（sources.ts L266 注记同源） | 需 `DISCOGS_TOKEN`（config.ts L41 槽位已在 + 无 token fail-soft 停用先例在）；现 DiscogsSource 只有 database/search、**无 release 详情 lookup**（须新增方法）；带 token 60/min | **辅源候选**（凭据 = 用户裁决项） |
| iTunes | 无结构化 credits（lookup 仅 copyright ℗ 文本行，不可拆） | — | — | **否决**（R-117 需求草案锚点同判） |
| netease api-enhanced | 歌曲级 ar/composer 端点**不在现调用面**（§9 六路由清单之外）；专辑描述文本非结构化 | 华语可能好 | 扩大逆向调用面（灰色面扩张）+ 文本清洗成本高 | **不建议**（诚实标注：调用面扩张须用户单独裁决） |

- 成本量级小结：迁移 1 文件（纯加列）+ 类型/解析（mapAlbum + parseCredits）+ lookup 方法 +
  脚本扩展 + 测试 ≈ **一个 B10 级卡片**（b180dd7 当日收口先例）；但**数据可得性 = 未知数**，
  须 dry-run 实测命中率后才能给 coverage 承诺——这正是「须另立评审」的理由。

### 2.3 卡面信息架构（合并两阶段）

```
┌──────────────────────────┐
│ 《标题》                  │  ← 粗体（--text-small 起步，R-113 重定标后自动继承）
│ 艺术家 · 1998             │  ← 元信息行
│ Rock, Jazz …             │  ← Genre 前 N + 截断
│ VIA NETEASE              │  ← mono 来源行（详情页 VIA 同款）
│ 当时：一句话……            │  ← note 截断（琥珀注记色，个人资产分段）
│ 听的时期：2021 年 · ♥     │  ← 个人线索尾行（有则显、无则整行隐）
│ 作词 x · 作曲 y · 制作 z  │  ← 阶段二扩展位（credits 有则显；无则此行不渲染）
└──────────────────────────┘
```

空字段整行不渲染（诚实空态——不摆「—」占位堆砌密度，与详情页 meta-table 口径不同：
详情页是档案全貌，hover 卡是扫视摘要）。

### 2.4 触屏与可访问性纪律（写明成约束，供实施评审案引用）

1. hover 卡 = **纯增强层**：无 JS / 触屏 / hover 不可用环境的信息面 = 详情页（点按即达），
   该降级路径是产品兜底承诺的一部分（React 评审案附录 B 表述），不得劫持首 tap。
2. 键盘 = focus 同权：可聚焦触点（a/spine/gnode）focusin 即显、focusout 即隐、Escape 可关；
   `:focus-visible` CSS 兜底不依赖 JS。
3. 触屏 = 显式退出：`(hover: hover)` 媒体查询 + JS matchMedia 双闸；不实现隐式长按。
4. reduced-motion：显隐过渡走 `--dur-*` token，tokens.css 全局 reduced-motion 段自动收敛
   （0.01ms 直达终态）；是否叠加感官层门控见开放问题 #9。
5. 读屏：卡内容 role="tooltip" + 触发元素 aria-describedby；触发元素现有 aria-label 保持不变。

---

## ③ 实现影响面：单例浮层 vs 卡内嵌 CSS hover（T1/T2/T3 归层）

### 3.1 两方案对照（推荐 = 单例浮层，T2 起步）

| 维度 | 方案 A：各卡内嵌 CSS hover（T1 纯 CSS） | **方案 B：单例浮层 + 事件委托（推荐，T2）** |
|---|---|---|
| 形态 | 每张卡内埋一个兄弟 `<span class="hc">`（`<a>` 内合法 phrasing 内容），hover/focus 显 | 全页唯一浮层节点挂 body；document 级 pointerover/pointerout + focusin/focusout 委托 `[data-hc-*]` |
| HTML 增量 | 60~240 张 × 每卡 200~400B ≈ **+12~96KB HTML**（违背 R-114 减量方向） | 每卡仅 data 属性 ~100-200B；浮层唯一 |
| 裁切与定位 | `.cover` 有 `overflow:hidden`（app.css L155）卡内裁死；锚到卡外层则网格边缘溢出/页面横向滚动风险 | fixed 定位 + 视口翻转，天然免疫裁切 |
| 追加页同权 | ✅ 纯 CSS 全自动 | ✅ 委托在 document 级，wall-scroll/crate 续箱追加节点自动生效（无需重新布防） |
| 富内容能力 | 弱（多行/分段样式勉强） | 强（结构化分段 + 阶段二 credits 行） |
| no-JS | ✅ 可用 | ❌ 降级到现有 cover-meta/spine-label（可接受的增强层定位） |
| 归层判词 | 适合做 A2（cover-meta 精修）级别的微调 | **R-117 主形态**：定位 + 内容渲染 + 全触点统一，T2 原生岛即可达成 |

### 3.2 归层裁决建议（对齐 S2-3 评审案框架）

- **T2（推荐执行层）**：新建第 11 岛屿 `hover-card`（原生 TS，预估 ~120-160 行 + smoke），
  注册进 main.ts ISLANDS 表；coverCard/spineCard 模板加 data 属性；panorama 覆盖在
  **panorama-view 岛屿内部**实现（S2-3 评审案 R5 豁免单明确「panorama-view/globe-view 维持
  原生不 React 化」——浮层是该岛自己的 DOM 兄弟节点，不违背豁免）。gnode 触点同委托。
- **T3（React 岛屿）＝ 兼容可选，不默认**：S2-3 评审案 T3 升级门槛 = 「仅当 T1/T2 达成才升级」，
  单例浮层 T2 可达成 → 按纪律不上 React。但若实施时 React 基座（P1）已合并，浮层
  （单例 + 定位 + 内容渲染）恰是评审案点名的 React 优势场景——**两种载体的 DOM/数据契约
  完全一致（data 属性 + 委托/事件），切换成本 ≈ 渲染函数重写**，可在派工单里按 S2-3 进度
  现场定载体。诚实披露：S2-3 §3 动效清单 A1-A18 无 hover 卡条目（最接近的是 A2 hover 精修），
  本卡实施时应在 S2-3 范围表增补一条（编号顺延 A19 级），勾选权在用户。
- **T1 残余价值**：cover-meta/spine-label/gnode 的 focus 态样式补齐（`:focus-visible`
  同权三处）是纯 CSS 小改，可随 A2/T1 批先行，不等本卡。

### 3.3 与 R-113（样式重做）/ R-114（密度减量）的合并节奏

- **R-113 先行或同批**：hover 卡字号/行距一律引用 token（`--text-small`/`--text-meta`/
  `--font-meta`），**禁 px 字面量**——R-113 重定标后自动继承，无双份返工；若 R-117 先于
  R-113 实施，卡片样式在 R-113 批次一并复审（R-118 展示质量门的三查覆盖它）。
  卡面配色只用既有 token（琥珀注记 = `--color-accent-text`、卡底 = `--color-card` +
  `--shadow-lg`——MASTER.md 弹层三件套），零新 token 则零 MASTER.md 增量；若要新 token
  （如卡内 role 缩写色）必须先进 MASTER.md 再进代码（token 唯一来源纪律）。
- **R-114 协同而非冲突**：R-114 砍的是「页面常驻密度」（chips top-N、瀑布流页数）；
  hover 卡是「按需密度」——被减掉的 Genre 信息不丢，扫视到哪张看哪张。
  每卡 data 属性 ~100-200B × 240 张自动追加 ≈ **+24-48KB HTML 上限量级**（evidence
  如实报；R-114 收敛配额后同步变小）。CSS 增量预估 +~2KB（触发单批 ΔCSS>2KB 软提醒线 →
  evidence 须披露构成，S2-3 评审案 §5.3 口径）。
- **check 基线顺延**：273/273 起步；新增 smoke（委托显隐 / 追加页生效 / 触屏不布防 /
  no-JS 降级形态断言）预估 +3~6 项。

### 3.4 改动文件面清单（阶段一实施预估，供派工单起草）

| 文件 | 改动 | 归属注意 |
|---|---|---|
| `src/server/html.ts` coverCard | +data-hc-* 属性输出（hono/html 转义自动覆盖 note 等用户数据） | 共享件——改动最小化， AssociATIONS/random/echo 自动继承 |
| `src/server/pages/crate.ts` spineCard | +data-hc-* | crate 域 |
| `src/server/pages/genremap.ts` gnode | +data-hc-*（count 已有；代表唱片可选） | genres 域 |
| `src/client/islands/hover-card.ts`（新） | 委托 + 定时器 + 定位 + 渲染（textContent/createElement 组装，**禁 innerHTML 拼用户数据**） | 新文件零冲突 |
| `src/client/main.ts` | ISLANDS 注册表 +1 行 | 共享件一行级 |
| `src/client/islands/panorama-view.ts` | 岛内浮层（hitTest 复用）+ payload 微扩 | panorama 域（豁免区，原生实现） |
| `src/server/db/panorama.ts` | payload +year/genre 两字段（可选） | panorama 域 |
| `src/client/styles/app.css` | 浮层样式块 ~60-80 行（全 token 引用） | — |
| tests/ | hover-card smoke + 委托/降级断言 | — |

阶段二（credits，须另立评审后才动）：`db/migrations/0006_album_credits.sql` + `db/types.ts`
（AlbumRow.credits + parseCredits）+ `metadata/musicbrainz.ts` 或新增 discogs lookup +
`scripts/mb-calibrate.ts` 扩展 + 详情页 meta-table 一行 + hover 卡扩展位。

---

## ④ 红线核对（逐条，实施评审案可直接引用）

| # | 红线 | 核对结果与处置 |
|---|---|---|
| 1 | **乙-1 DD3 URL 即状态** | ✅ hover 卡 = **瞬态指针反馈，不入 URL、不进 history**（无 pushState/replaceState）——与「相机过渡态不入链」先例同口径（panorama-view zoom 不入 URL、globe-view.ts L19 注记）；对比：crate `?at=` 是浏览位置（replaceState 入 URL）而非 hover 态，两者边界不变。筛选/详情跳转仍全部走 `<a href>` |
| 2 | **乙-6 禁 raw 插用户数据** | ✅ 服务端：coverCard/spineCard 由 hono/html 模板输出，data 属性插值默认转义（note 是典型用户数据，走同管道）；**raw() 仅限既有静态 SVG/DOCTYPE 用途，本卡零新增 raw**。客户端：hover-card 岛屿渲染用 textContent/createElement 组装（禁 innerHTML 拼 data 属性内容）；React 载体（若选）= JSX 自动转义等效纪律 + dangerouslySetInnerHTML 禁用（S2-3 评审案 §5.5.3 同款） |
| 3 | **触屏降级纪律** | ✅ §2.4 四条成文：`(hover: hover)` 双闸布防、不劫持首 tap、详情页 = 触屏信息面、长按 = 可选后置不默认 |
| 4 | **乙-5 资产自托管零 CDN** | ✅ 纯 CSS/原生 TS 岛屿，零新依赖零外链；阶段二亦零新包（node:sqlite/fetch 全既有，B10 同判） |
| 5 | **隐私红线 / 感官层** | ✅ hover 卡零外部调用零预取（数据全在 SSR 页面或已有 payload 内，纯本地渲染）；显隐动画走 Motion token + reduced-motion 自动收敛；感官层门控取舍见开放问题 #9 |
| 6 | **乙-8 迁移框架** | ✅ 阶段一**零迁移**；阶段二迁移 = 0006+ 顺延、DDL 包事务、纯加列无 CHECK 重建、备份 VACUUM INTO 口径不变 |
| 7 | **乙-10 内存纪律** | ✅ 服务端零查询形态变化（阶段一）；阶段二为 CLI 离线管线（B10 同纪律：停服运行建议 + WAL 并存可控）；hover 卡 payload 为既有查询列的透传，无新内存面 |
| 8 | **MASTER.md / R-118 展示质量门** | ✅ 全 token 引用禁裸 hex/px 字面量；布局位移式 hover 禁令（MASTER Anti-Patterns）——浮层 fixed 定位天然零布局位移；字号随 R-113 重定标继承 |
| 9 | **三不动 / 文件归属** | ✅ dao.ts 契约零新增方法（LIST_COLS 在 queries.ts，加列属查询面非契约面）；index.ts/app.ts 挂载不动；routes 各域文件只动本卡触点两处模板函数 |

---

## ⑤ 开放问题清单（随 PM 排期 / 实施评审案逐项裁决）

1. **阶段一卡面字段集终稿**：note 截断长度（建议 ~60 字）、是否上 Tags/国家第二行
   （各自查询面代价不同，§2.1 表）；note 上卡是否有「公共场合扫视隐私」顾虑（个人本机应用，
   建议默认上卡，用户可否决）。
2. ** genres 星图 gnode 是否要「代表唱片」**：加分项但须新增按流派聚合查询 + payload 设计；
   建议独立小卡不绑主卡排期。
3. **panorama payload 扩展边界**：year/genre（+~15B/节点，建议上）vs note/tags（SQL + payload
   双改，建议缓议）；5000 行 JSON 增量随卡 evidence 报数。
4. **载体终裁**：T2 原生岛（默认建议）vs React 岛（若 S2-3 P1 已合并）——派工单起草时按
   S2-3 实际进度定，两载体契约已对齐（§3.2）。
5. **触屏长按**：阶段一不做（tap-through 已覆盖）；是否立项为后置增强（含误触率与
   contextmenu 冲突评估），权在用户。
6. **/atlas 国家级信息卡**：明确移出 R-117 范围（§2.1 表）还是立项单评——建议移出，
   与 R-116 漫游方案统筹（那里本来就要「随机专辑 + 介绍」）。
7. **阶段二 credits 立项**：另立评审案（迁移 0006 + 管线 + 数据源矩阵终选 MB 主/Discogs 辅），
   dry-run 命中率实测后再谈覆盖率承诺；与 mb-calibrate 503 墙剩余 ~67 行的重跑窗口合并
   规划（同一停服窗口跑两件事，节流预算合并）。
8. **与 R-113 的先后**：建议 R-113 token 重定标先行或同批（§3.3）；若 R-117 先行，
   R-113 批次须复审 hover 卡字号。
9. **感官层门控取舍**：hover 卡显隐建议**不键入** `body[data-sensory="on"]`（功能性信息反馈，
   与 cover-meta 既有先例一致，非装饰动效；reduced-motion 已兜底）——但 S2-17 条文写的是
   「动效/缓动统一开关」，实施评审案须显式定一句，避免口径漂移。
10. **hover 卡与 keyboard-flow `/` 快捷键的按键面**：若未来给卡加「按 Enter 进详情」类增强，
    须与现有 `/`（聚焦搜索）、crate R（随机）按键表统一登记，防止按键面无序膨胀（现阶段
    浮层 pointer-events:none 非交互，无此问题）。

---

*记录：ZCode · R-117 分析会话 · 2026-11-18 · 依据 = 需求草案 R-117 原文 + 主线 d8653d0
全只读实读（html.ts / album.ts / types.ts / queries.ts LIST_COLS/DETAIL_COLS / migrations
0001·0003·0005 / wall-scroll / crate-flip / panorama-view / genre-scan / globe-view / app.css
L140-175·L358·L371 / tokens.css / sources.ts DiscogsSource / config.ts discogsToken / panorama.ts
SQL_ATLAS_ROWS / genremap.ts gnode）+ 文档包三评审案与 IM-25/26/31/32/33 实读。
本文 = 纯分析件，零代码零看板变更；阶段一可做性基于现有字段逐列核对，阶段二 credits 数据缺口
如实标注「须另立评审 + 迁移 0006」，覆盖率不承诺（待 dry-run 实测）。
**本会话写过且仅写过这一个文件：Musicgraphy-2.0-文档包\05-系统架构设计\分析-展示升级-R117-Hover信息卡.md**。*
