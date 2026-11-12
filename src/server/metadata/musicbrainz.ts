// MusicBrainz 客户端（02 §5.1 多源降级链主源；FR-1 输入端代理）
// 合规（复审 V2）：显式 User-Agent（缺失视为匿名加重限流）+ 串行队列 + 超时
// F1：搜索结果仅为候选，落库后 title/artist/cover 即本地快照，源失效不影响已存记录
import type { MetadataRateLimiter } from './queue';
import type { MetadataSource } from './sources';

export interface AlbumCandidate {
  source: MetadataSource;
  source_id: string;
  title: string;
  artist: string;
  release_year: number | null;
  cover_url: string | null;
  country: string | null;
  /** MB 搜索结果不含 genres——Deezer/iTunes 命中可带（02 §5.1"封面好"层） */
  genres: string[];
  /** FR-1"已收藏前置标记"：由路由按 collection_record 成员判定回填 */
  in_collection: boolean;
}

export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterS: number | null = null
  ) {
    super(message);
  }
}

interface MbRelease {
  id: string;
  title: string;
  date?: string;
  country?: string;
  'artist-credit'?: Array<{ name?: string; joinphrase?: string }>;
  'cover-art-archive'?: { front?: boolean; artwork?: boolean };
}
interface MbReleaseSearch {
  count?: number;
  releases?: MbRelease[];
}

export class MusicBrainzClient {
  constructor(
    private limiter: MetadataRateLimiter,
    private userAgent: string,
    private fetchFn: typeof fetch = fetch,
    private timeoutMs = 10_000
  ) {}

  /** 搜索 release（自由文本透传；粘贴识别/查询增强属 FR-1 捷径层，W2） */
  async searchReleases(q: string, limit = 12): Promise<AlbumCandidate[]> {
    const url = `https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
    return this.limiter.run(async () => {
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs)
        });
      } catch (err) {
        throw new UpstreamError(0, 'upstream_unreachable', `上游请求失败：${String(err)}`);
      }
      if (res.status === 503) {
        const ra = Number(res.headers.get('Retry-After') ?? '0') || null;
        throw new UpstreamError(503, 'upstream_rate_limited', 'MusicBrainz 拒绝（超速）', ra);
      }
      if (!res.ok) throw new UpstreamError(res.status, 'upstream_error', `MusicBrainz HTTP ${res.status}`);
      const body = (await res.json().catch(() => null)) as MbReleaseSearch | null;
      return (body?.releases ?? []).map(mapRelease);
    });
  }
}

function mapRelease(r: MbRelease): AlbumCandidate {
  // artist-credit：joinphrase 是本条目连到下一条的连接词（"A" + " & " + "B"）
  const artist = (r['artist-credit'] ?? [])
    .map((c) => (c.name ?? '') + (c.joinphrase ?? ''))
    .join('')
    .trim();
  return {
    source: 'musicbrainz',
    source_id: r.id,
    title: r.title,
    artist: artist === '' ? 'Unknown Artist' : artist,
    release_year: typeof r.date === 'string' && /^\d{4}/.test(r.date) ? Number(r.date.slice(0, 4)) : null,
    // CAA front-250（复审 V2：取缩略图尺寸；无硬限流，307 → archive.org，Step 2 落盘时跟随）
    cover_url: r['cover-art-archive']?.front === true ? `https://coverartarchive.org/release/${r.id}/front-250` : null,
    country: r.country ?? null,
    genres: [],
    in_collection: false
  };
}
