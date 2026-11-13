// 网易云专辑导入瘦客户端（IM-23 / 评审案 05-系统架构设计/评审案-网易云专辑导入器.md，
// 用户 2026-11-14 追认令批准 Q1 路线 B：source=netease 直建行）。
// 架构 = 外部 api-enhanced 网关 + 瘦客户端：网易云加密/登录/风控全部外包给自部署容器，
// 本文件只做三认证 + 两导入源分页拼装 + 两段式 preview 形状（落库编排见 scripts/netease-import.ts）。
// 红线核对（评审案 §4）：
// - Q3 cookie 即用即弃：cookie 仅在内存对象流转，本文件零 logger 调用（不写日志）、不落库；
// - 对 netease-api 的页间间隔 ≥1s（2.0 全局串行纪律口径，500 张 ≈ 10 页无感）；
// - Q2 fail-soft：NETEASE_API_BASE_URL 未配置 → 导入功能整体停用（Discogs 无 token 先例）；
// - 运行时依赖 = 2（node 内置 fetch）；流式 generator 分页，整列表不驻留内存（RSS 纪律）。
import { normalizeTag } from '../db/sql';
import type { MetadataSource } from './sources';

export const NETEASE_SOURCE: MetadataSource = 'netease';
/** 收藏专辑分页 pageSize 上限（v1 口径 ≤100） */
export const NETEASE_PAGE_SIZE = 100;
/** 页间最小间隔（评审案 §4：对 netease-api 也 ≥1s 串行纪律） */
export const NETEASE_PAGE_PAUSE_MS = 1000;
/** 分页 runaway 保护（50 页 × 100 张 = 5000，正常个人收藏 ≈ 10 页） */
const MAX_PAGES = 50;

export class NeteaseError extends Error {
  constructor(
    public readonly code: number,
    message: string
  ) {
    super(message);
  }
}

/** Q2 fail-soft：未配置 NETEASE_API_BASE_URL → null（调用方整体停用，Discogs 无 token 先例） */
export function neteaseBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env['NETEASE_API_BASE_URL'];
  if (typeof url !== 'string' || url.trim() === '') return null;
  return url.trim().replace(/\/+$/, '');
}

// ---------------------------------------------------------------- Q3 cookie（即用即弃）

const COOKIE_ATTRS = new Set(['path', 'domain', 'expires', 'max-age', 'secure', 'httponly', 'samesite', 'version', 'comment']);

/**
 * 浏览器粘贴 → 纯 cookie 对（"MUSIC_U=xxx; NUID=yyy"）：剥 Set-Cookie 属性（Path/Expires/
 * HttpOnly…）与引号。产物仅在内存流转，不落库不写日志（Q3）。
 */
export function sanitizeCookie(input: string): string {
  const pairs: string[] = [];
  for (const piece of input.split(/[;\r\n]+/)) {
    const p = piece.trim();
    if (p === '' || !p.includes('=')) continue;
    const eq = p.indexOf('=');
    const name = p.slice(0, eq).trim();
    const value = p.slice(eq + 1).trim().replace(/^"|"$/g, '');
    if (name === '' || value === '' || COOKIE_ATTRS.has(name.toLowerCase())) continue;
    pairs.push(`${name}=${value}`);
  }
  return pairs.join('; ');
}

/** 日志/展示用脱敏形态：只保留 cookie 名（Q3 脱敏断言进测试） */
export function redactCookie(cookie: string): string {
  return cookie
    .split('; ')
    .filter((c) => c.includes('='))
    .map((c) => `${c.slice(0, c.indexOf('='))}=<redacted>`)
    .join('; ');
}

// ---------------------------------------------------------------- 认证（三认证）

interface ApiBody {
  code?: number;
  cookie?: unknown;
  message?: string;
  data?: unknown;
  [k: string]: unknown;
}

/** GET 透传到 api-enhanced：超时 + UA + JSON 容错（非 JSON → NeteaseError） */
async function callApi(url: string, fetchFn: typeof fetch, timeoutMs: number): Promise<{ status: number; body: ApiBody }> {
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new NeteaseError(0, `netease-api 不可达：${String(err)}`);
  }
  const body = (await res.json().catch(() => null)) as ApiBody | null;
  if (body === null || typeof body !== 'object') throw new NeteaseError(res.status, `netease-api 响应非 JSON（HTTP ${res.status}）`);
  return { status: res.status, body };
}

/** 登录响应 cookie 提取：优先 body.cookie 数组（api-enhanced 形状），回退 Set-Cookie 头 */
function cookieOf(body: ApiBody, res: Response | null): string {
  if (Array.isArray(body.cookie)) return sanitizeCookie(body.cookie.filter((c): c is string => typeof c === 'string').join('; '));
  if (typeof body.cookie === 'string' && body.cookie !== '') return sanitizeCookie(body.cookie);
  const setCookie = res?.headers.get('set-cookie') ?? null;
  return setCookie === null ? '' : sanitizeCookie(setCookie);
}

export interface NeteaseAuthResult {
  cookie: string;
  profile: string | null;
}

/** 手机+密码登录：code 502 = 密码错误或需验证码（重试携带 captcha）；HTTP/code 449 = 风控验证码，透传 */
export async function loginByCellphone(opts: {
  baseUrl: string;
  phone: string;
  password: string;
  captcha?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<NeteaseAuthResult> {
  const qs = new URLSearchParams({ phone: opts.phone, password: opts.password });
  if (opts.captcha !== undefined) qs.set('captcha', opts.captcha);
  const { status, body } = await callApi(`${opts.baseUrl}/login/cellphone?${qs}`, opts.fetchFn ?? fetch, opts.timeoutMs ?? 10_000);
  const code = typeof body.code === 'number' ? body.code : status;
  if (code === 449 || status === 449) throw new NeteaseError(449, '需要验证码（code 449 透传；用 --captcha 提供短信验证码重试）');
  if (code === 502) throw new NeteaseError(502, '登录失败（code 502：密码错误或需验证码；需验证码时提供 captcha 重试）');
  const cookie = cookieOf(body, null);
  if (code !== 200 || cookie === '') throw new NeteaseError(code, `登录未成功（code ${code}）`);
  return { cookie, profile: typeof body.message === 'string' ? body.message : null };
}

export type QrState = 'waiting' | 'scanned' | 'authorized';

export interface QrLoginOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  intervalMs?: number;
  /** 整体超时（QR 有效期后过期）；默认 180s */
  deadlineMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
  /** QR data URL 交付回调（CLI 落本地临时文件打开扫码；本文件不碰 fs） */
  onQrImage?: (dataUrl: string) => void;
  /** 轮询状态回调（CLI 打印进度；不含任何凭据） */
  onState?: (state: QrState) => void;
}

/** QR 扫码登录：/login/qr/key → /create(key, qrimg=true) → 轮询 /check（801 等待→802 已扫→803 授权→800 过期） */
export async function qrLogin(opts: QrLoginOptions): Promise<NeteaseAuthResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const sleepFn = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const nowFn = opts.nowFn ?? (() => Date.now());
  const deadline = nowFn() + (opts.deadlineMs ?? 180_000);

  const keyRes = await callApi(`${opts.baseUrl}/login/qr/key?timestamp=${nowFn()}`, fetchFn, timeoutMs);
  const key = (keyRes.body.data as { unikey?: unknown } | undefined)?.unikey;
  if (typeof key !== 'string' || key === '') throw new NeteaseError(0, 'QR key 获取失败');

  const createRes = await callApi(`${opts.baseUrl}/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true&timestamp=${nowFn()}`, fetchFn, timeoutMs);
  const qrimg = (createRes.body.data as { qrimg?: unknown } | undefined)?.qrimg;
  if (typeof qrimg !== 'string' || !qrimg.startsWith('data:image/')) throw new NeteaseError(0, 'QR 图片获取失败');
  opts.onQrImage?.(qrimg);

  for (;;) {
    if (nowFn() > deadline) throw new NeteaseError(800, 'QR 登录超时');
    const { body } = await callApi(`${opts.baseUrl}/login/qr/check?key=${encodeURIComponent(key)}&timestamp=${nowFn()}`, fetchFn, timeoutMs);
    const code = typeof body.code === 'number' ? body.code : 0;
    if (code === 803) {
      const cookie = cookieOf(body, null);
      if (cookie === '') throw new NeteaseError(803, 'QR 授权成功但未取得 cookie');
      opts.onState?.('authorized');
      return { cookie, profile: null };
    }
    if (code === 800) throw new NeteaseError(800, 'QR 已过期，请重试');
    if (code === 802) opts.onState?.('scanned');
    else if (code === 801) opts.onState?.('waiting');
    else if (code !== 0) throw new NeteaseError(code, `QR 状态未知（code ${code}）`);
    await sleepFn(intervalMs);
  }
}

// ---------------------------------------------------------------- 导入源（两源）

/** 网易云专辑条目（导入面最小形状；savedAt = 网易云收藏时间 → listened_at 候选） */
export interface NeteaseAlbumItem {
  sourceId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  releaseYear: number | null;
  savedAt: string | null;
}

const yearOfMs = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const y = new Date(v).getUTCFullYear();
  return y >= 1000 && y <= 3000 ? y : null;
};

const dayOfMs = (v: unknown): string | null => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return `${new Date(v).toISOString().slice(0, 10)}T00:00:00Z`;
};

/** 未知形状 → 条目（字段级宽容、缺关键字段 = null，调用方按需跳过） */
export function mapAlbumItem(raw: unknown): NeteaseAlbumItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const sourceId = typeof r['id'] === 'number' ? String(r['id']) : typeof r['id'] === 'string' ? r['id'] : '';
  if (sourceId === '') return null;
  const artistName = (r['artist'] as { name?: unknown } | null | undefined)?.name;
  const pasted = typeof r['artistName'] === 'string' ? r['artistName'].trim() : '';
  const artist = typeof artistName === 'string' && artistName.trim() !== '' ? artistName.trim() : pasted !== '' ? pasted : 'Unknown Artist';
  return {
    sourceId,
    title: typeof r['name'] === 'string' && r['name'].trim() !== '' ? r['name'].trim() : '(未命名专辑)',
    artist,
    coverUrl: typeof r['picUrl'] === 'string' && r['picUrl'] !== '' ? r['picUrl'] : null,
    releaseYear: yearOfMs(r['publishTime']),
    savedAt: dayOfMs(r['savedAt'])
  };
}

/** 收藏专辑页提取（形状容错：data 数组 或 data.{count,data} 两种 api-enhanced 版本形状） */
function extractSublistPage(body: ApiBody): { total: number | null; items: unknown[] } {
  const d = body['data'];
  if (Array.isArray(d)) return { total: typeof body['count'] === 'number' ? body['count'] : null, items: d };
  if (typeof d === 'object' && d !== null) {
    const inner = d as Record<string, unknown>;
    if (Array.isArray(inner['data'])) {
      return { total: typeof inner['count'] === 'number' ? inner['count'] : null, items: inner['data'] };
    }
  }
  return { total: null, items: [] };
}

/** 收藏专辑流式分页（async generator；页间 ≥pauseMs 默认 1000；MAX_PAGES runaway 保护） */
export async function* iterSavedAlbums(opts: {
  baseUrl: string;
  cookie: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  pauseMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}): AsyncGenerator<NeteaseAlbumItem> {
  const fetchFn = opts.fetchFn ?? fetch;
  const pauseMs = opts.pauseMs ?? NETEASE_PAGE_PAUSE_MS;
  const sleepFn = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let offset = 0, page = 0; page < MAX_PAGES; offset += NETEASE_PAGE_SIZE, page++) {
    const { body } = await callApi(
      `${opts.baseUrl}/album/sublist?limit=${NETEASE_PAGE_SIZE}&offset=${offset}`,
      fetchFn,
      opts.timeoutMs ?? 10_000
    );
    if (typeof body.code === 'number' && body.code !== 200) throw new NeteaseError(body.code, `收藏专辑拉取失败（code ${body.code}，offset=${offset}）`);
    const { total, items } = extractSublistPage(body);
    for (const raw of items) {
      const item = mapAlbumItem(raw);
      if (item !== null) yield item;
    }
    if (total === null ? items.length < NETEASE_PAGE_SIZE : offset + items.length >= total) return;
    if (items.length > 0) await sleepFn(pauseMs);
  }
}

/** 歌单 ID 解析：裸数字 或 URL（含 #/playlist?id= 与 ?id=&…）取 id 参数 */
export function parsePlaylistId(input: string): string | null {
  const s = input.trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/[?&]id=(\d+)/);
  return m?.[1] ?? null;
}

/** 歌单 → 专辑聚合：/playlist/track/all 分页，按 al.id 去重（首见保留 title/cover，ar 名并集聚合） */
export async function fetchPlaylistAlbums(opts: {
  baseUrl: string;
  cookie: string;
  playlistId: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  pauseMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<NeteaseAlbumItem[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const pauseMs = opts.pauseMs ?? NETEASE_PAGE_PAUSE_MS;
  const sleepFn = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const byId = new Map<string, { item: NeteaseAlbumItem; artists: string[] }>();
  for (let offset = 0, page = 0; page < MAX_PAGES; offset += NETEASE_PAGE_SIZE, page++) {
    const { body } = await callApi(
      `${opts.baseUrl}/playlist/track/all?id=${encodeURIComponent(opts.playlistId)}&limit=${NETEASE_PAGE_SIZE}&offset=${offset}`,
      fetchFn,
      opts.timeoutMs ?? 10_000
    );
    if (typeof body.code === 'number' && body.code !== 200) throw new NeteaseError(body.code, `歌单拉取失败（code ${body.code}，offset=${offset}）`);
    const songs = Array.isArray(body['songs']) ? (body['songs'] as unknown[]) : [];
    for (const raw of songs) {
      if (typeof raw !== 'object' || raw === null) continue;
      const al = (raw as Record<string, unknown>)['al'] as Record<string, unknown> | undefined;
      if (typeof al !== 'object' || al === null) continue;
      const item = mapAlbumItem(al);
      if (item === null) continue;
      const ar = Array.isArray((raw as Record<string, unknown>)['ar']) ? ((raw as Record<string, unknown>)['ar'] as unknown[]) : [];
      const names = ar.flatMap((a) => {
        const n = (a as { name?: unknown }).name;
        return typeof n === 'string' && n.trim() !== '' ? [n.trim()] : [];
      });
      const seen = byId.get(item.sourceId);
      if (seen === undefined) byId.set(item.sourceId, { item, artists: names });
      else for (const n of names) if (n !== '' && !seen.artists.includes(n)) seen.artists.push(n);
    }
    if (songs.length < NETEASE_PAGE_SIZE) return [...byId.values()].map(aggregate);
    await sleepFn(pauseMs);
  }
  return [...byId.values()].map(aggregate);

  function aggregate(v: { item: NeteaseAlbumItem; artists: string[] }): NeteaseAlbumItem {
    const artist = v.artists.length === 0 ? v.item.artist : v.artists.join('/');
    return { ...v.item, artist: artist === '' ? 'Unknown Artist' : artist };
  }
}

// ---------------------------------------------------------------- 两段式 preview 形状

/** v1 去重键（artist||title 小写归一，normalizeTag 同款口径）——isNew 标记与 selected 过滤共用 */
export function dedupKey(a: { artist: string; title: string }): string {
  return `${normalizeTag(a.artist)}|${normalizeTag(a.title)}`;
}

export interface PreviewItem extends NeteaseAlbumItem {
  key: string;
  isNew: boolean;
}

/** selected 过滤（dedupKey 列表；缺省 = 全部新专辑），上限 200（v1 limit ∈ [1,200] 口径） */
export function filterSelected(items: PreviewItem[], selected: string[] | null): PreviewItem[] {
  const cap = (list: PreviewItem[]): PreviewItem[] => list.slice(0, 200);
  if (selected === null) return cap(items.filter((it) => it.isNew));
  const wanted = new Set(selected);
  return cap(items.filter((it) => wanted.has(it.key)));
}
