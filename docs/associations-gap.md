# P1-5 联想入口缺口报告 · DAO 扩展评审案文（getRecordAssociations）

> 产出：W4-6-3（第二波派工 P3，`07-前端设计包/02-前端实现拆分方案.md` §7；2026-11-13）
> 性质：**评审案文——未实现，不改 DAO/routes**（契约冻结禁顺手改，AGENTS §11；实现待评审通过后由第三波派工执行）
> 呈报对象：存储层评审（流程对齐 `05-系统架构设计/存储层技术评审报告.md` 先例）
> 关联登记：IM-16（`05/实现决策记录.md` §7，P1-5 待存储层评审项）· 本文即其预告的"联想缺口报告"
> 引用文件以本仓为准：`src/server/db/dao.ts` / `../Musicgraphy-2.0-代码库/src/server/dao/interface.ts`（只读存档）

---

## 0. 提请裁决问题清单（结论索引）

| # | 问题 | 案文建议 | 理由锚点 |
|---|---|---|---|
| Q1 | 主线 DAO 是否扩 `getRecordAssociations` | **扩** | P1-5 是 02 §4 在册端点；ADR-002 证据链"六类查询"明列联想 |
| Q2 | 落点：dao.ts + queries.ts（案 A）或独立 db/associations.ts（案 B） | **案 A** | dao.ts 150 行 + ~20 行 ≈ 170 < 200（G3）；queries.ts 已是 SQL 常量先例 |
| Q3 | 同天语义是否排除当年（只回响往年） | **不排除**（同遗留实现） | 联想 ≠ 那年今日：当年同天也相关；echoToday 的 ≥1 周年条件不搬入 |
| Q4 | 同天时区锚：`strftime('%m-%d', added_at)` 是否加 `'localtime'` | **加** | 02 §3 复审注已把那年今日修为 localtime 锚——同一 MM-DD 口径不应两套时区 |
| Q5 | 关系强度排序 | same_tag 3 > same_day 2 > same_period 1，最强关系去重 | 遗留实现先例（sqlite.ts:641-651），"用户亲手建立的认知 > 时间巧合" |
| Q6 | `AssociationItem` 形状以哪仓为准 | 以遗留 `shared/types.ts:163-174` 为基准在主线重建（字段见 §4.2） | 两仓类型差异先例 = alias_sources（IM-13），归一须用户裁决；主线先行不增差异 |
| Q7 | add-dialog「最近艺术家」是否并入本方法 | **不并入**，另案 `getRecentArtists(limit)` 评审 | 查询形状不同（§4.4）；IM-16 所指即此项，勿混入 record 联想 |

## 1. 现状（以代码为事实源，2026-11-13 grep/行数复核）

- 02-数据模型 §4 已在册端点 `GET /api/v1/records/:id/associations`（同期/同天/同 Tag 联想，P1-5 行）。
- 遗留仓（存档）已定义并实现：契约 `dao/interface.ts:131-136`（⑤ 联想），实现 `dao/sqlite.ts:591-671`。
- 主线（本仓）**全缺**：`dao.ts`（150 行）无任何 associations 方法；`routes/records.ts`（153 行）无该端点；
  `src/server/pages/album.ts` 详情页无联想区（grep "associations|联想" 于 routes/ 与 pages/ 零命中）。
- 呈现层降级现状（IM-16）：add-dialog 零输入候选 = 诚实占位，tag 行以 top-used 近似「最近」。
- **契约冻结条款**（为什么不能顺手加）：遗留仓 `dao/interface.ts` 头注——
  「**回退只允许换 DAO 实现文件，本接口（含全部类型）不得改动**」。主线 DAO 为另一实现
  （00-工作区关系与硬约束 §三：方法名不同），扩展路径 = 评审案 + G3 护栏（<200 行，ADR-002）。

## 2. 为什么该扩（问题陈述）

1. P1-5 不是新增需求：02 §4 API 表已登记该端点，缺实现 = API 面与文档事实源不符。
2. ADR-002 证据链明列 02 §3 的查询模式共六类（分页 / 5 轴计数 / LIKE 检索 / 详情 / **联想** / 那年今日）
   ——联想是规划内查询，扩方法不属契约外蔓延。
3. B1「找得回」产品语义：联想 = 「从一张唱片找到下一张」（同期 = 同月收藏脉络；同天 = 周年锚；
   同 Tag = 用户亲手建立的认知路径）。FR-2/FR-3 已收口（W2），联想是下一块在册缺口。
4. 主线已具备全部索引前提：`idx_record_user_added(user_id, added_at DESC)`、`record_tag(tag_id)`
   （评审 R9）、`idx_record_user_color`——零迁移、零新依赖。

## 3. 所需查询形状（口径 = 遗留契约 ⑤ + 02 §3⑤）

记 `:uid` = user_id（主线默认 'local'），`:rid` = 锚记录 id，`:base` = 锚记录 added_at。

### 3.0 锚点（不存在 → 空结果，API 层转 404 envelope）

```sql
SELECT added_at FROM collection_record WHERE id = :rid AND user_id = :uid;
```

### 3.1 ⑤a 同期 = added_at 同自然月

```sql
-- 遗留形状（sqlite.ts:608-616）：strftime 相等
... WHERE r.user_id = :uid AND r.id <> :rid
      AND strftime('%Y-%m', r.added_at) = strftime('%Y-%m', :base)
-- 评审优化点：strftime 全表计算不走索引；5000 行规模无感，如评审要求走
-- idx_record_user_added 可改半开区间（BETWEEN 可比较，02 §3 注记）：
--   r.added_at >= strftime('%Y-%m-01T00:00:00Z', :base)
--   AND r.added_at <  strftime('%Y-%m-01T00:00:00Z', :base, '+1 month')
```

### 3.2 ⑤b 同天 = added_at 同 MM-DD（跨年）

```sql
-- 遗留形状（sqlite.ts:618-626）+ Q4 评审点：补 'localtime'（与那年今日 P1-1 口径一致，复审注）
... WHERE r.user_id = :uid AND r.id <> :rid
      AND strftime('%m-%d', r.added_at, 'localtime') = strftime('%m-%d', :base, 'localtime')
-- 不加 ≥1 周年条件（Q3）：联想不求"回响 ≥1 周年"，当年同天同样成立——与 echoToday 刻意不同
```

### 3.3 ⑤c 同 Tag = 共享任一标签

```sql
-- 遗留形状（sqlite.ts:628-638）：tag_id IN 锚记录标签集；record_tag(tag_id) 索引（评审 R9）
SELECT ..., t.name AS matched_tag
FROM collection_record r JOIN album_metadata m ON m.id = r.album_id
JOIN record_tag a_rt ON a_rt.record_id = r.id JOIN tags t ON t.id = a_rt.tag_id
WHERE r.user_id = :uid AND r.id <> :rid
  AND a_rt.tag_id IN (SELECT tag_id FROM record_tag WHERE record_id = :rid)
```

### 3.4 混合排序（"关系强度"）

- 强度表：`same_tag: 3 > same_day: 2 > same_period: 1`（Q5）。
- 同一记录命中多类 → **只保留最强关系一条**（matched_tag 随 relation 同走）。
- 类内序：`added_at DESC, id DESC`（确定性 tiebreak）。
- 三类各取 LIMIT 子集后内存合并去重（遗留先例），总数 `LIMIT ≤60`（内存纪律①）。

## 4. 建议的 DAO 扩展案文

### 4.1 签名（主线形态：显式 userId 默认 'local'——与 dao.ts 现有方法一致）

```ts
/** P1-5 联想（02 §4 端点）：同期/同天/同 Tag，关系强度混合排序，limit ≤60。锚不存在 → NotFoundError */
getRecordAssociations(recordId: string, limit = 20, userId = 'local'): CollectionItem & { relation: 'same_period' | 'same_day' | 'same_tag'; matched_tag: string | null }[]
```

> Q6：返回形状两仓取齐问题——遗留 `AssociationItem`（§4.2）与主线 `CollectionItem` 字段高度重合；
> 案文建议主线返回类型内联定义（relation + matched_tag 扩展），**不动** `src/server/db/types.ts` 以外任何冻结件。

### 4.2 返回形状（基准 = 遗留 `shared/types.ts:163-174`）

`{ record_id, album_id, title, artist, cover_url, cover_local, relation, matched_tag, added_at }`——
relation = 该记录的**最强**命中关系；matched_tag 仅 relation='same_tag' 时非空。

### 4.3 落点与护栏核对（案 A 建议案）

| 护栏 | 核对 |
|---|---|
| G3 dao.ts < 200 行 | 150 + 方法 ~15 行 ≈ **165** ✓（SQL 常量进 queries.ts，现 35 行，先例同款） |
| 依赖 ≤ 2 | 纯 SQL，零新增 ✓ |
| prepared statements（纪律④） | 经 StmtCache 一次解析 ✓ |
| LIMIT 上限（纪律①） | ≤60 ✓ |
| 迁移 | 无（索引全部现成）✓ |

案 B（备选）：独立 `db/associations.ts` 域文件（album-merge.ts 先例）——仅在评审认为 dao.ts 余量
须保守时采用；代价 = 多一文件与委托层，违反"能少一文件不少一文件"的简单性偏好。

### 4.4 add-dialog「最近艺术家」≠ 本方法（IM-16 澄清）

IM-16 所指 add-dialog 零输入候选「最近艺术家」需要的查询形状是**按 artist 分组的最近添加**：

```sql
SELECT m.artist, MAX(r.added_at) AS latest, COUNT(*) AS n
FROM collection_record r JOIN album_metadata m ON m.id = r.album_id
WHERE r.user_id = :uid GROUP BY m.artist COLLATE NOCASE ORDER BY latest DESC LIMIT :limit;
```

与 record 联想（以一条记录为锚的三类关系）形状不同，建议独立方法 `getRecentArtists(limit, userId)`
另案评审；当前 top-used 近似占位维持至该方法落地（诚实占位不阻塞）。

### 4.5 配套 routes 形状（实现波次执行，不在本案）

`GET /api/v1/records/:id/associations?limit=` → 200 `{data:[...]}`；锚不存在 → 404
`{error:{code:'record_not_found'}}`；limit 校验失败 → 422（ADR-007 #2/#6/#7、复审 V11 口径）。

## 5. 影响面与风险

- 性能：三类查询在 5000 行种子库均为毫秒级（envelope：LIKE 全扫 <5ms 实测 0ms，§2 D2 spike）；
  同 Tag 的 IN 子查询走 `record_tag(tag_id)`；同天/同期为全表 strftime 扫描（5000 行 <5ms 预期，
  如评审要求可按 §3.1 优化形状改范围扫描）。
- 兼容：纯新增方法 + 纯新增端点，无既有调用方变更；呈现层占位替换即收益。
- 两仓契约归一（Q6/Q7 + alias_sources 先例 IM-13）：遗留仓为只读存档，归一方向（遗留对齐主线 /
  主线对齐遗留 / 各自冻结）须用户裁决；本文建议主线按 §4.2 内联重建，不回写遗留仓。

## 6. 本次明确不做

- 不改 `dao.ts` / `queries.ts` / `types.ts` / `routes/*` / `pages/*`（本文只产案文）；
- 不动遗留仓任何文件（只读存档）；
- 不实装 §4.4 `getRecentArtists`（另案）。

---
*产出：W4-6-3 会话 · 2026-11-13 · 行数/端点现状以当日代码复核为准*
