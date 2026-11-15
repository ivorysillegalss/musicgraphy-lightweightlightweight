/**
 * pages 域路由 —— SSR 页面子应用（HTML 直出，无 hydration，ADR-003）。
 *
 * 端点：
 * - GET  /                        Collection 主页（回响→筛选舱→状态行→封面墙→外部候选）
 * - GET  /fragment/cabin          筛选舱片段（岛屿 filter-cabin swap 用）
 * - GET  /fragment/wall           封面墙片段（含状态行/空态/分页）
 * - GET  /fragment/search-suggest 搜索候选片段（你的档案 + 外部候选，双意图）
 * - GET  /fragment/tag-suggest    Tag 自动补全（FR-1 防同义分裂；JSON）
 * - GET  /add · POST /add         添加（无 JS 基线表单 + 弹层同通道；303 回网格）
 * - GET  /album/:id               详情双区（外部元数据 / 个人记录）
 * - POST /album/:id/favorite      Favorite 开关（无 JS 表单）→ 303 返回详情
 * - POST /album/:id/update        补线索（Tag/Note/听期——「先添加、稍后补」）
 * - POST /album/:id/relisten      又听了一次（P1-7：更新 listenedAt，永不产生第二条记录）
 *
 * 硬约束：
 * - URL 即状态（DD3）：筛选全在 query string；chips = <a>、搜索 = GET form、添加 = POST + 303；
 * - 页面 handler 内自捕获异常转 HTML 三态（漏抛会进 app.onError 变 JSON envelope）；
 * - 回响/联想是"馈赠"：失败静默降级为不渲染（P1-1 四约束）；
 * - 列表分页 LIMIT 60 + cursor（ADR-005 内存纪律①）；封面流式（禁 base64/整读）；
 * - POST 一律 sameOrigin 校验（V10 CSRF；鉴权由 installAuth 的 use('/*') 页面守卫承担，D1 修复 2026-11-15）。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { DAO } from '../db/dao';
import { DuplicateRecordError, NotFoundError } from '../db/dao';
import { nowIso } from '../db/sql';
import type { AssociationItem } from '../db/associations';
import type { CollectionItem, MetricsCoverage } from '../db/types';
import { errorStrip } from '../html';
import { LocalRateLimitError } from '../metadata/queue';
import { UpstreamError } from '../metadata/musicbrainz';
import { searchAlbums, type AlbumSearchItem } from '../metadata/search';
import type { SourceChain } from '../metadata/sources';
import { sameOrigin } from '../auth';
import type { RecordsRouteOptions } from './records';
import { buildHref, cabinSection, parseFilter, queryJsonToFilter, renderCollection, resultsSection, toDaoFilters, type AxisCounts, type FilterState } from '../pages/collection';
import { renderAlbumDetail, renderAlbumError, renderAlbumNotFound } from '../pages/album';
import { renderAddPage } from '../pages/add';
import { renderMetrics } from '../pages/metrics';
import { renderTopsterDetail, renderTopsterList, renderTopsterPoster } from '../pages/topster';
import { buildTopsterSvg } from '../pages/topster-svg';
import * as topster from '../db/topster';
import { searchSuggestFragment } from '../pages/suggest';

const PAGE_LIMIT = 60; // ADR-005 内存纪律①：列表强制 LIMIT 60
const ADDABLE_SOURCES = new Set(['musicbrainz', 'deezer', 'itunes', 'discogs', 'user-provided']);

export function pagesRoutes(dao: DAO, chain: SourceChain, opts: RecordsRouteOptions = {}): Hono {
  const app = new Hono();

  // —— 数据装配助手（handler 内自捕获 → HTML 三态；馈赠区静默）——

  const searchParams = (c: Context): URLSearchParams => new URLSearchParams(c.req.url.slice(c.req.url.indexOf('?') + 1));

  const safeEcho = (): CollectionItem | null => {
    try {
      return dao.echoToday('local', 1)[0] ?? null;
    } catch {
      return null; // 回响是馈赠：失败静默不渲染（P1-1）
    }
  };

  // P1-5 联想是馈赠：失败静默降级为不渲染（同上 P1-1 四约束；B1 接线披露件，评审案 docs/associations-review.md §6）
  const safeAssociations = (id: string): AssociationItem[] | undefined => {
    try {
      return dao.getAssociations(id, 18);
    } catch {
      return undefined;
    }
  };

  // P1-6 Tag 治理候选是馈赠：失败静默降级为不渲染（评审案 docs/tag-governance-review.md §4）
  const safeTagGov = (): ReturnType<DAO['tagCandidates']> | null => {
    try {
      return dao.tagCandidates();
    } catch {
      return null;
    }
  };

  // P1-10 命名视图是馈赠：失败静默降级为不渲染（评审案 docs/saved-views-review.md；用户 2026-11-14 批准实现）
  const safeSavedViews = (): ReturnType<DAO['listSavedViews']> | null => {
    try {
      return dao.listSavedViews();
    } catch {
      return null;
    }
  };

  // P1-6 季度级不打扰：当季已 dismiss/已处理（cookie）→ 提示不渲染（PRD 验收 ≤1 次/季度；无表零迁移）
  const TAG_HINT_COOKIE = 'mg_tag_hint';
  const QUARTER_MAX_AGE = 92 * 24 * 3600; // 季度级（与 P1-6 治理提示 / metrics 关闭开关同节律）
  const quarterStamp = (): string => {
    const now = new Date();
    return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  };

  const safeTopTags = (): string[] => {
    try {
      return (dao.countAxes('local', {}, ['tag']).tag ?? []).filter((x) => x.value !== null && x.count > 0).slice(0, 8).map((x) => String(x.value));
    } catch {
      return [];
    }
  };

  /**
   * 结果总数（FR-2「还剩 N 张」）：listPage 不回 total（DAO 契约不改），用 countAxes 的
   * 单轴分组求和——取一个**未被筛选**的轴（排除会漏行的 genre/tag 轴）即为过滤集全量。
   * 全部可用轴都被激活时（极端）降级为 null → 状态行显示本页张数。
   */
  const countTotal = (f: FilterState, filters: ReturnType<typeof toDaoFilters>): number | null => {
    const candidates: Array<{ axis: 'year' | 'listened' | 'favorite' | 'color'; active: boolean }> = [
      { axis: 'favorite', active: f.fav },
      { axis: 'color', active: f.color !== null },
      { axis: 'listened', active: f.period !== null },
      { axis: 'year', active: f.year !== null }
    ];
    const axis = candidates.find((x) => !x.active)?.axis;
    if (axis === undefined) return null;
    try {
      const facets = dao.countAxes('local', filters, [axis])[axis] ?? [];
      return facets.reduce((sum, x) => sum + x.count, 0);
    } catch {
      return null;
    }
  };

  const noticeOf = (err: unknown): string =>
    err instanceof LocalRateLimitError
      ? '搜索过于频繁，请稍后再试。'
      : err instanceof UpstreamError
        ? '元数据上游暂不可用，请稍后重试。'
        : '搜索失败，请重试。';

  const safeCandidates = async (q: string): Promise<{ candidates: AlbumSearchItem[] | null; notice: string | null }> => {
    if (q.length < 2) return { candidates: null, notice: null };
    try {
      return { candidates: await searchAlbums(dao, chain, q, 12), notice: null };
    } catch (err) {
      return { candidates: null, notice: noticeOf(err) };
    }
  };

  // ---------------------------------------------------------------- GET /（Collection 主页）

  app.get('/', async (c) => {
    const p = searchParams(c);
    // P1-10 恢复（评审案 Q6）：/?view=<name> → 读 query_json → 303 展开成筛选参数 URL（URL 即状态不被破坏，可分享可回退）；
    // 视图不存在 / query_json 损坏 → 静默回正常渲染（馈赠语义，不阻塞找回主路径）
    const viewName = p.get('view');
    if (viewName !== null && viewName !== '') {
      try {
        const v = dao.getViewByName(viewName);
        if (v !== undefined) {
          const f = queryJsonToFilter(v.query_json);
          if (f !== null) return c.redirect(buildHref(f), 303);
        }
      } catch {
        /* 静默 */
      }
    }
    const filter = parseFilter(p);
    const filters = toDaoFilters(filter);
    const rawFlash = p.get('flash');
    const flash = rawFlash === 'added' || rawFlash === 'merged' || rawFlash === 'duplicate' || rawFlash === 'error' ? rawFlash : null;
    const q = filter.q ?? '';

    let items: ReturnType<DAO['listPage']>['items'] = [];
    let meta: { has_next: boolean; next_cursor: string | null } = { has_next: false, next_cursor: null };
    let counts: AxisCounts | null = null;
    let total: number | null = null;
    let error: string | null = null;
    try {
      const page = dao.listPage({ filters, cursor: p.get('cursor'), limit: PAGE_LIMIT });
      items = page.items;
      meta = page.meta;
      counts = dao.countAxes('local', filters);
      total = countTotal(filter, filters);
    } catch {
      error = '筛选查询失败——档案服务没有回应。'; // 舱壳保留（结构可评审），数据区进 error 三态
    }

    // P1-6：当季已处理（cookie 值 = 当季戳）→ 提示不渲染（≤1 次/季度）
    const tagHint = getCookie(c, TAG_HINT_COOKIE) === quarterStamp() ? null : safeTagGov();
    const savedViews = safeSavedViews();
    const { candidates, notice } = await safeCandidates(q);
    return c.html(
      renderCollection(
        { flash, dupHref: null, echo: safeEcho(), tagHint, savedViews, filter, counts, items, meta, total, candidates, notice, topTags: safeTopTags(), error },
        { title: q === '' ? 'Musicgraphy · Collection' : `Musicgraphy · 「${q}」的检索` }
      )
    );
  });

  // ---------------------------------------------------------------- 片段端点（岛屿 fetch swap；no-JS 不依赖；失败 503 = 岛屿注入错误态的信号）

  app.get('/fragment/cabin', (c) => {
    const filter = parseFilter(searchParams(c));
    try {
      const counts = dao.countAxes('local', toDaoFilters(filter));
      return c.html(cabinSection(filter, counts));
    } catch {
      return c.html(cabinSection(filter, null), 503);
    }
  });

  app.get('/fragment/wall', (c) => {
    const p = searchParams(c);
    const filter = parseFilter(p);
    try {
      const page = dao.listPage({ filters: toDaoFilters(filter), cursor: p.get('cursor'), limit: PAGE_LIMIT });
      const total = countTotal(filter, toDaoFilters(filter));
      return c.html(resultsSection(page.items, filter, page.meta, total ?? page.items.length));
    } catch {
      return c.html(errorStrip('筛选查询失败——档案服务没有回应。', buildHref(filter)), 503);
    }
  });

  app.get('/fragment/search-suggest', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    return c.html(await searchSuggestFragment(dao, chain, q));
  });

  app.get('/fragment/tag-suggest', (c) => {
    const q = (c.req.query('q') ?? '').trim();
    try {
      return c.json({ data: dao.suggestTags('local', q, 8) });
    } catch {
      return c.json({ data: [] }); // 补全失败静默（本地输入不受阻）
    }
  });

  // ---------------------------------------------------------------- 添加（无 JS 基线：表单 → 303；增强层 = add-dialog 岛屿，同一落库路径）

  app.get('/add', (c) => {
    const flash = c.req.query('flash') === 'error' ? 'error' : null;
    return c.html(renderAddPage(flash, { title: 'Musicgraphy · 记录一张专辑' }));
  });

  app.post('/add', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const str = (k: string): string => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
    const title = str('title');
    const artist = str('artist');
    const rawSource = str('source');
    let source = ADDABLE_SOURCES.has(rawSource) ? rawSource : 'musicbrainz';
    let sourceId = str('source_id');
    if (sourceId === '') {
      // 手工录入（无外部 ID）：确定性伪 ID 保去重语义（同 title+artist 不产生第二张专辑）
      if (title === '' || artist === '') return c.redirect('/add?flash=error', 303);
      source = 'user-provided';
      sourceId = `manual:${title.toLowerCase()}|${artist.toLowerCase()}`;
    } else if (title === '' || artist === '') {
      return c.redirect('/add?flash=error', 303); // 新专辑快照必带 title/artist（F1：源失效仍可显示）
    }
    const year = Number(str('release_year'));
    const coverUrl = str('cover_url') || null;
    const { id: albumId } = dao.upsertAlbum({
      source,
      source_id: sourceId,
      title,
      artist,
      release_year: Number.isFinite(year) && year > 0 ? Math.trunc(year) : null,
      cover_url: coverUrl
    });
    let recordId: string;
    try {
      const ly = str('listened_year');
      recordId = dao.createRecord({
        album_id: albumId,
        note: str('note') || null,
        listened_at: /^\d{4}$/.test(ly) ? `${ly}-01-01T00:00:00Z` : null,
        listened_precision: /^\d{4}$/.test(ly) ? 'year' : null
      }).id;
    } catch (err) {
      if (err instanceof DuplicateRecordError) {
        // C-DUP 双出口（D2）：去补线索 / 又听了一次——永不产生第二条记录
        return c.redirect(`/album/${err.recordId}?flash=duplicate`, 303);
      }
      return c.redirect('/add?flash=error', 303); // 失败不阻塞：回表单，数据未受影响
    }
    const tags = str('tags').split(/[,，]/).map((t) => t.trim()).filter((t) => t !== '');
    if (tags.length > 0) {
      try {
        dao.setTags(recordId, tags);
      } catch {
        /* Tag 挂载失败不阻塞添加（记录已落库；详情页可重试） */
      }
    }
    if (str('favorite') === '1') {
      try {
        dao.updateRecord(recordId, { is_favorite: true });
      } catch {
        /* 同上 */
      }
    }
    opts.onAlbumAdded?.(albumId, sourceId, coverUrl);
    return c.redirect('/?flash=added', 303); // 303 回网格（ADR-003 V4；I3 单 INSERT 即完成态）
  });

  // ---------------------------------------------------------------- 详情（双区：外部元数据 × 个人记录）

  app.get('/album/:id', (c) => {
    const id = c.req.param('id');
    const flash = c.req.query('flash') === 'duplicate' ? 'duplicate' : null;
    try {
      const detail = dao.getRecord(id);
      return c.html(renderAlbumDetail(detail, flash, { title: `Musicgraphy · ${detail.album.title}` }, safeAssociations(id)), 200);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.html(renderAlbumNotFound(id, { title: 'Musicgraphy · 未找到' }), 404);
      }
      return c.html(renderAlbumError({ title: 'Musicgraphy · 详情' }));
    }
  });

  // ---------------------------------------------------------------- 详情动作（无 JS 表单；303 返回详情；失败静默——数据未受影响）

  app.post('/album/:id/favorite', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const id = c.req.param('id');
    try {
      const cur = dao.getRecord(id);
      dao.updateRecord(id, { is_favorite: !cur.is_favorite });
    } catch {
      /* 静默回详情 */
    }
    return c.redirect(`/album/${id}`, 303);
  });

  app.post('/album/:id/update', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const id = c.req.param('id');
    try {
      const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
      const str = (k: string): string => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
      const patch: Parameters<DAO['updateRecord']>[1] = { note: str('note') || null };
      const ly = str('listened_year');
      if (/^\d{4}$/.test(ly)) {
        patch.listened_at = `${ly}-01-01T00:00:00Z`;
        patch.listened_precision = 'year';
      }
      dao.updateRecord(id, patch);
      const tags = str('tags').split(/[,，]/).map((t) => t.trim()).filter((t) => t !== '');
      if (tags.length > 0) dao.setTags(id, tags);
    } catch {
      /* 失败静默：回详情（提示交由三态原则——记录本体未受影响） */
    }
    return c.redirect(`/album/${id}`, 303);
  });

  app.post('/album/:id/relisten', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const id = c.req.param('id');
    try {
      dao.updateRecord(id, { listened_at: nowIso(), listened_precision: 'day' }); // P1-7：显式动作更新 listenedAt（D1）
    } catch {
      /* 静默回详情 */
    }
    return c.redirect(`/album/${id}`, 303);
  });

  // ---------------------------------------------------------------- Tag 轻治理动作（P1-6，评审案 docs/tag-governance-review.md §1 Q4/Q6；无 JS 表单 + 303）

  app.post('/tags/merge', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const source = typeof b['source'] === 'string' ? b['source'] : '';
    const target = typeof b['target'] === 'string' ? b['target'] : '';
    try {
      const { deleted } = dao.mergeTags(source, target);
      if (deleted) {
        // 本季度已处理 → 提示不再打扰（合并成功也算处理完成，Q4）
        setCookie(c, TAG_HINT_COOKIE, quarterStamp(), { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: QUARTER_MAX_AGE });
        return c.redirect('/?flash=merged', 303); // 旧 tag 消失、引用保留（moved=0 且全去重也算合并完成——评审案 §1 Q5 补记）
      }
      // 未发生合并（同名/缺目标等无操作）→ 静默回主页
    } catch {
      /* 失败静默回主页（提示条仍在，可重试；记录本体不受影响） */
    }
    return c.redirect('/', 303);
  });

  app.post('/tags/hint-dismiss', (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    setCookie(c, TAG_HINT_COOKIE, quarterStamp(), { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: QUARTER_MAX_AGE }); // 季度翻滚自然重开
    return c.redirect('/', 303);
  });

  // ---------------------------------------------------------------- 命名视图动作（P1-10，评审案 Q6/Q7；无 JS 表单 + 303；只存查询状态）

  app.post('/views', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
    const queryJson = typeof b['query_json'] === 'string' ? b['query_json'] : '';
    if (name !== '' && queryJson !== '' && queryJsonToFilter(queryJson) !== null) {
      try {
        dao.createSavedView(name, queryJson); // 重名（UNIQUE user_id+name）→ 静默回主页（视图列表原样可见）
      } catch {
        /* 重名/失败静默 */
      }
    }
    return c.redirect('/', 303);
  });

  app.post('/views/delete', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const viewId = typeof b['view_id'] === 'string' ? b['view_id'] : '';
    if (viewId !== '') {
      try {
        dao.deleteSavedView(viewId);
      } catch {
        /* 不存在/失败静默（删除请求幂等） */
      }
    }
    return c.redirect('/', 303);
  });

  // ---------------------------------------------------------------- Topster 策展页（W10-12-1 W10 批；评审案 docs/topster-review.md Q5/Q7，
  // 用户 2026-11-14 AskUserQuestion 批准实现。Topster = Collection 的一种 View：成员实时取自 collection_record，
  // item_order 只存引用（禁第二套数据）；策展仅限顺序+副标题（禁自由画布）。无 JS 基线：POST 全部 303；
  // 校验失败 → 303 ?flash=error（数据不变，页面红条如实反馈——views 页面通道静默先例 + flashBanner 语义）

  app.get('/topsters', (c) => {
    let topsters: topster.TopsterMeta[] | null = null;
    try {
      topsters = dao.listTopsters();
    } catch {
      topsters = null;
    }
    const flash = searchParams(c).get('flash') === 'error' ? 'error' : null;
    return c.html(renderTopsterList({ topsters, flash }, { title: 'Musicgraphy · Topster 策展' }));
  });

  app.post('/topsters', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const title = typeof b['title'] === 'string' ? b['title'].trim() : '';
    const subtitle = typeof b['subtitle'] === 'string' && b['subtitle'].trim() !== '' ? b['subtitle'].trim() : null;
    if (title === '' || title.length > topster.TITLE_MAX || (subtitle !== null && subtitle.length > topster.SUBTITLE_MAX)) {
      return c.redirect('/topsters?flash=error', 303); // 空标题由 HTML required 前置挡，此处服务端兜底（数据不变）
    }
    const { id } = dao.createTopster(title, subtitle);
    return c.redirect(`/topsters/${id}`, 303);
  });

  app.get('/topsters/:id', (c) => {
    const id = c.req.param('id');
    const t = dao.getTopster(id);
    if (t === undefined) return c.html(renderAlbumNotFound(id, { title: 'Musicgraphy · 策展不存在' }), 404); // 404 语义同 /album/:id 先例
    const p = searchParams(c);
    const ids = topster.parseItemOrder(t.item_order) ?? [];
    let items: CollectionItem[] = [];
    let missing = 0;
    let addCandidates: CollectionItem[] = [];
    let addNotice: string | null = null;
    try {
      const loaded = dao.topsterItems(ids);
      items = loaded.items;
      missing = loaded.missing;
    } catch {
      items = [];
    }
    const addQ = (p.get('add_q') ?? '').trim();
    if (addQ.length >= 1) {
      try {
        addCandidates = dao.memberCandidates(id, addQ);
        if (addCandidates.length === 0) addNotice = `档案中没有匹配「${addQ}」且未加入本策展的记录。`;
      } catch {
        addCandidates = [];
      }
    }
    const flash = p.get('flash') === 'error' ? 'error' : null;
    return c.html(renderTopsterDetail({ t, items, missing, addCandidates, addNotice, flash }, { title: `Musicgraphy · ${t.title}` }));
  });

  // W11 批导出（评审案 §3 案 A，用户批准 A+C 组合）：SVG 纯文本零依赖（零新包 G1、禁 base64——封面 URL 引用）；
  // 署名 "made with Musicgraphy" 内嵌 = 04B 引擎一。诚实边界已披露：主流平台不收 SVG 上传 → 案 C 海报页补位。
  app.get('/topsters/:id/export.svg', (c) => {
    const t = dao.getTopster(c.req.param('id'));
    if (t === undefined) return c.html(renderAlbumNotFound(c.req.param('id'), { title: 'Musicgraphy · 策展不存在' }), 404);
    const ids = topster.parseItemOrder(t.item_order) ?? [];
    let items: CollectionItem[] = [];
    try {
      items = dao.topsterItems(ids).items; // 失效引用按实际在场成员导出（missing 不进图）
    } catch {
      items = [];
    }
    const origin = new URL(c.req.url).origin; // 本地缓存封面拼绝对地址（脱离服务器后按部署地址加载）
    return c.body(buildTopsterSvg(t, items, origin), 200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="topster-${t.id.slice(0, 8)}.svg"` // 导出语义（W10 评审案 Q5）
    });
  });

  // W11 批案 C：海报页——cover-first 大网格 + 署名，无编辑区，用户截图/系统打印即成图（零依赖零红线冲突）
  app.get('/topsters/:id/poster', (c) => {
    const t = dao.getTopster(c.req.param('id'));
    if (t === undefined) return c.html(renderAlbumNotFound(c.req.param('id'), { title: 'Musicgraphy · 策展不存在' }), 404);
    const ids = topster.parseItemOrder(t.item_order) ?? [];
    let items: CollectionItem[] = [];
    try {
      items = dao.topsterItems(ids).items;
    } catch {
      items = [];
    }
    return c.html(renderTopsterPoster({ t, items }, { title: `Musicgraphy · ${t.title}` }));
  });

  app.post('/topsters/:id/update', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const title = typeof b['title'] === 'string' ? b['title'].trim() : '';
    const subtitle = typeof b['subtitle'] === 'string' && b['subtitle'].trim() !== '' ? b['subtitle'].trim() : null;
    if (title === '' || title.length > topster.TITLE_MAX || (subtitle !== null && subtitle.length > topster.SUBTITLE_MAX)) {
      return c.redirect(`/topsters/${c.req.param('id')}?flash=error`, 303);
    }
    try {
      dao.updateTopsterMeta(c.req.param('id'), title, subtitle); // 不存在 → NotFoundError 捕获静默（幂等语义）
    } catch {
      /* 静默 */
    }
    return c.redirect(`/topsters/${c.req.param('id')}`, 303);
  });

  app.post('/topsters/:id/members', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const recordId = typeof b['record_id'] === 'string' ? b['record_id'] : '';
    const op = recordId === '' ? 'no_change' : dao.addTopsterMember(c.req.param('id'), recordId);
    // added 以外（full/duplicate/invalid_record/not_found）→ 数据不变 + 诚实红条；不静默伪造成功
    return c.redirect(`/topsters/${c.req.param('id')}${op === 'added' ? '' : '?flash=error'}`, 303);
  });

  app.post('/topsters/:id/move', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const recordId = typeof b['record_id'] === 'string' ? b['record_id'] : '';
    const dir = b['dir'] === 'down' ? 'down' : 'up';
    if (recordId !== '') dao.moveTopsterMember(c.req.param('id'), recordId, dir); // 越界/不在列 → no_change（幂等 303）
    return c.redirect(`/topsters/${c.req.param('id')}`, 303);
  });

  app.post('/topsters/:id/remove', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const recordId = typeof b['record_id'] === 'string' ? b['record_id'] : '';
    if (recordId !== '') dao.removeTopsterMember(c.req.param('id'), recordId); // 不在列 → no_change（幂等 303）
    return c.redirect(`/topsters/${c.req.param('id')}`, 303);
  });

  app.post('/topsters/delete', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const topsterId = typeof b['topster_id'] === 'string' ? b['topster_id'] : '';
    if (topsterId !== '') {
      try {
        dao.deleteTopster(topsterId);
      } catch {
        /* 不存在/失败静默（删除请求幂等，/views/delete 先例） */
      }
    }
    return c.redirect('/topsters', 303);
  });

  // ---------------------------------------------------------------- 观察池仪表页（W8：PRD §6 · 04B §3 自托管匿名计数、可关闭）

  // 「可关闭」= 呈现级开关（cookie，无表无 JS）：关闭仅隐藏数字呈现，数据本身全部本地派生无外发
  const METRICS_COOKIE = 'mg_metrics';

  app.get('/metrics', (c) => {
    const closed = getCookie(c, METRICS_COOKIE) === 'closed';
    let data: MetricsCoverage | null = null;
    try {
      data = dao.metricsCoverage(); // B3 域（02 §4 {data} 口径）；失败 → 页面 error 三态
    } catch {
      data = null;
    }
    return c.html(renderMetrics({ data, closed }, { title: 'Musicgraphy · 观察池仪表' }));
  });

  app.post('/metrics/toggle', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site request rejected', 403);
    const b = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    if (b['action'] === 'close') {
      setCookie(c, METRICS_COOKIE, 'closed', { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: QUARTER_MAX_AGE });
    } else {
      deleteCookie(c, METRICS_COOKIE, { path: '/' });
    }
    return c.redirect('/metrics', 303);
  });

  return app;
}
