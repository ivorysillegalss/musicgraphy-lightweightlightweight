# 颜色轴场景实测记录（W4-6-1 · CRAWL 线 #5 收尾）

> 派工来源：08-进度看板 W4-6-1 卡（数据爬取线第 5 张，实机操作卡）。
> 验收口径：PM §2.1 W6 门禁（「蓝色封面的那张电子」≤3 筛 + 一屏收敛 20–40 张）· PRD §9
> （≤3 次筛选 + 10s 扫视 → 一屏 20–40 张，全程封面可见）· IM-18（D3 管线口径）·
> W4-6-2 先例（find-scenario.md：真库计数不入带时以组合轴替代，禁硬凑）。
> 本卡零 src/ 改动：只跑既有脚本 + 真实上游搜索落库 + 场景实测 + 产出本文档。

## 1. 环境准备

| 项 | 值 |
|---|---|
| 被测仓 | `musicgraphy/` 主线（服务启动时 HEAD `4673b56`，工作树 = 既有在制品四件；实测期间并行 W7-9-1 会话推进 HEAD 至 `841fcb5`——本卡被测面 D3 管线/chips/fragment 在两版本间无变更，服务进程自启动代码贯穿全程） |
| 服务 | `tsx src/server/server.ts`，PORT=3100（dev 内置 ACCESS_KEY=dev-local，[config] 行确认） |
| 数据基线 | `data/musicgraphy.db`：5,032 记录（W4-6-2 种子库实况续用）/ cover_local=0 / cover_color 4,293 占位值 + 708 NULL；`data/covers/` 空（种子无真实封面） |
| 上游 | MusicBrainz 主源（CAA 封面）+ Deezer（**实测不可达** upstream_unreachable）+ iTunes（600px artwork）+ Discogs（无令牌停用） |
| 限流纪律 | 全局串行 ≥1s + 30/min：搜索步进 3.2–3.5s（≈17–19 req/min），全程 0 次 429；iTunes 20/min 单门未触顶 |
| 浏览器 | ZCode IAB 1440×900；登录态 = 会话 cookie 注入（与 signToken 同式 HMAC，等价登录产物），全程只读目检——按踩坑备忘以 URL 直达替代一切点击 |

## 2. 攒封面与回填（任务 1–3）

### 2.1 三轮真实搜索 + 落库（62 次搜索 → 41 张 201+Location）

| 轮 | 通道 | 结果 | 说明 |
|---|---|---|---|
| 1 | 默认降级链（MB 主源） | 12/32 | MB 搜索返回候选但多数 release 无 `cover-art-archive.front` 标记 → cover_url=null 不落库（选片策略：候选须带封面，宁缺毋滥） |
| 2 | `?source=itunes` 补搜 | 19/20 | Deezer 单源直连失败（upstream_unreachable，如实记录）；iTunes 全带 600px 封面 + primaryGenreName；Arctic Monkeys Tranquility Base 在本区域目录返回 0 条 |
| 3 | `?source=itunes` 真蓝候选补攒 | 10/10 | 按卡片选片策略「含 5–10 张蓝色系封面（保证颜色轴可测）」补 Bicep/BoC Tomorrow's Harvest/Kiasmos/ODESZA/Washed Out/Tycho Weather 等 10 张客观蓝封面专辑 |

- 41 张 POST /api/v1/records 全部 **201 + Location**（脚本逐张断言）；genre 由确认层写入
  （MB 候选 genres=[] → 手工指定；iTunes 候选自动带 primaryGenreName——两种均为 FR-1 合法输入）。
- 封面异步钩子落盘：每轮后等一拍核数——**`data/covers/` 41 文件（sha256 内容寻址命名），
  服务日志 `cover saved` 41 条 / `cover download failed` 0 条**。目标 ≥20 ✓。
- 选片偏差披露（区域目录排序所致，均如实入库）：查询 Dark Side of the Moon 选中 Wish You
  Were Here；查询 Nevermind 选中 Nirvana（2002 精选）；Currents 选中 Currents B-Sides & Remixes EP。

### 2.2 回填（scripts/color-extract.ts，IM-18 口径）

| 次 | 命令 | 候选 | 写值 | 保留槽16→NULL | 失败 | 耗时 |
|---|---|---|---|---|---|---|
| dry-run | `tsx scripts/color-extract.ts --dry-run` | 31 | 31（将写） | 0 | 0 | 1.12s |
| 全量 1 | `tsx scripts/color-extract.ts` | 31 | 31 | 0 | 0 | 1.11s |
| 全量 2（第三轮 10 张后） | 同上 | 10 | 10 | 0 | 0 | 0.33s |

- **回填率口径披露**：脚本统计字段 `backfill_rate` = (already_colored + written) / with_cover，
  本库态下分子被种子占位色（4,293→4,324）撑大、分母只有 41 张真封面记录，输出 139.5%/105.7%
  **不具库级含义**（公式设计前提是「有色记录 ≈ 有封面记录」）。有效口径按 IM-18 ②运行级读：
  候选 41 处理 41 成功写值 41 / 失败 0 → **运行回填成功率 100%；封面记录色值覆盖 41/41 = 100%**。
- 41 张真实提取色值分布：**黑(14)×22 · 白(15)×14 · 灰(13)×3 · 青(7)×1 · 品红(11)×1**；
  **蓝(8) 命中 = 0**；保留槽 16（>MAX_PALETTE_DIST 150 记 NULL）命中 = 0。
- 内存/写入纪律符合脚本头注：逐张即取即弃、只更新 cover_color 列（updated_at 未动）、逐行自动提交。

## 3. 提取忠实性验证（蓝轴稀疏根因定谳）

「蓝系候选 11 张、8 蓝命中 0」是本卡最重发现，先排除管线失真再下结论：直读 6 张封面原图
（Read 工具渲染）对照提取值——

| 封面（实况图） | 人工观感 | 提取值 | 判定 |
|---|---|---|---|
| Kind of Blue（本版 CAA 封面） | 黑色摄影主体占 ~85%，蓝字仅角落 | 14 黑 | 忠实（本压盘版非全蓝文字版） |
| Blue Train（iTunes 600px） | 暗青双色调摄影 | 14 黑 | 忠实（主簇=暗部） |
| Tycho Dive (Deluxe) | 青灰地形 + 橙粉天 | 13 灰 | 忠实（主簇=灰青地形） |
| BoC Tomorrow's Harvest | 淡灰蓝晨雾天际线 | 15 白 | 忠实（高亮度低饱和） |
| Kiasmos | 暗灰蓝云纹 | 14 黑 | 忠实（暗部占比最大） |
| Maiden Voyage / Ghost Stories / Bloom | 蓝调封面 | 14 黑 | 忠实（主簇=暗底） |

**结论：提取忠实，根因 = 真实唱片「蓝封面」多为去饱和 navy（→黑/灰）或高明度淡蓝（→白/灰），
而色板 8 蓝 = #2563EB 饱和中蓝（MASTER.md `--swatch-blue`）——吸附语义（IM-18 最近定义色）下
真实库的蓝轴天然稀疏。这不是缺陷而是 W6 P1-4 色板设计的关键实测输入：蓝 chip 在真实库是长尾值。**

## 4. 场景实测：颜色轴找回路径（PM W6 门禁口径）

路径以 **URL 即状态**直达（每态同时以 curl fragment + IAB 只读截图双证，计数三方一致）：

| 步 | 操作 | URL | 状态行 | 证据 |
|---|---|---|---|---|
| 0 | 单筛 Electronic | `/?genre=Electronic` | 345 张匹配 | 截图 [t1-electronic-345.png](find-scenario-color-screenshots/t1-electronic-345.png)；counts API genre 轴 Electronic=345 |
| 1 | +颜色 蓝（任务指定轴值） | `/?genre=Electronic&color=8` | **19 张匹配** | 截图 [t2-blue-19.png](find-scenario-color-screenshots/t2-blue-19.png)（蓝(19) 墨底激活）；wall fragment「19 张匹配」 |
| 2 | 组合替代：+颜色 黑 | `/?genre=Electronic&color=14` | **26 张匹配** | 截图 [t3-black-26-converged.png](find-scenario-color-screenshots/t3-black-26-converged.png) + [t4-black-26-wall.png](find-scenario-color-screenshots/t4-black-26-wall.png) |
| — | 对照：保留槽 16 | `/?genre=Electronic&color=16` | 23 张匹配（全回退卡） | 截图 [t5-gray16-23.png](find-scenario-color-screenshots/t5-gray16-23.png) |

### 逐条判定

**A. 颜色轴真实可测（回填→轴数据）——✓（附重大发现）**
41 张真实封面经 D3 管线回填后，颜色轴芯片计数由真实提取值驱动：`/?genre=Electronic&color=14`
的 26 张中 10 张为本次真实回填记录（wall fragment：26 cover-card，10 cover-img 本地封面 +
16 种子回退卡）。蓝(8) 真实命中 0（§3 根因）；蓝轴 19 张全部为种子占位值——种子占位与真实
提取值在轴上并存，是本库（种子库+增量真库）的固有形态，如实披露。

**B. ≤3 筛（任务指定「蓝色封面的那张电子」）——✗不入带，如实记录（19 < 20）**
两筛 `genre=Electronic&color=8` = **19 张**，距 20–40 带下沿差 1。按 W4-6-2 先例**不做数字硬凑**：
不为入带追加选片、不放宽口径。诚实的结构性读数：真实库中该场景的收敛上限即蓝轴总量 19
（第三筛只会更小），「蓝封面的那张电子」在本库以 2 筛收敛到 19 张——**不到带、但筛选行为
本身正确**（URL/计数/卡片三方一致，见 t2）。

**C. 一屏收敛（替代组合轴，W4-6-2 先例）——✓**
`genre=Electronic&color=14` = **26 张 ∈ [20, 40]** ✓。封面墙 26 卡**单屏全可见**（t4：7+7+7+5
网格无分页，DOM `cover-card` 计数=26），全程封面可见（10 真实封面 + 16 回退占位卡，回退卡
保持标题可读）。替代仍走**颜色轴本体**（color=14 黑，为真实提取的最大簇），非绕开颜色轴。

**D. URL 即状态（本卡口径 = URL 直达 SSR 全量还原）——✓**
三态均以 URL 直达打开并完整还原：状态行/已选行 chip（Electronic/黑 + `×` 移除）/激活墨底 chip
三方自洽（IAB DOM 快照逐态核对）；pushState/popstate 路径 W4-6-2 已验（filter-cabin 300ms 防抖
+ popstate 守卫已随 `4aa10b1` 入库），本卡不重复。页脚文案「经典找回路径：Genre「Electronic」
→ 我听的时期 → 颜色「蓝」」与 W6 门禁场景同构（t4 底部可见），印证口径出处。

## 5. W4-6-2 移交观察项复核：cover_color=16 vs 13

| 维度 | 16（保留槽） | 13（真灰） |
|---|---|---|
| SQL 记录数 | **285**（全部种子遗留；真实回填 0 命中——管线命中保留槽写 NULL 不写 16） | **285**（282 种子 + 3 真实回填：Dive/Born To Die/To Pimp a Butterfly） |
| Electronic 交集 | 23 | 19 |
| chip 显示 | 「灰 (23)」 | 「灰 (19)」——**两个灰 chip 并存**（t2/t3 截图可数） |
| 渲染语义 | `colorOf(16)` 走 `COLOR_TABLE[n] ?? {gray,灰}` 兜底 | `colorOf(13)` 命中表项 {gray,灰} |
| 卡片形态 | 16 态 wall 23 卡全部 cover-fallback（种子无本地封面），灰调占位 | — |

**结论**：显示层无差异（16 兜底=13 真灰，同 varName gray），但轴语义噪声维持——种子写 1–16
与 COLOR_TABLE 有效域 1–15 错位产生的幽灵轴值。P3 管线按 IM-18 ②只回填 NULL 不改存量值，
本次实测后 16 值 285 不变；消歧需种子库生命周期决策（重灌或数据订正），**交用户裁决，本卡不动数据**。

## 6. 观察项与记录事项

- **蓝轴稀疏**（§3）：真实库蓝 chip 长尾化——建议 W6 P1-4 色板卡评审时引用本文档 §3/§4-B。
- **backfill_rate 公式失真**（§2.2）：种子占位色与真封面混合库态下该字段不具库级含义，已按
  运行级口径披露；如需库级指标建议后续卡明确定义（如「有封面记录的色值覆盖率」）。
- **IAB fullPage 截图伪影**：fullPage 产出 2×3 拼贴重复（视口 1440×900），弃用；证据一律视口
  截图（t3 曾被伪影污染，已用视口重截覆盖）。
- **e2e 环境事实**：Deezer 本机不可达（降级链第二源跳过，第三源 iTunes 顶上）——多源降级链
  实测 exercised，符合 02 §5.1 设计。

## 7. 本卡改动披露

- **零 src/ 改动**（实机操作卡边界）。代码与脚本零修改、零新增。
- 数据操作（不入 git，库态如实披露）：`data/musicgraphy.db` 记录 5,032 → 5,042（+41 真实专辑，
  覆盖 Jazz/Rock/Pop/Electronic/Ambient/Trip Hop/Classical/Hip-Hop/Soul 等）；`data/covers/` 0 → 41 文件；
  cover_color 写值 41（真实提取）；种子占位值未触碰。
- 本文档 + `docs/find-scenario-color-screenshots/`（t1–t5）为本卡全部产出。
- 门禁：`npm run check` 全绿 **110/110**（HEAD `841fcb5` 实况，含并行 W7-9-1 批次新增测试；本卡零代码改动零新增测试）。
