# P1-6 Tag 轻治理实现评审案 · 合并提示一行式 + 引用重定向

> 产出：W7-9-1 会话（2026-11-14）。性质：**评审案先行**（本卡红线：新端点一律评审案先行，B1 先例）。
> 本案不涉及新表（`tags.normalized_name` 已预置零迁移，02 §2.3）、不超 G3 行数预算（§3 核对），
> 两条停止线均未命中——按 B1 先例，评审案完成即继续实现。
> 规格出处：PRD P1-6（季度级一行式合并提示 / 引用重定向 / ≤1 次·季度）· 02 §2.3（数据源 SQL）· PM §4 W9。

---

## 1. 结论速览

| 项 | 决定 | 依据 |
|---|---|---|
| Q1 治理候选 SQL | 一条 SQL：全部 tag + 引用计数（LEFT JOIN，含 0 引用）`LIMIT 500` 防御上限 | 02 §2.3 的 `GROUP BY tag_id HAVING COUNT(*)=1` 只覆盖有引用的孤 tag——setTags 删引用不删 tags 行，0 引用 tag 同属治理对象（LEFT JOIN 才完整）；走 `idx_record_tag_tag(tag_id)` 点查 |
| Q2 近形判定 | 归一化名上 JS 编辑距离（Levenshtein），阈值分档：短词（min 长度 ≤2）距离 **1** 才算近形、≥3 字维持 **≤2**；O(n²) 对子比对个人规模毫秒级 | 02 §2.3「编辑距离 ≤2」的**收紧修订**（实施中发现：2 字符中文 tag 任意不同字对距离恒为 2，「旅行/海边」会误报——短词一个字符差异才够近似；收紧方向安全）；无 SQL 内建距离函数，JS 侧是唯一落点；G1 零依赖（自写 12 行 DP，不引库） |
| Q3 提示形态 | 主页一行式（回响卡之后、筛选舱之前）：近形对 ≤3（各带「并入 A / 并入 B」双按钮 = PRD「点击选目标」）+ 孤 tag ≤5 仅提示「只挂 1 张」（无近形对不开合并动作） | PRD P1-6「一行式」「点击选目标合并」；孤 tag 无明确目标可并——动作面收窄到近形对，孤 tag 提示驱动用户挂更多记录或自行改名 |
| Q4 ≤1 次/季度 | cookie `mg_tag_hint=<year-Qn>`（HttpOnly+Lax，Max-Age 92 天）：当季值在场 → 不渲染提示；「本季度不再提示」按钮与合并成功均写入 | PRD 验收「提示不打扰 ≤1 次/季度」；无表零迁移（cookie 是唯一不建表的持久层）；季度翻滚自然重开 |
| Q5 合并语义 | 事务内三条 SQL：①引用重定向 `INSERT INTO record_tag SELECT record_id,:target FROM record_tag WHERE tag_id=:source AND record_id NOT IN (…已有 target…)`（PK 冲突 = 该记录已有目标 tag，跳过）②删 source 全部引用 ③删 source tags 行——**旧 tag 消失、引用保留**（PRD 验收）。返回 `{moved, deleted}` 双标志：moved=重定向行数，deleted=旧 tag 行确实被删——**moved=0 且 deleted=true 合法**（唯一引用记录已同挂目标 tag，全部去重，旧 tag 仍消失）；路由以 deleted（非 moved）判定合并完成 | D2 精神（引用不丢不重）；`record_tag` PK(record_id,tag_id) 幂等；`updated_at` 不动 album/record（tag 归组是认知层操作，记录事实不变） |
| Q6 端点 | POST `/tags/merge`（form source/target，sameOrigin）→ 303 `/?flash=merged`；POST `/tags/hint-dismiss` → 303 `/`（写季度 cookie）；GET `/` 装配 `tagHint`（try/catch 馈赠静默） | 无 JS 基线（原生 form+303，ADR-003）；新端点 = POST×2（本卡红线触发评审案即本案）；`flash=merged` 扩 FlashKind 一分支 |
| Q7 方向默认 | 提示对内预选引用计数大者为目标（推荐方向），双按钮仍可反向——方向即数据（大者 = 既有认知主轴） | 「点击选目标」的默认解；不引入额外 select 控件（一行式形态约束） |

## 2. SQL 与查询形状

```sql
-- SQL_TAG_GOV（queries.ts 新增；Q1）：全部 tag + 引用计数，refs DESC（Q7 推荐方向的数据基础）
SELECT t.id, t.name, t.normalized_name, COUNT(rt.record_id) AS refs
FROM tags t LEFT JOIN record_tag rt ON rt.tag_id = t.id
WHERE t.user_id = ?
GROUP BY t.id ORDER BY refs DESC, t.normalized_name LIMIT 500;
```

```sql
-- mergeTags 事务体（Q5；st = StmtCache，db.exec BEGIN IMMEDIATE/COMMIT —— writes.tx 先例）
INSERT INTO record_tag (record_id, tag_id, created_at)
  SELECT record_id, ?, ? FROM record_tag WHERE tag_id = ?
    AND record_id NOT IN (SELECT record_id FROM record_tag WHERE tag_id = ?);  -- 重定向（排除已有 target 的记录）
DELETE FROM record_tag WHERE tag_id = ?;                                        -- 旧引用清零
DELETE FROM tags WHERE id = ? AND user_id = ?;                                  -- 旧 tag 消失
```

索引影响：`idx_record_tag_tag(tag_id)` 点查驱动 LEFT JOIN 与重定向；`idx_tags_user_norm` 支持 source/target 归一化定位。规模 = tag 数（个人档案权重千级以内），毫秒级——同 W0 spike / perf-like 实测先例量级。

## 3. 行数预算（G3 · ADR-002 护栏，以 2026-11-14 wc -l 为准）

| 文件 | 实施前 | 增量 | 增后 | 护栏 |
|---|---|---|---|---|
| `src/server/db/dao.ts` | 193 | +2（`tagCandidates` / `mergeTags` 两行箭头委托） | **195** | <200 ✓ |
| `src/server/db/taggov.ts`（新） | — | +~85（候选发现 + 近形对 + mergeTags 事务） | ~85 | 无硬护栏（域文件先例 associations 39 / metrics 45 / writes 185） |
| `src/server/db/queries.ts` | 83 | +3（SQL_TAG_GOV） | ~86 | 无硬护栏 |
| `src/server/routes/pages.ts` | ~375 | +~30（hint 装配 + POST×2） | ~405 | 无硬护栏 |
| `src/server/pages/collection.ts` | 248 | +~25（提示条渲染函数） | ~273 | 无硬护栏 |
| `src/server/html.ts` | ~260 | +3（FlashKind 'merged' 分支） | ~263 | 无硬护栏 |

**停止线核对**：dao.ts 195 < 200（余量 5）✓；无新表 ✓——两条停止线均未命中，继续实现。

## 4. G1–G4 逐项核对

| 护栏 | 核对 | 结论 |
|---|---|---|
| **G1 运行时依赖 ≤2** | 编辑距离 = 自写 DP（~12 行）；纯 SQL + cookie，零新增 import | ✓ |
| **G2 RSS <100MB** | SQL `LIMIT 500`（防御上限）；近形对 = 内存比对 500×500/2 次距离计算（~125K 次字符级 DP，实测毫秒级，个人规模 tag 数远小于 500）；无 base64/整读 | ✓ |
| **G3 DAO <200 行** | §3：195 < 200（域文件委托，IM-10a / B1 案 B 先例） | ✓ |
| **G4 npm run check 全绿** | 置 done 前置 | ✓（实现后跑） |

其他纪律：hono/html 禁 raw 插用户数据（tag 名全经模板转义）；无 JS 基线不回归（提示条 = 静态 HTML + form POST）；不在 filter-cabin 岛屿内（swap 区外，不受防抖/popstate 影响）。

## 5. 测试设计（tests/tag-governance.smoke.test.ts）

fixture：`夜晚(3)` `夜间(2)`（距离 1 → 近形对）+ `旅行(1)`（孤）+ `海边(1)` + `电脑(1)`。断言面：①候选发现（近形对识别 + 推荐方向 = refs 大者为目标）②孤 tag 提示（≤5）③mergeTags：旧 tag 消失、引用保留（重定向计数 + 抽查 record 的 tags）④PK 冲突去重（记录已同时挂两 tag 时合并不多不少）⑤事务回滚（target 缺失 → 抛错、库不变）⑥季度 cookie 语义在端点层 e2e（dismiss → 当季不渲染；合并成功 → 同）⑦渲染：一行式提示可见 + 「并入」双按钮 + 孤 tag 文案「只挂 1 张」。

## 6. 本次明确不做

- 不做 tag 批量重命名 / 层级 / 同义词字典（PRD §8：禁 Tag 层级树）；
- 孤 tag 不提供直接合并动作（无明确目标，§1 Q3）；
- 不动 filter-cabin 岛屿与 app.css（提示条样式内联，IM-14 预算观察项零增量）；
- P1-10 命名视图另案（`docs/saved-views-review.md`，涉及新表须用户裁决）。

---
*产出：W7-9-1 会话 · 2026-11-14 · 行数/索引以当日 wc -l 与 db/migrations/0001_init.sql 复核为准*
