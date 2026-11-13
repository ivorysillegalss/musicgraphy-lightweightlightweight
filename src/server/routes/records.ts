// 集合域路由（Step 1，02 §4 v1.1 口径）：
// POST /records（201+Location；409 duplicate_record 转化提示）· GET/PATCH /records/:id
// GET /collection（cursor 分页，meta+links）· GET /collection/counts（轴排除式）· GET /echo/today（204 空态）
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { DAO } from '../db/dao';
import type { Filters } from '../db/sql';
import type { CollectionItem } from '../db/types';
import { errorBody } from '../http';

const SOURCES = new Set(['musicbrainz', 'deezer', 'itunes', 'discogs', 'user-provided']);

export interface RecordsRouteOptions {
  /** Step 2：落库成功后异步封面落盘（不阻塞响应；失败仅日志，F3） */
  onAlbumAdded?: (albumId: string, sourceId: string, coverUrl: string | null) => void;
}

const withCover = (it: CollectionItem): CollectionItem & { cover_src: string | null } => ({
  ...it,
  cover_src: it.album.cover_local !== null ? `/covers/${it.album.cover_local}` : it.album.cover_url
});

export function recordsRoutes(dao: DAO, opts: RecordsRouteOptions = {}): Hono {
  const app = new Hono();

  // FR-1 确认层落库：默认态=完成态，补充字段（tags/favorite/note/listened）全部可选、不阻塞
  app.post('/records', async (c) => {
    const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (b === null) return c.json(errorBody('invalid_body', '请求体须为 JSON'), 422);
    const source = typeof b['source'] === 'string' ? b['source'] : '';
    const sourceId = typeof b['source_id'] === 'string' ? b['source_id'].trim() : '';
    const title = typeof b['title'] === 'string' ? b['title'].trim() : '';
    const artist = typeof b['artist'] === 'string' ? b['artist'].trim() : '';
    const fields: Record<string, string> = {};
    if (!SOURCES.has(source)) fields['source'] = '必须是 musicbrainz/deezer/itunes/discogs/user-provided';
    if (sourceId === '') fields['source_id'] = '必填';
    // 新专辑快照必带 title/artist（F1：源失效仍可显示，02 §5.1）
    if (sourceId !== '' && !dao.existingSourceIds(source, [sourceId]).has(sourceId) && (title === '' || artist === '')) {
      fields['title'] = fields['artist'] = '新专辑快照必填';
    }
    if (Object.keys(fields).length > 0) return c.json(errorBody('validation_failed', '字段校验失败', { fields }), 422);

    const { id: albumId } = dao.upsertAlbum({
      source,
      source_id: sourceId,
      title,
      artist,
      release_year: typeof b['release_year'] === 'number' ? Math.trunc(b['release_year']) : null,
      cover_url: typeof b['cover_url'] === 'string' && b['cover_url'] !== '' ? b['cover_url'] : null,
      country: typeof b['country'] === 'string' && b['country'] !== '' ? b['country'] : null,
      genres: Array.isArray(b['genres']) ? b['genres'].filter((g): g is string => typeof g === 'string') : []
    });
    const lp: unknown = b['listened_precision'];
    const { id } = dao.createRecord({
      album_id: albumId,
      note: typeof b['note'] === 'string' ? b['note'] : null,
      listened_at: typeof b['listened_at'] === 'string' ? b['listened_at'] : null,
      listened_precision: lp === 'day' || lp === 'year' ? lp : null
    });
    if (Array.isArray(b['tags'])) dao.setTags(id, b['tags'].filter((t): t is string => typeof t === 'string'));
    if (b['is_favorite'] === true) dao.updateRecord(id, { is_favorite: true });
    opts.onAlbumAdded?.(albumId, sourceId, typeof b['cover_url'] === 'string' && b['cover_url'] !== '' ? b['cover_url'] : null);

    c.header('Location', `/api/v1/records/${id}`);
    return c.json({ data: { id, album_id: albumId, in_collection: true } }, 201);
  });

  app.get('/records/:id', (c) => c.json({ data: withCover(dao.getRecord(c.req.param('id'))) }));

  // P1-5 联想：同期/同天/同 Tag（实现见 db/associations.ts，评审案 docs/associations-review.md）；
  // 锚不存在 → NotFoundError 经 onError 转 404 record_not_found；空联想 = 200 {data:[]}（页面侧不渲染）
  app.get('/records/:id/associations', (c) => {
    const items = dao.getAssociations(c.req.param('id'), clampLimit(c.req.query('limit')));
    return c.json({ data: items.map(withCover) });
  });

  app.patch('/records/:id', async (c) => {
    const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (b === null) return c.json(errorBody('invalid_body', '请求体须为 JSON'), 422);
    const patch: Parameters<typeof dao.updateRecord>[1] = {};
    const fields: Record<string, string> = {};
    if ('note' in b) patch.note = b['note'] === null ? null : String(b['note']);
    if ('listened_at' in b) patch.listened_at = b['listened_at'] === null ? null : String(b['listened_at']);
    if ('listened_precision' in b) {
      const lp = b['listened_precision'];
      if (lp !== null && lp !== 'day' && lp !== 'year') fields['listened_precision'] = "必须是 'day' | 'year' | null";
      else patch.listened_precision = lp as 'day' | 'year' | null;
    }
    if ('cover_color' in b) {
      const cc = b['cover_color'];
      if (cc !== null && (typeof cc !== 'number' || !Number.isInteger(cc) || cc < 1 || cc > 16)) fields['cover_color'] = '必须是 1–16 或 null';
      else patch.cover_color = cc as number | null;
    }
    if ('is_favorite' in b) {
      if (typeof b['is_favorite'] !== 'boolean') fields['is_favorite'] = '必须是 boolean';
      else patch.is_favorite = b['is_favorite'];
    }
    if (Object.keys(fields).length > 0) return c.json(errorBody('validation_failed', '字段校验失败', { fields }), 422);
    const { id } = dao.updateRecord(c.req.param('id'), patch);
    if (Array.isArray(b['tags'])) dao.setTags(id, b['tags'].filter((t): t is string => typeof t === 'string'));
    return c.json({ data: { id } });
  });

  app.get('/collection', (c) => {
    const page = dao.listPage({
      filters: parseFilters(c),
      sort: c.req.query('sort') ?? 'added',
      cursor: c.req.query('cursor') || null,
      limit: clampLimit(c.req.query('limit'))
    });
    const next = new URL(c.req.url);
    if (page.meta.next_cursor !== null) next.searchParams.set('cursor', page.meta.next_cursor);
    else next.searchParams.delete('cursor');
    return c.json({
      data: page.items.map(withCover),
      meta: page.meta,
      links: { next: page.meta.next_cursor === null ? null : `${next.pathname}${next.search}` }
    });
  });

  app.get('/collection/counts', (c) => c.json({ data: dao.countAxes('local', parseFilters(c)) }));

  // P1-1 回响：无则 204（非错误），有则卡片数据
  app.get('/echo/today', (c) => {
    const items = dao.echoToday('local', 20);
    return items.length === 0 ? c.body(null, 204) : c.json({ data: items.map(withCover) });
  });

  return app;
}

function clampLimit(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 60) : 60;
}

function parseFilters(c: Context): Filters {
  const f: Filters = {};
  const q = (k: string): string | undefined => {
    const v = c.req.query(k);
    return v === undefined || v === '' ? undefined : v;
  };
  const genre = q('genre');
  if (genre !== undefined) f.genre = genre;
  const tag = q('tag');
  if (tag !== undefined) f.tag = tag;
  const text = q('q');
  if (text !== undefined) f.q = text;
  const year = Number(c.req.query('year'));
  if (Number.isFinite(year) && year > 0) f.year = Math.trunc(year);
  const color = Number(c.req.query('color'));
  if (Number.isFinite(color) && color >= 1 && color <= 16) f.color = Math.trunc(color);
  const lf = q('listened_from');
  if (lf !== undefined) f.listenedFrom = lf;
  const lt = q('listened_to');
  if (lt !== undefined) f.listenedTo = lt;
  const fav = c.req.query('favorite');
  if (fav === '1' || fav === 'true') f.favorite = true;
  return f;
}
