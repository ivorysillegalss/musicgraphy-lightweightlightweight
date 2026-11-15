# 评审案 · 发布后迭代第三批实现（R-101 / R-102 / R-104 / R-105）

> 状态：**已按用户 2026-11-15 实现令（第三批派工单）执行**（本单即执行授权；本评审案 = 技术决策留档，
> 与 docs/design-refs-review.md（Q1–Q14）/docs/telemetry-review.md/docs/palette-review.md 同款纪律——
> 决策全记录于下，越权项单列披露）。
> 需求事实源 = 文档包 01-产品理念终稿/需求草案-2026-11-15-发布后迭代第一批.md（R-101/R-102/R-104/R-105 原文与开放问题）。
> 看板卡 = S2-1（R-101，FRONTEND 线既有 pending 卡）+ S2-29/S2-30/S2-31（R-102/R-104/R-105，本批评审案建卡，
> B10/协议 §7⑦ 建卡范式）。R-103 React 接入不在本批（架构级，另批评审）。

## Q1 · R-101 页面形态：`/topsters/about` 独立说明页 + `/topsters` 空态/列表双入口 + 全站页脚入口行（草案①+②合并落地）

- **形态选独立说明页**（草案方向①），理由：入口普查披露的是「无入口 + 无说明」双缺口——空态增强只在
  「还没有策展」时可见，已有策展的用户永远看不到说明；独立页对四种状态（0 策展/N 策展/海报/SVG）都可达。
  草案方向②的「空态引导增强」以**列表页既有文案已在档**（renderTopsterList 空态句
  「还没有策展。新建一个……」+ 首段说明）覆盖，不再重复改写（诚实最小改动面）。
- **路由 = GET /topsters/about**，注册顺序在 `app.get('/topsters/:id')` **之前**（Hono 同段路由按注册序
  匹配，避免 "about" 被动态段捕获渲染 404；topster id 为 UUID，"about" 永不冲突，但顺序保证是护栏）。
- **入口行 = 全站页脚新一行**（siteFooter，W8 导出入口/R-107 三视图行同款惯例）：
  「把品味排成一张图：Topster 是什么（/topsters/about） · 我的策展（/topsters）」——一行两链接，
  同时闭环「四页 0 处入口」缺口与说明页可达性。
- **内容口径**（04B 引擎一原文锚定）：①Topster 是什么 = Collection 的一种 View（成员实时取自
  Collection、禁第二套数据、≤60 张、顺序即叙事——topster-review 案 2 底线复述）；②怎么建 = 三步
  （新建 → 搜索档案加入成员 → ↑↓ 排序 + 副标题）；③分享价值 = 「分享的是作品图，不是产品」
  （04B 引擎一：图片角落一行 "made with Musicgraphy"，用户表达在前产品只是署名）+ 两条导出链路
  各自的诚实边界（SVG = 矢量即得但主流平台不收上传；海报页 = 截图/打印即成图补位——W11 评审案 §3 口径）。
- **不串联导出动作**（开放问题③）：导出入口已在策展详情页有成员时在档（「导出 SVG · 海报页」行），
  空策展时串联引导会指向必然失败的动作（0 成员导出 = 空图）——说明页讲清楚「先加成员再导出」即达意。

## Q2 · R-102 呈现位 = 页脚登录态行；POST /logout = auth.ts 最小增量；「会话剩余期」不呈现

- **呈现位 = 页脚**（草案给页头/页脚两选）：页头是搜索+添加的双意图功能区（siteHeader 既有职责），
  页脚是全站「出口/状态」惯例位（导出/仪表/三视图/赞助都在页脚）——登录态归属后者，零新增布局概念。
- **内容 = 「已解锁 · Musicgraphy」+ 退出动作**（草案原文措辞），不引入多用户概念（R-102 开放问题维持，
  数据模型零改动——user_id 字段预留但不呈现）。
- **诚实性论证**：V10 `use('/*')` 页面守卫（B8/D1 修复）保证所有经 layout() 渲染的页面必然已登录——
  页脚登录态区可无条件渲染「已解锁」，不存在「匿名看到已解锁」的假态（登录页 auth.ts 自绘 HTML 不走 layout）。
- **POST /logout = auth.ts 域最小增量**（派工单钦定）：`sameOrigin` CSRF 校验（与 /login 同款）+
  `deleteCookie(mg_session)` + 303 → /login。无状态会话（HMAC cookie，无会话表）没有服务端可删的东西，
  清 cookie 即完整退出语义。匿名 POST /logout 被页面守卫先拦（302 /login，守卫先于路由——B8 修复后拓扑）。
- **偏差披露（开放问题②「会话剩余期」）**：不呈现。会话过期时间在 cookie 的 HMAC token 内，layout()
  无 Context 可读——呈现它需跨全部页面传参（十余渲染器签名变更），收益不成比例；需求草案措辞为
  「如…+ 会话剩余期 + 退出动作」（示例性），核心诉求 = 登录态可感知 + 可退出，两核心已闭环。
  留待后续如用户点名要剩余期展示再评审。

## Q3 · R-104 形态裁决：a+b 组合（自动追加 3 页后转手动「加载更多」+ 到底提示/回到顶部）；cursor 服务端顺链零改动

- **候选取舍**：a（自动 N 页后转手动）+ b（到底提示 + 返回顶部）组合，按派工单建议执行；c（硬上限计数）
  不取——「硬上限」与 a 的手动模式语义冲突（手动模式本就没有上限），「共 N 张」计数已有（resultStatus
  状态行「N 张匹配」，countTotal 实算在档）。
- **N 值 = 3 页（自动追加 180 张 + SSR 首屏 60 = 240 张可见）**：IM-20 压测基线（5000 张可交互 34.4ms）
  的回归关系 = 本改动纯客户端行为限制，SQL/分页链路零改动——LIMIT 60/cursor/axis 排除语义原样，
  perf-like 与 wall-scroll 基线自动保持。3 页 = 首屏外仍有两屏顺滑预取（浏览节奏不破坏），之后转手动
  （用户 2026-11-15 原文「我需要限制」的最小满足——无止境自动滚停止，但内容并未封死）。
- **实现分工**：
  - 服务端（resultsSection）：has_next=false 时 SSR 渲染 `.wall-end` 到底条（无 JS 同权）；结果区顶部
    加 `<div id="mg-top">` 锚点（回到顶部 = 纯原生 `<a href="#mg-top">`，零 JS 可用）。
  - 岛屿（wall-scroll）：进程内 `autoLeft=3` 计数——每次自动追加成功递减，归零即转手动模式（IO 停止
    观察 + 链接文案改「加载更多（手动）」，点击/原生链接继续逐页取）；取到的片段含服务端 `.wall-end`
    时原样上墙（服务器权威标记），缺失时兜底注入同款常量（防御性，正常路径不触）。
  - **配额重置** = MutationObserver 识别「舱岛换墙」（addedNodes 含 .cover-wall/.result-status = 新筛选
    的新墙）→ autoLeft/manual 重置——自动配额是「每次筛选会话」的语义，不是页面生命周期语义。
    本岛自追加只动 .cover-wall 内部（卡片节点无该类名）不误触。
- **URL 即状态核对**：浏览位置仍是瞬态（不入 URL，与翻箱 ?at 的 replaceState 界定同族——R-104 语义
  是「限制自动行为」而非「恢复浏览位置」）；筛选状态全在 query string 不变。
- **偏差披露**：/fragment/wall 服务端逻辑零改动（cursor 只用服务端下发值纪律原样）；「加载下一页」
  服务端文案不变，改文案只发生在岛屿增强层（无 JS 用户看到的服务端原文「加载下一页」仍准确）。

## Q4 · R-105 形态裁决：原生 `<details>` 轴收纳（Genre 缺省展开 / 年份·听期缺省收起）；chips=`<a>` 与轴排除语义一行不改

- **候选取舍**：草案给「分组下拉或侧栏 / 年份区间选择（双下拉/滑块）」。派工单收窄为「分组或收纳」。
  取**收纳**（原生 `<details>/<summary>`），理由：
  1. **URL 即状态红线零风险**——年份区间选择需要 year_from/year_to 新参数 = 新服务端筛选语义 +
     buildHref/parseFilter/saved-views query_json 三处联动 + 既有 `?year=` 单值语义兼容问题；
     收纳不碰任何状态参数（chips 仍是 `<a href="?…">`，buildHref 原样）。
  2. **岛屿兼容零改动**——filter-cabin 岛屿按 `.chip/.chip-x/.btn-text` 类名委托拦截，`<details>` 是
     原生折叠（非 JS），summary 点击不经岛屿；计数轴排除语义（countAxes）完全不动。
  3. **无 JS 基线最优**——details 是 HTML 原生交互（唯一「零 JS 可折叠」原语），岛屿失败/禁 JS 全功能。
- **缺省开合**（Find 主路径优先，W4-6-2 三筛场景不增步）：**Genre 缺省展开**（22 项是主浏览轴，收起
  会给最高频路径加一跳），**发行年份（75 项）/我听的时期缺省收起**（两轴同族长列表 = 视觉噪音主源；
  `open` 属性 = 轴有激活筛选时服务端置 open——筛选态下所选 chip 必然可见）。用户手动开合是增强态
  瞬态（swap 后回归服务端缺省——与既有舱 swap 全量重渲染同语义，如实披露）。
- **summary 形态** = 轴名 + `.axis-meta`（「N 项」+ 已选标记）；年份/听期展开后 chip-list 限高 180px
  滚动（75 chips 不再撑长页面）。Tag/颜色/Favorite 轴不收纳（本批评审范围 = genre/年份两轴，Tag 轴
  同款收纳模式留待用户反馈信号，观察池姿态）。
- **改动面** = pages/collection.ts cabinSection（foldedAxis 变体）+ app.css（summary/axis-meta/限高，
  ~10 行）——派工单改动面清单吻合（cabinSection + filter-cabin.ts + app.css；filter-cabin.ts 实测
  零改动需要，如实披露为「未触碰」）。

## Q5 · 测试与验收

- `tests/topster.smoke.test.ts` +2：/topsters/about 200 + 内容三段断言（是什么/怎么建/分享口径
  「分享的是作品图」）+ 与 :id 路由不串扰 + 全站页脚入口行在档（任意页面 footer 断言）。
- `tests/auth.smoke.test.ts` +3：POST /logout 303 → /login + Set-Cookie 清除（Max-Age=0/过期）+
  退出后页面回归 302；跨站 Origin 403；页脚「已解锁」+ logout form 在档。
- `tests/wall-scroll.smoke.test.ts` 增量：A 部分 = has_next=false SSR `.wall-end` + `#mg-top` 锚点
  （有 next 时不出现在 SSR）；R-105 = cabinSection 单元断言（Genre open/年份 closed/summary 计数/
  chips href 原样）+ /fragment/cabin 200 含 details 形态；B 部分 = 岛屿 3 页自动后转手动（IO 不再创建/
  链接文案改）+ 点击手动续页 + 片段 wall-end 上墙 + 兜底注入路径。
- 门禁 = `npm run check` 全绿（基线 263/263 顺延）；IAB/curl 实测四件各页 200 与行为断言。

## Q6 · 红线核对（IM-30 维持 9 条）

- **乙-1 DD3 URL 即状态** ✓：R-105 零新参数（chips=`<a href="?…">` 原样）；R-104 筛选状态全 query、
  浏览位置瞬态不入链（与翻箱 ?at 同族界定）；R-101/R-102 纯页面/动作路由。
- **乙-5 隐私红线 + 零 CDN** ✓：零新依赖零外链零外发；/logout 只清自有 cookie。
- **乙-6 禁 raw 插用户数据** ✓：新渲染件全部经 hono/html 转义通道（about 页内容为静态文案 + 布局件）。
- **乙-3 check 全绿** ✓（收口数字随卡 evidence）；**乙-4 上游限流** ✓（零上游调用）；
  **乙-7 Topster=View** ✓（about 页零数据面）；**乙-8 迁移/备份** ✓（零迁移零触碰）；
  **乙-10 内存四纪律** ✓（列表 LIMIT 60 不变；无 base64；StmtCache 零触碰）。
- **观察指标如实报告**：运行时依赖 = 3 不变（本批零新增）；main.css 增量 ~0.4KB（IM-14 线已废止，
  随 evidence 报告实测值）；岛屿 chunk wall-scroll 增量随 evidence。

## Q7 · 文件边界核对（派工单 §4）

可碰面全在清单内：routes/pages.ts（/topsters/about 一段）、pages/topster.ts、pages/collection.ts
（cabinSection/resultsSection）、islands/wall-scroll.ts、html.ts（siteFooter）、auth.ts（仅 /logout）、
tests/ 三文件、docs/ 评审案。**未触碰**（如实披露）：islands/filter-cabin.ts（R-105 评审后实测不需要）、
main.ts（无新岛屿）、app.css 之外的客户端文件、metadata/**、db/**、routes/atlas.ts、globe-view/**。
越权项 = 无（05-实现决策记录.md 未触碰，本批决策以本评审案留档；如需 IM 登记由后续全量同步会话办理）。

## Q8 · 看板与登记

- S2-1（R-101）置 done（evidence = commit hash + check 数字 + 页面实测）。
- S2-29（R-102）/ S2-30（R-104）/ S2-31（R-105）= 本批评审案建卡并置 done（B10/协议 §7⑦ 建卡范式，
  派工单钦定「R-102/R-104/R-105 未建卡，按 f3923c4 的 B10 建卡范式建卡」）。
- daily-reports.js 2026-11-15 补记节；文档包 node --test → git 提交 → 线上重部署；主线提交引用
  需求编号（R-101/R-102/R-104/R-105 · S2-1/S2-29/S2-30/S2-31）。
