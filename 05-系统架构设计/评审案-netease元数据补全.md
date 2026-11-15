# 评审案 · netease 导入元数据补全（发行年份 / Genre / 国家）· R-110

> 依据：用户 2026-11-15 指令「新增一个需求到看板中并且进行调研 当前这种导入的数据 的发行年份和genre 国家等信息为空
> 这个评审下怎么办 我理解只能进行搜索后回填」。看板卡 = BACKEND 线 **B10**；实现 = 主线 **b180dd7**（check 231/231，回归 +2）。
> 性质 = **B7 按需权威化路线（IM-23 Q1 路线 B / IM-26）的 genres 扩展 + 执行收口**——用户判断「只能搜索后回填」正确，
> 且回填机器已造好一半。

## 0. 现状量化（2026-11-15 实测）

- netease 行 **170 张**：release_year / genres / country **三字段全空 ×170**——`/album/sublist` 接口
  不带 publishTime / genre / 国家字段（shape dump 定形在档 IM-31）。
- 11 张归并行（identity 撞 seed 行）不受影响——已有 seed 元数据。
- 触发页：`/album/292fd96d-…`（用户实机目检详情页元数据区空缺）。

## Q1 路线：搜索后回填 ✓（且机器已造好一半）

| 选项 | 内容 | 判定 |
|---|---|---|
| A | **MB 按需权威化复用（B7）**：year = MB date、country = MB——mb-calibrate 合并逻辑在档（IM-26），只差跑 | ✅ 采纳 |
| B | **genres 扩展**：MB lookup `inc=genres`（release 级 → 空追 release-group 级，同 MBID 零新增搜索） | ✅ 采纳（本评审新增实现） |
| C | iTunes primaryGenreName 兜底 | ❌ 否决：商店分类学粗糙 + 20/min 更慢 + 粒度不如 MB 社区 genre |

- 每张 2~3 次调用（search + lookup ± rg）@30/min → 170 张 ≈ **12~17 分钟**，按需触发。

## Q2 genres 写入语义

- **只补空**（行现值优先 = IM-12 保守更新语义；netease 行 genres 全空 → 填充不动任何既有值）。
- **归一**：既有 chips casefold 查重沿用写法（防 rock/Rock 碎片）→ 未命中首字母大写 → 去重 + **cap 6**（按 MB 票数降序）。
- 词汇表 = 全库 `genres IS NOT NULL` 行 JSON 解析（lower → canonical 首现写法），CLI 启动建表一次。

## Q3 失败 / 未命中（fail-soft 延续）

- resolve 未命中 → netease 行保留不动（B7 同款）；
- genre lookup 失败 → **year/country 照常合并**，genres 留空次轮重试（幂等续跑，不整行连坐）。

## Q4 执行口径

- dry-run 命中率预演 → 全量 170 正式回填；与运行中 dev server 并存（WAL + busy_timeout，B5 同纪律）；
  dry-run 不含 genre 预演（节流）。

## Q5 观察指标

- summary.`genresFilled` / missed / failed 如实进看板 B10 evidence；未命中行留 missedKeys 供 MB 手查。

## Q6 503 退避（dry-run 实测教训 · 1da3363 补记）

- dry-run 实测：170 张中**前 16 张 resolve 全命中（质量无虞），此后 152 张级联 503**「MusicBrainz 拒绝（超速）」
  ——CLI 原忽略 Retry-After 直接跳行 → 下一张 1.05s 后再撞墙 → 级联失败。
- 修复：calibrateRows 捕获 `UpstreamError(status=503)` → **退避 min(Retry-After ?? 60, 120)s 后原行重试一发**，
  二次 503 才计 failed 移动；非上游错误照旧直判；`opts.sleepFn` 注入供测试快进。
- 回归测试 +1（两次 503 各退避 Retry-After=45s → 甲行重试成功合并 / 乙行二次才 failed 零写入）。

## 依赖三问

- 零新包（node:sqlite / fetch 全既有）；乙-4 限流（MB 30/min 全程遵守）；乙-8 无迁移；乙-7 无关。

## 实现落点（b180dd7）

- `musicbrainz.ts`：fetchJson 私有 helper（限流 + 503 透传 + 错误归一，searchReleases 同步重构复用）+
  `lookupReleaseGenres(mbid)`；
- `scripts/mb-calibrate.ts`：ResolveClient 扩展 + `normalizeGenres` + 只补空合并 + summary.genresFilled；
- `tests/mb-calibrate.smoke.test.ts`：回归 +2（归一全链路 / lookup 失败不阻塞），stub 补 lookup 缺省。
