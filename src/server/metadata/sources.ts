// 元数据多源降级链（02 §5.1：MusicBrainz 主源 → Deezer / iTunes（封面好）→ Discogs 冷门兜底）。
// 上游纪律（复审 V2）：全部源共享同一全局串行队列（相邻 ≥1s）+ 30/min 自我防线 + 显式 UA；
// iTunes 叠加单独 20/min 滑窗门（02 §4）。统一超时；任一源失败/空结果 → 降级下一源，
// 已有结果不受影响；全部失败才把主源错误抛给路由层（502/429 映射）。
import { logger } from '../logger';
import { UpstreamError, type AlbumCandidate } from './musicbrainz';
import { LocalRateLimitError } from './queue';

// 'netease'（IM-23）：仅导入域（metadata/netease.ts CLI 直建行），不在 SourceChain 搜索链上
export type MetadataSource = 'musicbrainz' | 'deezer' | 'itunes' | 'discogs' | 'user-provided' | 'netease';

/** 队列的结构化最小面（测试可注入桩；MetadataRateLimiter 天然满足） */
export interface RateLimiterLike {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/** 单个上游源的统一形态：链上按数组序 = 优先级；enabled=false 直接跳过 */
export interface AlbumSource {
  readonly name: MetadataSource;
  readonly enabled: boolean;
  search(q: string, limit: number): Promise<AlbumCandidate[]>;
}

/** iTunes 单独配额（02 §4：≈20 calls/min）：60s 滑窗，满 → LocalRateLimitError（调用方降级跳过） */
export class MinuteWindowGate {
  private stamps: number[] = [];
  constructor(
    private readonly maxPerMinute: number,
    private readonly nowFn: () => number = () => Date.now()
  ) {}

  take(): void {
    const t = this.nowFn();
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    const first = this.stamps[0];
    if (first !== undefined && this.stamps.length >= this.maxPerMinute) {
      throw new LocalRateLimitError(first + 60_000 - t);
    }
    this.stamps.push(t);
  }
}

/** 统一上游 GET：超时 + UA + Accept + 状态码 → UpstreamError（429/503 携带 Retry-After 透传） */
async function getJson(url: string, ua: string, timeoutMs: number, fetchFn: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: { 'User-Agent': ua, Accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    throw new UpstreamError(0, 'upstream_unreachable', `上游请求失败：${String(err)}`);
  }
  if (res.status === 429 || res.status === 503) {
    const ra = Number(res.headers.get('Retry-After') ?? '0') || null;
    throw new UpstreamError(res.status, 'upstream_rate_limited', `上游限流（HTTP ${res.status}）`, ra);
  }
  if (!res.ok) throw new UpstreamError(res.status, 'upstream_error', `上游 HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as unknown;
  if (body === null || typeof body !== 'object') throw new UpstreamError(res.status, 'upstream_error', '上游响应非 JSON');
  return body;
}

const yearOf = (date: unknown): number | null =>
  typeof date === 'string' && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;

const artistOf = (artist: unknown): string => {
  const name = typeof (artist as { name?: unknown })?.name === 'string' ? (artist as { name: string }).name.trim() : '';
  return name === '' ? 'Unknown Artist' : name;
};

// ---------------------------------------------------------------- 各源客户端

/** 主源适配：MusicBrainzClient 已内置队列/UA/超时（IM-10），这里只做形态统一 */
export class MusicBrainzSource implements AlbumSource {
  readonly name = 'musicbrainz' as const;
  readonly enabled = true;
  constructor(private client: { searchReleases(q: string, limit?: number): Promise<AlbumCandidate[]> }) {}
  search(q: string, limit: number): Promise<AlbumCandidate[]> {
    return this.client.searchReleases(q, limit);
  }
}

/** Deezer（免费·封面好）：search/album；cover_big 500px */
export class DeezerSource implements AlbumSource {
  readonly name = 'deezer' as const;
  constructor(
    private limiter: RateLimiterLike,
    private userAgent: string,
    private fetchFn: typeof fetch = fetch,
    private timeoutMs = 10_000
  ) {}
  get enabled(): boolean {
    return true;
  }
  async search(q: string, limit: number): Promise<AlbumCandidate[]> {
    const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=${limit}`;
    return this.limiter.run(async () => {
      const body = (await getJson(url, this.userAgent, this.timeoutMs, this.fetchFn)) as {
        data?: Array<{ id: unknown; title?: unknown; artist?: unknown; cover_big?: unknown; cover_medium?: unknown; release_date?: unknown }>;
        error?: { message?: unknown } | null;
      };
      if (body.error !== undefined && body.error !== null) {
        throw new UpstreamError(502, 'upstream_error', `Deezer 带内错误：${String(body.error.message ?? '')}`);
      }
      return (body.data ?? []).map((a) => {
        const cover = typeof a.cover_big === 'string' ? a.cover_big : typeof a.cover_medium === 'string' ? a.cover_medium : null;
        return {
          source: 'deezer' as const,
          source_id: String(a.id ?? ''),
          title: typeof a.title === 'string' ? a.title : '',
          artist: artistOf(a.artist),
          release_year: yearOf(a.release_date),
          cover_url: cover,
          country: null,
          genres: [],
          in_collection: false
        };
      });
    });
  }
}

/** iTunes Search（免费·封面好）：entity=album；artwork 提升到 600px；单独 20/min 门 */
export class ITunesSource implements AlbumSource {
  readonly name = 'itunes' as const;
  private readonly gate: MinuteWindowGate;
  constructor(
    private limiter: RateLimiterLike,
    private userAgent: string,
    maxPerMinute = 20,
    private fetchFn: typeof fetch = fetch,
    private timeoutMs = 10_000,
    nowFn?: () => number
  ) {
    this.gate = new MinuteWindowGate(maxPerMinute, nowFn);
  }
  get enabled(): boolean {
    return true;
  }
  async search(q: string, limit: number): Promise<AlbumCandidate[]> {
    // 本源配额满 → 静默降级（不打上游、不占全局队列；下一源接手）
    try {
      this.gate.take();
    } catch (err) {
      if (err instanceof LocalRateLimitError) {
        logger.warn('metadata', 'itunes quota window full, skipping', { retry_after_ms: err.retryAfterMs });
        return [];
      }
      throw err;
    }
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=${limit}`;
    return this.limiter.run(async () => {
      const body = (await getJson(url, this.userAgent, this.timeoutMs, this.fetchFn)) as {
        results?: Array<{ collectionId?: unknown; collectionName?: unknown; artistName?: unknown; releaseDate?: unknown; artworkUrl100?: unknown; primaryGenreName?: unknown }>;
      };
      return (body.results ?? []).map((r) => {
        const artwork = typeof r.artworkUrl100 === 'string' ? r.artworkUrl100.replace('100x100bb', '600x600bb') : null;
        const genre = typeof r.primaryGenreName === 'string' && r.primaryGenreName !== '' ? [r.primaryGenreName] : [];
        return {
          source: 'itunes' as const,
          source_id: String(r.collectionId ?? ''),
          title: typeof r.collectionName === 'string' ? r.collectionName : '',
          artist: typeof r.artistName === 'string' && r.artistName.trim() !== '' ? r.artistName.trim() : 'Unknown Artist',
          release_year: yearOf(r.releaseDate),
          cover_url: artwork,
          country: null,
          genres: genre,
          in_collection: false
        };
      });
    });
  }
}

/** Discogs（冷门兜底）：database/search 需个人令牌；无令牌 → 源停用（fail-soft 跳过） */
export class DiscogsSource implements AlbumSource {
  readonly name = 'discogs' as const;
  readonly enabled: boolean;
  private readonly tokenPart: string;
  constructor(
    private limiter: RateLimiterLike,
    private userAgent: string,
    token: string | null,
    private fetchFn: typeof fetch = fetch,
    private timeoutMs = 10_000
  ) {
    const t = token ?? '';
    this.enabled = t !== '';
    this.tokenPart = this.enabled ? `&token=${encodeURIComponent(t)}` : '';
  }
  async search(q: string, limit: number): Promise<AlbumCandidate[]> {
    const url = `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&per_page=${limit}${this.tokenPart}`;
    return this.limiter.run(async () => {
      const body = (await getJson(url, this.userAgent, this.timeoutMs, this.fetchFn)) as {
        results?: Array<{ id?: unknown; title?: unknown; year?: unknown; country?: unknown; genre?: unknown; style?: unknown; cover_image?: unknown; thumb?: unknown }>;
      };
      return (body.results ?? []).map((r) => {
        // Discogs search 的 title 形如 "Artist - Album"（无艺术家时只有专辑名）
        const raw = typeof r.title === 'string' ? r.title : '';
        const sep = raw.indexOf(' - ');
        const title = sep >= 0 ? raw.slice(sep + 3).trim() : raw;
        const artist = sep >= 0 ? raw.slice(0, sep).trim() : 'Unknown Artist';
        const genres = [r.genre, r.style].flatMap((g) => (Array.isArray(g) ? g.filter((x): x is string => typeof x === 'string') : []));
        const cover = typeof r.cover_image === 'string' ? r.cover_image : typeof r.thumb === 'string' ? r.thumb : null;
        return {
          source: 'discogs' as const,
          source_id: String(r.id ?? ''),
          title,
          artist,
          release_year: yearOf(r.year),
          cover_url: cover,
          country: typeof r.country === 'string' && r.country !== '' ? r.country : null,
          genres,
          in_collection: false
        };
      });
    });
  }
}

// ---------------------------------------------------------------- 降级链

/**
 * 顺序降级（02 §5.1）：按数组序尝试；空结果/失败 → 下一源；首个非空结果即返回（健康路径只花
 * 一次上游调用，30/min 窗口留给主源）；全部失败 → 抛首个（最高优先级）错误；全部空 → []。
 */
export class SourceChain {
  constructor(private readonly sources: AlbumSource[]) {}
  async search(q: string, limit: number): Promise<AlbumCandidate[]> {
    const errors: Array<{ source: MetadataSource; err: unknown }> = [];
    for (const src of this.sources) {
      if (!src.enabled) continue;
      try {
        const items = await src.search(q, limit);
        const usable = items.filter((it) => it.source_id !== '' && it.title !== '');
        if (usable.length === 0) continue;
        return usable;
      } catch (err) {
        errors.push({ source: src.name, err });
        logger.warn('metadata', 'upstream source failed, falling back', { source: src.name, err: String(err) });
      }
    }
    const first = errors[0];
    if (first) throw first.err;
    return [];
  }
}
