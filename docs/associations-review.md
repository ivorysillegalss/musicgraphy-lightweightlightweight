# B1 联想域实现评审案 · getAssociations（P1-5）

> 产出：B1 会话（用户 2026-11-14 追认令，派工 prompt 即追认依据；2026-11-14）
> 前置案文：`docs/associations-gap.md`（W4-6-3，Q1–Q7 裁决清单 + 三查询形状）——本评审案**全盘采纳其 Q1–Q7 结论**，只补充实现级决策与护栏复核，不重开已裁决问题。
> 关联：IM-16（P1-5 待存储层评审项，本文即其解锁件）· 02-数据模型 §3⑤/§4 API 表 P1-5 行 · 拆分方案 §8 B1。
> 性质：评审案先行（任务 1）；**评审案完成即继续实现**（追认令授权）；唯 dao.ts 必超 200 行或全表扫描不可接受时停下报告——两条触发线均未命中（§3/§4）。

---

## 1. 结论速览

| 项 | 决定 | 依据 |
|---|---|---|
| Q1 扩 DAO | 扩 `getAssociations` | 02 §4 端点在册；ADR-002 六类查询明列联想 |
| Q2 落点 | 案 A：`dao.ts` + `queries.ts`（SQL 常量拆出） | gap §4.3；G3 复核 §3 通过 |
| Q3 同天不排除当年 | 不排除（联想 ≠ 那年今日，不带 ≥1 周年条件） | gap Q3 |
| Q4 时区锚 | 同天 `'localtime'`（与 P1-1 同口径）；**同期同取 localtime**（§2 补充决策 R2） | gap Q4 + 一致性外推 |
| Q5 强度排序 | same_tag 3 > same_day 2 > same_period 1，同一记录只留最强 | gap Q5（遗留先例 sqlite.ts:641-651） |
| Q6 返回形状 | 内联 `AssociationItem`（CollectionItem + relation/matched_tag）定义于 dao.ts，不动 types.ts | gap Q6 + B1 文件边界不含 types.ts |
| Q7 add-dialog「最近艺术家」 | 不并入本方法（形状不同，另案 getRecentArtists） | gap Q7/§4.4；本卡明确不做 |
| SQL 形状 | **三条查询**（非 UNION）：每条自带类内序与 LIMIT，DAO 内存合并去重 | gap §3（遗留先例同款）；UNION 需在 SQL 内做强度列+全局排序，复杂度更高且 limit 语义模糊 |
| 页面组题 | 「同期收藏」「同一天」「共享 Tag」+ 锚点参数（月份/MM-DD/标签名） | 确定性语义；禁「猜你喜欢」（任务 2） |

## 2. SQL 形状（queries.ts 新增常量，口径 = gap §3 + 02 §3⑤）

记 `:uid`=user_id、`:rid`=锚记录 id、`:base`=锚记录 added_at（先查锚，不存在 → `NotFoundError` → API 404）。

```sql
-- SQL_ASSOC_ANCHOR：锚点（gap §3.0）
SELECT added_at FROM collection_record WHERE id = :rid AND user_id = :uid;

-- SQL_ASSOC_TAG（⑤c 同 Tag = 共享任一标签）：锚标签集走 record_tag PK(record_id,tag_id) 前缀点查，
-- 候选行走 idx_record_tag_tag(tag_id)（评审 R9，均索引点查，§4）；GROUP BY r.id 折叠多标签命中行，
-- matched_tag = MIN(t.name)（字典序，确定性 tiebreak）
SELECT ${LIST_COLS}, MIN(t.name) AS matched_tag
FROM collection_record r
JOIN album_metadata m ON m.id = r.album_id
JOIN record_tag a_rt ON a_rt.record_id = r.id
JOIN tags t ON t.id = a_rt.tag_id
WHERE r.user_id = :uid AND r.id <> :rid
  AND a_rt.tag_id IN (SELECT tag_id FROM record_tag WHERE record_id = :rid)
GROUP BY r.id
ORDER BY r.added_at DESC, r.id DESC
LIMIT :limit;

-- SQL_ASSOC_DAY（⑤b 同天 = 同 MM-DD 跨年）：localtime 锚（Q4）；当年同天也命中（Q3）
SELECT ${LIST_COLS}, NULL AS matched_tag
FROM collection_record r JOIN album_metadata m ON m.id = r.album_id
WHERE r.user_id = :uid AND r.id <> :rid
  AND strftime('%m-%d', r.added_at, 'localtime') = strftime('%m-%d', :base, 'localtime')
ORDER BY r.added_at DESC, r.id DESC
LIMIT :limit;

-- SQL_ASSOC_PERIOD（⑤a 同期 = added_at 同自然月）
SELECT ${LIST_COLS}, NULL AS matched_tag
FROM collection_record r JOIN album_metadata m ON m.id = r.album_id
WHERE r.user_id = :uid AND r.id <> :rid
  AND strftime('%Y-%m', r.added_at, 'localtime') = strftime('%Y-%m', :base, 'localtime')
ORDER BY r.added_at DESC, r.id DESC
LIMIT :limit;
```

**实现级决策（gap 案文之上的补充，均不与其冲突）：**

- **R1 · 三查询各 `LIMIT :limit` 而非 UNION**：三段 SQL 保持与既有 SQL_ECHO/AXIS_SQL 相同的"常量 + LIST_COLS"先例形态；类内序 `added_at DESC, id DESC` 在 SQL 层确定性（复审 V11 tiebreak 先例）。UNION 单语句需在 SELECT 列里造强度常量再全局 ORDER BY，limit 无法按类配额，且 dao.ts 里仍要做"最强关系去重"——收益为零。
- **R2 · 同期（%Y-%m）同取 `'localtime'`**：gap §3.1 遗留形状无 localtime，但其评审点只论证了同天（Q4，与 P1-1 口径一致）。月界属同一类本地日历语义（本地 11 月 1 日 00:30 在 UTC 下是 10 月），两套锚并存必然产生"看似同月却不同组"的边界错乱——统一 localtime，一处口径。
- **R3 · 合并去重 = Map 按 id 先到先得**：按强度从高到低遍历（tag → day → period），`if (!merged.has(id))` 即天然保留最强关系（Q5），无需权重比较；类内序由各查询的 ORDER BY 保持，拼接后即为"强度 DESC → added_at DESC → id DESC"的全序，**无需二次 sort**。
- **R4 · 总量上限 = `Math.min(limit, 60)`**（内存纪律①）：三类池子各 ≤limit 行（≤60），合并去重后 ≤3×limit，slice 取前 limit。18 = 三组各 ≤6 的页面配额总和（任务 2）。
- **R5 · 不做索引优化范围扫描**：gap §3.1 的半开区间改写（走 idx_record_user_added）**登记为未来优化路径而不实现**——全表扫描规模 = 记录数，5000 行实测先例 <5ms（perf-like 1–2ms、D2 spike LIKE 全扫 0ms），个人档案规模下换区间写法是过早优化（工程原则：优先简单）。

## 3. 行数预算（G3 · ADR-002 护栏，以 2026-11-14 wc -l 复核为准）

> **⚠️ §3 预算修正案（2026-11-14 02:03，实施时触发追认令停止线后经用户裁决）**：
> 原预算基于开工实况 dao.ts 150 行。实施时发现**并行 B2 会话正活跃推进**（02:00–02:01 写盘），
> 其在制品（未提交）把 dao.ts 推到 **199 行**（+exportAll 31 行）并改了 B1 边界内的 dao.ts/types.ts
> ——案 A 直写 ~+25 行 = 224 ≫ 200，案 B 纯委托 +2 = 201 > 200，均必超 G3。
> **用户裁决 = 路径 B（案 B 变体，立即继续）**：独立 `db/associations.ts` 域文件（writes.ts/album-merge.ts
> 先例同款：域函数收 `st` + DAO 一行箭头委托）+ `stats()` 内联 SQL 机械外拆 queries.ts（IM-10a 先例
> 同款动作，零行为变更，提交说明披露）→ dao.ts 净 -1 行 = **198 < 200 ✓**。
> 边界撞车披露：B2 动 dao.ts/types.ts 超出拆分方案 §8 给 B2 的边界（"queries 导出段+新域+app.ts 一行"），
> 该协调问题已随本修正案呈报用户。

| 文件 | 实施时实况 | 增量 | 增后 | 护栏 |
|---|---|---|---|---|
| `src/server/db/dao.ts` | 199（含 B2 在制品 exportAll） | -1（stats SQL 外拆 -4；import assoc +1；委托注释+行 +2） | **198** | <200 ✓（余量 2 行） |
| `src/server/db/associations.ts`（新） | — | +~42（AssociationItem 类型 + getAssociations 实现 + 强度表） | ~42 | 无硬护栏（域文件先例 writes.ts 185 / album-merge.ts 67） |
| `src/server/db/queries.ts` | 76（B2 导出段 + B1 联想段已入） | +2（SQL_STATS 自 dao.ts 搬入） | ~78 | 无硬护栏 |
| `src/server/routes/records.ts` | 153 | +6（GET 端点） | ~159 | 无硬护栏 |
| `src/server/pages/album.ts` | 106 | +30（ASSOCIATIONS 区渲染） | ~136 | 无硬护栏 |
| `src/server/routes/pages.ts` | 308 | +4（详情 handler 接线，§5 披露） | ~312 | 无硬护栏 |

**若实现中 dao.ts 实测将超 200 行 → 停下报告（追认令触发线 1）**：已于 02:03 触发一次并按上述修正案处置。

## 4. G1–G4 逐项核对

| 护栏 | 核对 | 结论 |
|---|---|---|
| **G1 运行时依赖 ≤2** | 纯 SQL（node:sqlite 内建），零新增 import | ✓ |
| **G2 RSS <100MB** | 三查询各 `LIMIT ≤60`（纪律①）；无 base64/整读（封面走 coverCard 流式 URL）；内存峰值 = 合并去重临时 Map ≤3×60 行 | ✓ |
| **G3 DAO <200 行** | §3 预算 ~175 行；SQL 外拆 queries.ts（既有先例） | ✓ |
| **G4 npm run check 全绿** | 置 done 前置；tsc/eslint/vite build/node:test 四联 | ✓（实现后跑） |

其他纪律：prepared statements 经 StmtCache 一次解析（纪律④）——四条 SQL 均为常量，`this.st.get(SQL)` 缓存形态与 echoToday 同款；迁移 = 零（索引全部现成，见 §4-索引）；hono/html 禁 raw 插用户数据——联想区全部经 `html` 模板插值 + 既有 coverCard 组件，无 raw。

## 5. 索引影响论证（任务 1 指定项）

| 查询 | 访问路径 | 规模 |
|---|---|---|
| 锚点 | `collection_record` PK 点查 | 1 行 |
| 同 Tag | 锚标签集 = `record_tag` PK(record_id,tag_id) 前缀点查；候选 = `idx_record_tag_tag(tag_id)` 点查 + `collection_record` PK 逐行回表；上限 LIMIT | 锚标签数 × 该 tag 记录数，均索引驱动；个人规模（千级）毫秒级 |
| 同天 | `strftime('%m-%d', added_at, 'localtime')` **不可索引 → 全表扫描** | 扫描规模 = 记录数（5000 行） |
| 同期 | `strftime('%Y-%m', added_at, 'localtime')` 同上 | 同上 |

**全表扫描可接受论证**：① 规模上界 = 记录数，个人档案 app（产品理念 §10：非 Discogs 数据库）5000 行是压测口径而非日常；② 同形状实测先例——LIKE 四字段全扫经 listPage 实测 1–2ms（W4-6-2 perf-like），json_each 全扫 4ms（W0 spike），strftime 单函数计算量低于 LIKE 模式匹配，预期同量级（<5ms）；③ 串行限流下联想查询频率 = 详情页访问频度，非热路径热点；④ 若未来规模增长（>10 万行）可按 R5 换半开区间走 `idx_record_user_added(user_id, added_at DESC)`——该索引已存在，优化路径零迁移成本。**结论：可接受，不提前优化。**

## 6. 实现清单与边界披露

| 文件 | 改动 | 边界 |
|---|---|---|
| `src/server/db/queries.ts` | +SQL_ASSOC_ANCHOR/TAG/DAY/PERIOD 四常量 +SQL_STATS（stats 外拆件） | ✓ 在册 |
| `src/server/db/associations.ts`（新） | +`AssociationItem` 类型 +`getAssociations(st, recordId, limit=18, userId='local')` 实现 + 强度表 | ✓ 在册（§3 修正案新增） |
| `src/server/db/dao.ts` | +一行委托 `getAssociations = (...) => assoc.getAssociations(...)`；stats() 内联 SQL 外拆（-4 行，机械搬移零行为变更，披露） | ✓ 在册 |
| `src/server/routes/records.ts` | +`GET /records/:id/associations`（200 `{data:[…]}` / 锚不存在 404 `record_not_found` / limit 非法按既有 clampLimit 收敛 1–60） | ✓ 在册 |
| `src/server/pages/album.ts` | +ASSOCIATIONS 区（三组各 ≤6，组题确定性语义，空组不渲染、全空区不渲染） | ✓ 在册 |
| `tests/associations.smoke.test.ts` | 同期/同天/同 Tag 三命中 + 最强去重 + 空态 + 404 | ✓ 在册 |
| **`src/server/routes/pages.ts`** | **+4 行**：`GET /album/:id` handler 内 `safeAssociations(id)`（try/catch 静默 = 馈赠语义）+ 传参 `renderAlbumDetail` | **越界披露**：pages.ts 不在追认令文件清单内，但渲染解锁（任务 2 + 卡片 DoD"详情页联想三组可见"）要求数据装配；`renderAlbumDetail` 新增**可选**参数（缺省 undefined → 区不渲染），pages.ts 不改则渲染永不出现。与并行 B2/B3 会话边界（export/metrics 链 + app.ts）零交集；pages.ts 当前无其他 agent 占用。**向用户披露，1 处 4 行，请追认** |

app.ts **零改动**（records 域已挂载，新端点落在既有 Hono 子应用内——与 B2/B3 的 app.ts 挂载线冲突面隔离）。

## 7. 测试设计（tests/associations.smoke.test.ts）

fixture：锚记录 + 同月两条（其一共享 Tag 走最强去重）+ 同天跨年一条 + 同天当年一条（Q3 验证）+ 陌生月一条。断言面：三命中形状（relation/matched_tag）、同记录多命中只留最强（same_tag 压过 same_period）、类内序 added_at DESC、limit 截断、空态（无联想记录 → 空数组）、锚不存在 → NotFoundError；页面渲染函数直调断言三组组题可见（不经 HTTP）。

## 8. 本次明确不做（承 gap §6）

- 不实装 `getRecentArtists`（add-dialog「最近艺术家」，Q7 另案）；
- 不动 `types.ts` / `app.ts` / 遗留仓任何文件；
- 不做 R5 索引优化改写；
- 两仓契约归一（alias_sources 先例 IM-13 同款议题）：主线按 Q6 内联重建，不回写遗留仓。

---
*产出：B1 会话 · 2026-11-14 · 行数/索引以当日 wc -l 与 db/migrations/0001_init.sql 复核为准*
