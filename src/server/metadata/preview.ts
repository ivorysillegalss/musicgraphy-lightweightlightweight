// 预览域（S2-15/18/19/27 · 评审案 docs/design-refs-review.md Q12/Q13）：
// iTunes song 实体 30s previewUrl 解析（复用 ITunesSource 既有队列 + 20/min 门，零新限流通道）
// + 进程内缓存（null = 已解析无预览，防重复打上游）+ single-flight + 同源流式代理（串行一路）。
// 隐私：仅显式触发（<audio preload=none> / 按键），解析失败诚实 404 不伪造。
import { ITunesSource, type SourceChain } from './sources';

let USER_AGENT = 'Musicgraphy/2.0 (+https://github.com/ivorysillegalss/musicgraphy-lightweightlightweight)';
let FETCHFN: typeof fetch = fetch;

/** app.ts createApp 时注入（UA 纪律 + 测试 fetchFn seam；缺省仅限本机开发） */
export function initPreview(opts: { userAgent?: string; fetchFn?: typeof fetch }): void {
  if (opts.userAgent !== undefined && opts.userAgent !== '') USER_AGENT = opts.userAgent;
  if (opts.fetchFn !== undefined) FETCHFN = opts.fetchFn;
}

/** 进程内解析缓存：url | null（null = 已解析但无预览——每次档案库查询不再重复打上游） */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/** 测试与未来管理通道：直接落缓存（绕过解析） */
export function primePreview(recordId: string, url: string | null): void {
  cache.set(recordId, url);
}

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * 解析某记录的 30s 预览（S2-24 同族 fail-soft）：iTunes song 实体直查（零落库副作用——
 * 不走 chain.search/searchAlbums，那会把候选写进 album_metadata）；严格档 = 专辑名+艺术家名
 * 全等，宽松档 = 仅专辑名全等；全 miss → null（路由诚实 404）。
 */
export async function resolveAlbumPreview(chain: SourceChain, recordId: string, title: string, artist: string): Promise<string | null> {
  const cached = cache.get(recordId);
  if (cached !== undefined) return cached;
  const running = inflight.get(recordId);
  if (running !== undefined) return running;
  const task = (async (): Promise<string | null> => {
    const src = chain.byName('itunes');
    if (!(src instanceof ITunesSource)) {
      cache.set(recordId, null);
      return null; // 链上无 iTunes 源（未配置）= 诚实无预览
    }
    const hits = await src.searchSongPreview(`${artist} ${title}`, 12).catch(() => []);
    const t = norm(title);
    const a = norm(artist);
    const strict = hits.find((h) => norm(h.collectionName) === t && norm(h.artistName) === a);
    const relaxed = hits.find((h) => norm(h.collectionName) === t);
    const url = (strict ?? relaxed)?.previewUrl ?? null;
    cache.set(recordId, url);
    return url;
  })();
  inflight.set(recordId, task);
  try {
    return await task;
  } finally {
    inflight.delete(recordId);
  }
}

export interface PreviewStream {
  body: ReadableStream<Uint8Array>;
  contentType: string;
}

// 同源拉流串行信号量（Q13：媒体 CDN GET 不占元数据 API 窗口；内存纪律②「同一时刻一路」）
let tail: Promise<unknown> = Promise.resolve();

/** 流式拉取预览（12s 超时 + 显式 UA；直通不落盘——封面管线「流式禁整读」同款） */
export function streamPreview(url: string): Promise<PreviewStream> {
  const run = tail.then(async () => {
    const res = await FETCHFN(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok || res.body === null) throw new Error(`preview upstream ${String(res.status)}`);
    return { body: res.body as ReadableStream<Uint8Array>, contentType: res.headers.get('content-type') ?? 'audio/mp4' };
  });
  tail = run.catch(() => undefined);
  return run;
}
