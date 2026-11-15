# 评审案 · 设计参考四站 0→1 实现（R-106~R-109 · S2-12~S2-27）

> 状态：**已按用户 2026-11-15 指令执行**（「现在都将他们并行开始实现吧 调度和执行的规则都交给你」
> = 实现执行授权；本评审案 = 技术决策留档，IM-30「实施前评审案照出」纪律的落地形态——决策全记录
> 于下，不再阻塞等待逐项追认；与既有评审案同款，越权项单列披露）。
> 需求事实源 = 文档包 01-产品理念终稿/需求草案-2026-11-15-设计参考第二批.md（第一部分方向 +
> 第二部分拆解与 0→1 表）；看板卡 = S2-12~S2-27（⑦专项主线专区）。
> 拆解证据 = 同文档第二部分（cratedigger 源码级 / everynoise 源页级 / albumatlas·chiaraluzzana
> 浏览器实测级，2026-11-15）。
> 本卡范围 = 非音频依赖段全部（S2-12/13/14、S2-16/17、S2-20/21/22/23、S2-24/25/26 共 11 卡）；
> 音频依赖段（S2-15/18/19/27）按卡面约定**默认后置**（音频源合规评审未过，见 Q10）。

## Q1 · 路由与页面命名（四站入口）

- **GET /genres** = R-109 流派星图（纯 SSR，零岛屿——everynoise 同款机制，S2-11 拆解结论）。
- **GET /crate** = R-108 翻箱视图（SSR 侧脊陈列 + crate-flip 岛屿键盘增强）。
- **GET /panorama** = R-106 收藏全景（SSR 壳 + panorama-view Canvas 岛屿；noscript 诚实降级）。
  **Q1′ 命名披露**：原案 /atlas 与并行会话 DR globe 页撞车（routes/atlas.ts + pages/atlas.ts
  为其 2026-11-15 晚在制品，GET /atlas = Radiooooo 世界地图骨架）——R-106 图集改称
  **panorama（收藏全景）**，域文件 db/panorama.ts / 岛屿 panorama-view.ts / 端点
  /fragment/panorama-data，与其 globe-view 文件边界零交集；概念仍是 R-106 专辑空间漫游。
- **GET /random** = S2-20「随机一张」页面动作：302 → /album/:id（重定向 = URL 即状态友好，
  无 JS 纯链接可用；档案空 → 303 回 `/`）；放置于 pages 子应用（非 /api/v1——页面导航语义，
  非数据 API）。
- **GET /fragment/panorama-data** + **GET /fragment/crate** = 岛屿数据/续箱供给（/fragment/*
  同族页面守卫 302 语义，岛屿同源 fetch 带 cookie；panorama-data = JSON envelope `{data:…}`）。
- **POST /settings/sensory** = S2-17 感官层开关（Q8）。
- 全部入口收进全站页脚（siteFooter 一行三链接）——页脚 = 既有功能入口惯例（导出/观察池先例）。

## Q2 · R-109 星图相似度与布局（S2-24）

- **共现口径**：节点 = Genre（album_metadata.genres，json_each 展开）+ Tag（record_tag×tags）；
  边 = 同一条收藏记录上的共现（genre×genre / tag×tag / genre×tag 三类，同记录两两组合）。
  本地 SQLite 自算，零外部调用（隐私 + 存活性——everynoise 因 Spotify API 关停进维护态的教训
  即本决策依据，S2-11 拆解④）。
- **相似度度量** = overlap 系数 `w(a,b) / min(n(a), n(b))`（共现数除以较小节点覆盖数）——
  个人库规模（数十节点）下比 cosine 更能表达「几乎总是一起出现」。
- **布局** = 确定性力导向（纯 TS 零依赖）：mulberry32 固定种子 → 圆环初始化 → 220 轮迭代
  （边引力 ∝ overlap × 2 / 库仑斥力 ∝ k²/d / 向心 0.03 / 标签半径近似 = 字号 × 0.35）→
  归一化 0..100。**同库同布局**（确定性 = 可测试可复算，color-extract CLI 先例）。
- **产物双通道**：纯函数模块 `db/genremap.ts`（SSR 页面请求时即时计算 + 进程内 memo——
  个人库节点数 ≪100，实测毫秒级，不落文件也能跑）+ CLI `scripts/genre-map-layout.ts`
  （`--db --out` 写 data/genre-map.json + 打印统计，color-extract 先例；产物供离线检视/备份）。
  与 S2-24 卡面「脚本产物」的偏差 = 页面直算不依赖脚本先跑（零摩擦），脚本仍在档——
  如实披露，评审留档。

## Q3 · R-109 SSR 星图渲染（S2-25）

- **纯 DOM 绝对定位标签**（everynoise 机制同款，S2-11 拆解①）：容器 `position:relative` +
  每节点 `<a>` 内联 `left:x%; top:y%; font-size:…px`；字号 ∝ √覆盖数（11–26px 夹取）；
  Genre/Tag 双形态区分（Genre 墨色、Tag 琥珀——MASTER token 语义）。
- 零 canvas 零 WebGL 零岛屿——SSR HTML 即完整产品；无 JS 可用性 100%。
- 可访问性：每节点 = `<a role="listitem">` 语义清单 + `title="N 张 · e.g. 与 X 共现"`
  （everynoise 的 title 示例姿态致敬）；键盘 Tab 即可达（原生链接）。

## Q4 · R-109 直达接线（S2-26）

- Genre 节点 → `/?genre=<name>`、Tag 节点 → `/?tag=<name>`（与筛选舱 chips **完全同语义**，
  DD3 URL 即状态零新机制——chips=<a> 既有先例直接复用）。
- 当前态高亮：`/?genre=X&…` 打开星图时（未来从结果页返回）命中节点加 `.current`；
  v1 = 节点 hover/active 原生样式 + title 计数，不做复杂状态回显（诚实最小）。
- 空态：档案无 Genre/Tag → emptyWall 引语式空态 + 去添加入口（诚实占位，0/0 无定义先例）。

## Q5 · R-108 翻箱实现形态（S2-20/21/22/23）

- **数据通道**：复用既有 `dao.listPage`（cursor + LIMIT 60 纪律零改动）——SSR 首页 60 张，
  翻完为止的 v1（5000 张 = 84 页，键盘流按页边界 fetch /fragment/crate-next 透传 cursor，
  与 wall-scroll 同族；v1 先落地 SSR 首屏 + 页内翻动，跨页 fetch 列为后置增强如实披露）。
- **渲染 = CSS 3D**（S2-10 拆解核心结论：实物感来自「薄盒+状态机+缓动」而非 3D 精度）：
  侧脊 = 窄条封面（object-fit:cover 窄裁切）+ 未聚焦微倾（rotateY ±8°，cratedigger ±π/7 的
  CSS 等效）+ 聚焦居中放大；perspective 容器一箱 60 张。
- **状态机 CSS 化**：cratedigger 四态（pushed/pulled/shown/flipped）→ v1 两态映射
  （rest=半压微倾 / focused=正立居中）；「抽出看正面」= 跳详情页（不建第二套数据，
  Topster=View 同款纪律——原站 flipped 内嵌面板的语义由 /album/:id 承担）。
- **交互**：←/→ 翻动 + Enter 开详情 + Home/End 首尾（crate-flip 岛屿，keyboard-flow
  「谁拥有 DOM 谁处理按键」协作边界——本岛屿只碰 .crate-strip 内部）；无 JS = 原生横向
  scroll + `<a>` 链接全可用（岛屿纯增强）。
- **URL 即状态**：翻动位置 `?at=<record_id>`（history.replaceState——连续浏览位置 = 瞬态，
  replace 不刷历史；后退回到来源页语义保持）；SSR 首屏若 ?at 在首 60 张内则定位之。
- **随机一张**：`GET /random` → 302 `/album/:id`（`SELECT id … ORDER BY RANDOM() LIMIT 1`，
  规模内毫秒级；仅本地查询不涉上游限流）；入口 = 翻箱页 + 页脚（档案空不渲染入口，
  /random 兜底 303 `/`）。
- **R-104 联动评估**（S2-23 交付面）：翻箱 = 天然分页浏览（60 张/箱页边界明确），可作
  R-104「无止境瀑布流」的候选替代形态 a（「加载更多」）/ c（硬上限提示）之外的 d 选项
  ——**建议**：R-104 评审时把「Collection 头部加 翻箱/图集 视图切换」并入考量，本批
  不改 wall-scroll 一行（文件边界尊重）。

## Q6 · R-106 图集载体与数据（S2-12/13）

- **载体 = Canvas 2D**（Q 决策：WebGL/three 引入 ~600KB 级依赖与构建面，v1 收益不成立；
  albumatlas 的 InstancedMesh 解决的是「数千封面同屏」——Canvas LOD 同样达成：
  缩小层级画主色圆点，放大层级画封面缩略图，可见区按需加载）。
  与 DR-M1（Radiooooo 地球，并行会话 track）的引擎评审**解耦**：地理球与专辑图集是两个
  不同问题域（MapLibre globe ≠ 收藏画布），并行会话 2531a5a 的合并评审建议降级为
  「共享结论互通」——各自独立选型、评审案互引（本节即 R-106 侧记录）。
- **布局 = 服务端预计算**（S2-12）：`db/atlas.ts` 纯函数—— decade（release_year 十进制桶，
  未知 = 「未知」桶）为行 × 首流派（json_extract(genres,'$[0]')）为列簇，簇内按 id 确定性
  抖动铺排（mulberry32(id hash)）→ 0..1000 坐标；全量一次算好随端点下发（无在线力导向）。
- **数据端点**：`GET /fragment/atlas-data` → `{data:{w,h,nodes:[{i,x,y,c,u,t,a}],stats}}`，
  c=cover_color（1–16，fallback 渲染色）、u=cover_local 文件名（无则 null 画色块）、
  t/a = 截断标题/艺术家（24/18 字符，tooltip 用）。
- **内存纪律①豁免披露**（export 先例第二则）：全表读 5000 行 ≈ 500KB JSON（gzip ~130KB），
  RSS 实测随卡 evidence 如实报告（观察指标口径，IM-30 甲-7）；分页渐进加载登记观察池
  （信号 = 真实库破万再议）。
- **封面加载**：可见区 ∩ 缩放阈值 ≥2.2 才取图（/covers 流式既有），并发 ≤12、LRU 300 张
  上限；未加载/无封面 = 主色方块（cover_color 已在数据里，零额外请求）。

## Q7 · R-106 图集交互与 URL（S2-13/14）

- 平移 = pointer drag；缩放 = wheel（以指针为中心）+ 双指 pinch（pointer events 两指距离）；
  点击（位移 <4px 判定）= 命中测试最近节点（半径 ∝ 节点渲染尺寸）→ `location = /album/:id`。
- 键盘 = 方向键平移、+/- 缩放（atlas-view 岛屿内处理，不与 keyboard-flow 冲突——后者只管 `/`）。
- **URL 即状态**：视图中心与缩放 `?x&y&z`（replaceState 节流 300ms）；SSR noscript 降级 =
  诚实说明 + 去网格链接（Canvas 无 JS 不可用是物理事实，不伪造）。
- 渲染循环 = 按需 rAF（交互中/图片加载完成时标记 dirty，空闲零耗电——Radiooooo 拆解
  §2.2 同款纪律）。

## Q8 · S2-17 感官层开关（R-107）

- **语义**：`mg_sensory` cookie——缺省（无 cookie）= **低动静音**（默认，隐私+不打扰红线）；
  `on` = 允许缓动/过渡（翻箱对焦滑动、图集视图 lerp）。未来音频/动效层一律挂此开关。
- **实现** = metrics/toggle 先例同款：cookie 无表、POST + 303、sameOrigin CSRF；
  `POST /settings/sensory` body `action=on|off&to=<path>`（to 必须 `/` 开头，防开放重定向）。
- **即时生效面**：body `data-sensory` 属性由岛屿初始时写（SSR 默认无属性 = 低动）；
  CSS 过渡全部键在 `body[data-sensory="on"]` 下——开关关 = 过渡即禁，零残留。
- 开关 UI = 三个新页面各自的页首行（非全局页脚——保持页脚纯出口语义）。

## Q9 · S2-16 文案叙事层（R-107）

- 本批落地面（第一人称档案馆口吻，与既有 echoCard/emptyWall 口吻对齐）：
  ① siteFooter 新增三视图入口行（「再逛逛你的箱子：翻箱 / 流派星图 / 专辑图集」）；
  ② /crate 页首句「这是你自己的箱子——翻到的都是你留下来的」；空箱态「箱子还是空的——
  先记录第一张」；③ /genres 空态「你的流派宇宙还没有坐标——先给专辑挂上第一个 Tag」；
  ④ /atlas noscript 与空态文案；⑤ /random 空档案兜底文案。
- 既有页面（/、/add、/metrics）文案本已是第一人称馆员口吻（echoCard「你留下了」/
  emptyWall 引语式），本批不改一行——清单化核对口径见 evidence（改动面 = 新页面 + 页脚
  一行，回归风险最低）。

## Q10 · 音频依赖段处置（S2-15/18/19/27）与红线核对

- **音频源合规评审未过**（外部 30s 预览 URL 的版权/稳定性/零 CDN 约束未裁决）——四段
  按卡面约定默认后置，看板保持 pending（history 注记「音频源评审后立项」）；本批
  S2-17 感官层开关已就位，音频层落地时零新增开关面。
- **红线核对（维持 9 条，IM-30）**：DD3 URL 即状态 ✓（?at/?x,y,z/?genre/?tag 全 query 化）；
  禁 raw 插用户数据 ✓（hono/html 自动转义 + JSON 端点无 HTML 面；星图/图集节点名/标题
  全部经转义通道）；隐私红线 ✓（零外发零新上游调用——/random 与共现全本地 SQL）；
  资产自托管零 CDN ✓（Canvas/CSS 纯手写零新依赖，封面走 /covers 自托管流式）；
  内存四纪律 ✓（LIMIT≤60 列表面不变；atlas 全表读 = 豁免披露第二则随 evidence 实测；
  封面流式；无 base64；StmtCache 复用）。
- **观察指标如实报告**：运行时依赖 = 3（并行会话 maplibre WIP 在树，G1 观察口径）；
  main.css/CSS 增量、岛屿 chunk 体积、atlas 端点字节数随 evidence 报告。
- **并行会话边界**：globe-view/**、package.json、package-lock.json、covers.ts、
  infra.smoke.test.ts = DR 会话文件边界，零触碰；本批提交 pathspec 限定自有文件
  （B4 先例）。

## Q11 · 测试与验收

- `tests/genremap.smoke.test.ts`：共现计数正确性（种子库手工核算）/ 布局确定性（两次调用
  同坐标）/ 节点覆盖（genre+tag 都在）/ /genres 200 含节点链接与空态 / 401·302 守卫 /
  CLI 产物在档。
- `tests/crate-atlas.smoke.test.ts`：/crate 200 含侧脊与随机入口（空档案不渲染入口）/
  /random 302 Location=/album/:id + 空档案 303 / /atlas 200 含 canvas 根与 noscript 降级 /
  /fragment/atlas-data 200 形状+计数=种子数+匿名 302 / POST /settings/sensory on→Set-Cookie、
  off→清除、无 Origin 403、303 回 to 路径。
- 门禁 = `npm run check` 全绿（基线 200/200 顺延）；置 done 前置（G4）。
