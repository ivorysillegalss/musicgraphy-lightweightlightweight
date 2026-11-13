# Musicgraphy 2.0 · 数据模型与 API 设计

> v1.2 · 2026-11-11 · 方案 A/B 共用 · 工程约束：AGENTS.md §4（元数据/用户数据二分）、§11（优先简单）
> v1.1 存储层评审修订（R3/R4/R5/R6/R9/R10）：见 `05-系统架构设计/存储层技术评审报告.md`
> v1.2 五维复审修订（行内标注"复审 Vnn"）：V1 §4 与 ADR-007 v1.1 全量同步 / V2 限流重设计与 User-Agent 合规 / V10 鉴权规格 / V11 cursor 规格 / V12 tags UNIQUE 与 album_id NOT NULL；另顺手修正 §3 那年今日时区与周年边界（复审注）
> 上游：PRD FR-4 三条数据决定（D1 listenedAt 语义 / D2 集合语义 / D3 封面主色）

---

## 1. 实体关系（ER 概览）

```
Album Metadata (1) ────< (N) Collection Record (1) ────< (N) Record Tag >──── (N) Tag
     外部元数据                用户资产（唯一事实对象）              用户认知体系
                               │  listened_at / note / favorite / cover_color
                               └────< (0..1) Saved View（P1-10，仅查询状态）
```

- **推荐关系严格执行**：`Album Metadata 1 --- N Collection Record`（AGENTS.md §4）。
- **当前单用户**：所有表保留 `user_id` 列（默认值固定），不为单用户省掉关系维度——避免未来迁移数据。
- **没有** 收听事件表（裁决案1：集合语义）、没有 View 状态表（Topster 策展模型在 P1 打包时新增，见 §6）。

## 2. 表结构

### 2.1 album_metadata（外部元数据，可替换可重同步）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT (uuid) | PK | |
| source | TEXT | NOT NULL | `musicbrainz` / `deezer` / `itunes` / `discogs`（多源降级链，见 §5.1） |
| source_id | TEXT | NOT NULL | 源内唯一 ID |
| title / artist | TEXT | NOT NULL | 展示用快照（缓存，源失效也能显示） |
| release_year | INT | NULL | 发行年（注意：≠ 听的时期） |
| cover_url | TEXT | NULL | 远端封面地址 |
| cover_local | TEXT | NULL | 本地缓存路径（拿到即缓存，源失效可显示） |
| genres | TEXT (JSON) | NULL | 公共分类，仅展示与 FR-2 筛选 |
| country | TEXT | NULL | |
| alias_sources | TEXT (JSON) | NULL | 跨源合并时的其余源 ID（§5.2，评审 R4 补列） |
| created_at / updated_at | TEXT (ISO8601) | NOT NULL | |

唯一索引：`UNIQUE(source, source_id)`；同一专辑多源重复时按 §5.2 合并规则处理。

### 2.2 collection_record（核心事实对象，用户资产）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | TEXT (uuid) | PK | |
| user_id | TEXT | NOT NULL, default 'local' | 保留多维关系 |
| album_id | TEXT | **NOT NULL**, FK → album_metadata.id | **UNIQUE(user_id, album_id)** ← D2 集合语义的物理执行（NOT NULL 必须：SQLite 中 NULL 在 UNIQUE 组合内可重复，复审 V12） |
| added_at | TEXT (ISO8601) | NOT NULL | 记录时间（事实，不可编辑） |
| listened_at | TEXT | NULL | **= 最近一次听**（D1：默认 = added_at，**落库时复制**——added_at 为不可变事实，复制安全；可改。年份精度规范（评审 R5）：统一存 `YYYY-01-01T00:00:00Z` + `listened_precision='year'`，**禁止存裸 `YYYY`**——保证 BETWEEN/strftime 可比较） |
| listened_precision | TEXT | NULL | `day` / `year`（"大概 2012" 的精度标记，供"听的时期"轴分组与那年今日过滤） |
| note | TEXT | NULL | 用户自由文本（FR-3 检索对象；"为什么留下它"的落点） |
| is_favorite | INT (0/1) | NOT NULL DEFAULT 0 | 布尔；**不**加排序字段（裁决案7：叙事归 View 层） |
| cover_color | INT | NULL | 色板枚举 1–16（D3 派生字段，记录时提取，可批量回填） |
| created_at / updated_at | TEXT | NOT NULL | |

索引：`(user_id, added_at DESC)`（Recently Added 默认序）、`(user_id, listened_at)`（听的时期轴）、`(user_id, cover_color)`、`(user_id, is_favorite)`；note/tag 检索用 LIKE（5000 张规模毫秒级，禁搜索引擎）。

### 2.3 tags / record_tag（用户认知体系）

```
tags:        id PK, user_id, name, normalized_name (小写去空格), created_at
             UNIQUE(user_id, normalized_name)  -- 复审 V12：R9 的普通索引防不了同名重复插入，防分裂必须落到唯一约束
record_tag:  record_id FK, tag_id FK, created_at, PRIMARY KEY(record_id, tag_id)
```

- 自动补全查询：`WHERE normalized_name LIKE ?`（FR-1，前缀匹配走索引）。
- 索引补充（评审 R9）：`tags(user_id, normalized_name)`（补全前缀 LIKE）、`record_tag(tag_id)`（按 tag 反查/计数——PK `(record_id, tag_id)` 不覆盖该方向）。
- P1-6 合并提示数据源：`SELECT tag_id, COUNT(*) FROM record_tag GROUP BY 1 HAVING COUNT(*)=1` + 近形比对（编辑距离 ≤2）。

### 2.4 saved_views（P1-10，命名视图 = 仅查询状态）

| 字段 | 类型 | 说明 |
|---|---|---|
| id / user_id / name | | 名称即用户沉淀的检索语言（"深夜电子""大一那年"） |
| query_json | TEXT (JSON) | `{axes:{genre,release_year,listened_period,favorite,tag,color}, q}`——**只存筛选状态，不存专辑集合**（裁决案4 附条件；与 Topster 同构） |
| created_at | | |

### 2.5 color_palette（静态枚举，无表）

12–16 离散色板常量（红/橙/黄/绿/青/蓝/紫/粉/棕/灰/黑/白…）。提取算法：封面主色聚类（k-means 或中位切分）→ 映射最近色板项；失败 → NULL（前端显示"无色板"占位）。

## 3. 核心查询模式（对齐 FR-2/FR-3）

```sql
-- chips 组合 + 实时计数（一次往返）：先取命中总数，再取各轴候选值计数
SELECT COUNT(*) FROM collection_record r JOIN album_metadata m ON ... WHERE <组合条件>;
-- genres 为 JSON 数组列（评审 R3 修正）：计数/筛选经 json_each 展开，不可直接 GROUP BY genre
SELECT je.value AS genre, COUNT(*) FROM collection_record r
  JOIN album_metadata m ON m.id = r.album_id, json_each(m.genres) je
  WHERE <组合条件(除genre)> GROUP BY je.value;   -- 每激活一个 chip 重算其余轴

-- 全文检索（标题/艺术家/Tag片段/Note片段）
WHERE r.note LIKE '%q%' OR m.title LIKE '%q%' OR m.artist LIKE '%q%'
   OR r.id IN (SELECT record_id FROM record_tag JOIN tags USING(tag_id) WHERE tags.name LIKE '%q%')

-- 我听的时期轴（D1 语义 + 精度）
WHERE r.listened_at BETWEEN :from AND :to   -- precision='year' 时按年对齐

-- 那年今日（P1-1）：确定性时间锚（复审注修正两处：'now' 默认 UTC 会使本地"今天"偏一天；
-- added_at 含时间部分，恰好一周年当天会被 `<= date('now','-1 year')` 排除）
WHERE strftime('%m-%d', r.added_at, 'localtime') = strftime('%m-%d','now','localtime')
  AND date(r.added_at) <= date('now','localtime','-1 year')      -- 只回响 ≥1 周年的
```

> 检索限制（评审 R10）：SQLite `LIKE` 仅对 ASCII 折叠大小写——中文场景不受影响，重音拉丁字母（é/e）不折叠；当前语料规模可接受，若未来覆盖多语种曲库再评估 `lower()` 冗余列或 FTS5。年份精度值统一为 `YYYY-01-01T00:00:00Z`（§2.2），保证 `BETWEEN` 与 `strftime` 可比较。

## 4. API 设计（REST，JSON · 本节为 v1.1 终版口径，复审 V1 与 ADR-007 全量同步）

> **权威口径 = 07-ADR ADR-007（v1.1）**。旧口径（无 `/api/v1/` 前缀 / `{data,error}` 双键 / 校验失败用 400）**作废**。

| Method | Path | 作用 | 成功/特殊响应 | 对应 PRD |
|---|---|---|---|---|
| GET | `/api/v1/search/albums?q=&source=` | 外部源搜索（元数据获取代理） | `{data:[…]}`，每项含 **`in_collection`** 标记（FR-1 候选阶段标注已在 Collection，复审注补定义） | FR-1 输入端 |
| POST | `/api/v1/records` | 落库（album_id 必带） | **201 + Location**；重复 → **409** `{error:{code:'duplicate_record',details:{record_id}}}`（前端转 FR-1 转化提示） | FR-1 / D2 |
| PATCH | `/api/v1/records/:id` | 补/改 favorite、tags、note、listened_at（D1 语义） | 200 `{data}`；校验失败 → **422** 字段级 details | FR-1 / P1-7 |
| GET | `/api/v1/collection?genre=&year=&listened=&favorite=&tag=&color=&q=&sort=&cursor=&limit=60` | chips 组合查询 + 分页封面墙（无限滚动） | `{data,meta,links}`：`meta.has_next` 放布尔值，`links.next` 放下一页完整 URL | FR-2 / FR-3 |
| GET | `/api/v1/collection/counts?...同上` | 各轴实时计数（联动收敛） | `{data:{genre:{…},…}}`（genre 轴经 json_each，预期 <10ms） | FR-2 |
| GET | `/api/v1/records/:id` | 详情（元数据 + 个人区重组数据） | `{data}` / 空态 `{data:null}`；不存在 → 404 | P1-2 |
| GET | `/api/v1/records/:id/associations` | 同期/同天/同 Tag 联想 | `{data}` | P1-5 |
| GET | `/api/v1/echo/today` | 一年前的今天（有则返回卡片数据，无则 **204**） | 204 = 空态（非错误） | P1-1 |
| GET | `/api/v1/export?format=json|csv&with_covers=1` | 全量导出（**永久免费**；`with_covers=1` 打包含封面 zip，评审 R6） | 文件流 | P1-3 |
| GET | `/api/v1/metrics/coverage` | 线索覆盖率等仪表（匿名化、可关闭） | `{data}` | PRD §6 |

**pages 域（SSR 页面端点，v1.2 补登记——F0 骨架交付，ADR-003 V4 无 JS 基线）**：页面与片段路由挂在 `/`（非 `/api/v1`），错误以 HTML 三态呈现（不走 JSON envelope）；URL 即状态（DD3），筛选参数与 collection API 同名映射：`q / genre / year(发行) / period(听的年份) / fav / tag / color / cursor`。

| Method | Path | 作用 | 特殊响应 |
|---|---|---|---|
| GET | `/` | Collection 主页（回响区/筛选舱/状态行/封面墙/分页） | DAO 异常 → 墙区 HTML error 态（handler 内自捕获） |
| GET | `/add` · POST `/add` | 添加表单 / 落库 | 303 `/?flash=added`；409 → 303 `/album/:id?flash=duplicate`（C-DUP）；失败 → 303 `/add?flash=error`（不阻塞） |
| GET | `/album/:id` | 详情双区 + 联想入口 | null → 404 引语页；异常 → HTML error 页 |
| POST | `/album/:id/favorite` | Favorite 开关（无 JS 表单） | 303 返回详情（失败静默） |
| GET | `/fragment/cabin` · `/fragment/wall` | 筛选舱/封面墙 HTML 片段（岛屿 fetch-swap 用） | DAO 异常 → **503**（岛屿注入错误态的信号） |

**错误 envelope（复审 V1 统一，取代旧 `{data,error}` 双键）**：失败一律 `{error:{code,message,details?}}`，HTTP 状态码表意（畸形请求 400；校验失败 **422** 字段级 details；不存在 404；重复 409；限流 429）；前端三态（loading/empty/error，AGENTS.md §14）判断 = HTTP 状态码 + `error.code`，**禁止"200 + error"歧义形态**。

**cursor 分页规格（复审 V11）**：cursor = 不透明 base64(JSON)，内容为 `[sort列值, id]` 复合键（Release Year / Artist / Title 均非唯一键，必须 tiebreaker）；服务端用 SQLite row-value 比较 `(sort_col, id) > (?, ?)`；`sort` 参数变更即作废旧 cursor（400 code=cursor_invalid，前端重取第一页）；新增记录造成的轻微位移可接受（档案场景无强一致需求）；limit 上限 60。

**元数据代理限流（复审 V2，P0——原 30/min per IP 与上游政策不符）**：
- MusicBrainz 官方政策 = per-IP **平均 1 req/s、超速 100% 拒绝（503）、缺 User-Agent 视为匿名加重限制**（musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting）；
- 本端实现 = **全局串行队列**（相邻上游请求间隔 ≥1s）+ 全局限流 30/min（429 + Retry-After 自我防线）；
- **显式 User-Agent**：`Musicgraphy/<version> (+contact)`（合规必需）；
- per-IP 限流弃用：单机部署后"每 IP"即用户自己，无防护意义；
- iTunes Search ≈ 20 calls/min，单独配额；Cover Art Archive 无硬限流，但抓取取 250/500 缩略图尺寸并落盘缓存（F3）。

**鉴权（复审 V10——"单用户访问密钥"原仅有结论无规格）**：SSR 页面无有效 cookie → 302 到密钥表单页；`POST /login` 以 `crypto.timingSafeEqual` 比对密钥 → 下发 HttpOnly + SameSite=Lax + Secure 签名 cookie；岛屿 fetch 同源自动携带；CSRF = SameSite=Lax + unsafe 方法校验 `Origin`/`Sec-Fetch-Site` 头（约 10 行）；导出脚本/外部工具走 `Authorization: Bearer <key>` 备用通道（自定义头天然免 CSRF）。除静态资源与登录页外无公开端点。

## 5. 数据生命周期规则

### 5.1 元数据多源降级链
`MusicBrainz（免费·主源）→ Deezer / iTunes Search（免费·封面好）→ Discogs API（冷门兜底）`。任一源失效不影响已存记录（title/artist/cover 均为本地快照）。上游调用纪律见 §4 限流规格：全局串行 ≥1s 间隔 + 显式 User-Agent（复审 V2）。

### 5.2 跨源去重与合并
同一专辑被多源命中时：保留首个 record 挂接的 album_metadata，其余源 ID 存入 `alias_sources`（JSON 列），**不迁移用户数据**——用户资产永远不动，动的只是外部引用。

### 5.3 替换与补缺红线（PRD §8 / 裁决案3）
- 外部有数据：用户**不可**改写 album_metadata 公共字段（AGENTS.md §4）；
- 外部无数据（自印/冷门，**观察池项，未立项**）：若未来搜索失败率触发立项，红线预锁为——用户提供值写入**用户数据层**并标记 `source: user-provided`，永不回写外部字段；外部日后补齐时用户值自动转"个人覆盖显示"。

### 5.4 导出格式（P1-3，永久免费）
```json
{ "version": "2.0", "exported_at": "...",
  "records": [ { "album": {title, artist, release_year, cover_url, genres},
                 "record": {added_at, listened_at, listened_precision, is_favorite, cover_color, note},
                 "tags": ["夜晚","2026最爱"] } ] }
```
导出即完整备份：可重建整座档案（数据主权验收）。
**封面边界（评审 R6）**：JSON/CSV 含 `cover_url`（远端地址）但**不含图片文件**——若远端失效（F1 场景）且仅剩 `cover_local` 本地缓存，重建档案时封面丢失。导出实现须提供 **"含封面 zip" 选项**（打包 `data/covers/`，与 JSON 同层分发）；I4"可重建档案"验收以含封面版本为准。

## 6. 预留位（不实现，只声明）

- **计费/授权**：方案 A 切换时新增 `entitlements` 表（license_key, plan, expires_at）——现在**不建表**，只在此声明位置（04A §3）。feature flag：`billing_enabled=false`。
- **Topster 策展模型**（P1 打包时建）：`topster_views(id, user_id, title/subtitle, item_order JSON, created_at)`——与 Topster 首版同期生效（A5 底线）；顺序即叙事，但仅限顺序+副标题，禁自由画布。
- **听期 Era 语言**（观察池）：等命名视图密度信号，不预建。
