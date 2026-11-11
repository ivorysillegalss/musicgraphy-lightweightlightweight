// D2 spike：MusicBrainz / Cover Art Archive 可用性实测（单请求，遵守 1 req/s 政策，显式 UA——复审 V2）
import { loadConfig } from '../src/server/config';

interface MbResponse {
  count?: number;
  releases?: Array<{ id: string; title: string; 'artist-credit'?: Array<{ name?: string }> }>;
}

const cfg = loadConfig();

async function timedFetch(url: string, init?: RequestInit): Promise<{ res: Response; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(url, init);
  return { res, ms: Math.round(performance.now() - t0) };
}

const result: Record<string, unknown> = { user_agent: cfg.userAgent };

// 1) MusicBrainz 搜索（FR-1 输入端）
const q = encodeURIComponent('artist:"radiohead" AND release:"ok computer"');
const mb = await timedFetch(`https://musicbrainz.org/ws/2/release?query=${q}&fmt=json&limit=3`, {
  headers: { 'User-Agent': cfg.userAgent, Accept: 'application/json' }
});
const body = (await mb.res.json().catch(() => null)) as MbResponse | null;
const first = body?.releases?.[0];
result.musicbrainz = {
  status: mb.res.status,
  ms: mb.ms,
  total_count: body?.count,
  returned: body?.releases?.length ?? 0,
  first_release: first ? { id: first.id, title: first.title, artist: first['artist-credit']?.[0]?.name ?? null } : null,
  ratelimit_headers: Object.fromEntries([...mb.res.headers.entries()].filter(([k]) => k.startsWith('x-ratelimit')))
};

// 2) Cover Art Archive 缩略图（F3 落盘缓存的源）：250px 规格，307 → archive.org
if (first !== undefined) {
  await new Promise((r) => setTimeout(r, 1100)); // 串行间隔 ≥1s（复审 V2）
  const caa = await timedFetch(`https://coverartarchive.org/release/${first.id}/front-250`, {
    headers: { 'User-Agent': cfg.userAgent },
    redirect: 'manual'
  });
  result.cover_art_archive = {
    status: caa.res.status,
    ms: caa.ms,
    redirect_to: caa.res.headers.get('location'),
    note: caa.res.status === 307 ? '307 跳转 archive.org——落盘缓存时需跟随' : null
  };
}

console.log(JSON.stringify(result, null, 2));
