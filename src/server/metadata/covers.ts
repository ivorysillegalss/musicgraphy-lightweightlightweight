// 封面落盘管线（F3 / ADR-005 纪律②③）：流式写盘（禁读入内存、禁 base64）、
// **内容 hash（sha256）命名**（内容寻址 → /covers/* 一年 immutable 的正确性前提，Step 4），
// 幂等（同字节同名跳过）、5MB 上限、跟随 CAA 307 → archive.org（fetch redirect:follow）、
// .part 临时名原子落盘（半截文件不会被当成封面）。
// 兼容：Step 2 时代的 sha1(source_id) 命名文件继续可服务（serveCoverFile 的文件名白名单两者都收）。
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';

export class CoverDownloadError extends Error {}

/** 封面文件名白名单：sha256 内容 hash（64 hex，Step 4 起）与遗留 sha1(source_id)（40 hex，Step 2） */
export const COVER_FILE_RE = /^[0-9a-f]{40,64}\.(jpg|jpeg|png|webp|gif)$/;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

export async function downloadCover(opts: {
  coverUrl: string;
  coversDir: string;
  userAgent: string;
  fetchFn?: typeof fetch;
  maxBytes?: number;
}): Promise<string> {
  const fetchFn = opts.fetchFn ?? fetch;
  const max = opts.maxBytes ?? 5 * 1024 * 1024;

  const res = await fetchFn(opts.coverUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': opts.userAgent }
  });
  if (!res.ok || res.body === null) throw new CoverDownloadError(`HTTP ${res.status}`);
  const contentType = (res.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = EXT_BY_TYPE[contentType];
  if (ext === undefined) throw new CoverDownloadError(`非图片响应：${contentType}`);

  await mkdir(opts.coversDir, { recursive: true });
  // 流式：字节经 hash Transform 直落临时文件，全程不整块驻留内存（纪律②）
  const hash = createHash('sha256');
  let seen = 0;
  const counter = new Transform({
    transform(chunk: unknown, _enc, cb) {
      const buf = chunk as Buffer;
      seen += buf.length;
      if (seen > max) {
        cb(new CoverDownloadError('cover exceeds size cap'));
        return;
      }
      hash.update(buf);
      cb(null, buf);
    }
  });
  const tmp = join(opts.coversDir, `.part-${randomPart()}`);
  try {
    await pipeline(Readable.fromWeb(res.body as unknown as NodeWebReadableStream), counter, createWriteStream(tmp));
  } catch (err) {
    throw new CoverDownloadError(`下载失败：${String(err)}`);
  }
  const filename = `${hash.digest('hex')}${ext}`;
  const dst = join(opts.coversDir, filename);
  if (existsSync(dst)) {
    // 内容寻址命中（并发首访竞态/重放）：目标已存在，丢弃临时件即可
    await rm(tmp, { force: true });
    return filename;
  }
  await rename(tmp, dst); // .part → 内容 hash 原子落名
  return filename;
}

function randomPart(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * /covers/<file> 磁盘命中服务（流式直通 + 一年 immutable——文件名即内容地址）。
 * 文件名走白名单正则 + 根目录逃逸校验；未命中返回 null（调用方决定懒下载或 404）。
 */
export function serveCoverFile(coversDir: string, file: string): Response | null {
  if (!COVER_FILE_RE.test(file)) return null;
  const root = resolve(coversDir);
  const target = resolve(root, file);
  if (!target.startsWith(root + sep)) return null;
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  const ext = file.slice(file.lastIndexOf('.'));
  return new Response(Readable.toWeb(createReadStream(target)) as unknown as ReadableStream, {
    status: 200,
    headers: {
      'cache-control': 'public, max-age=31536000, immutable',
      'content-length': String(statSync(target).size),
      'content-type': MIME_BY_EXT[ext] ?? 'application/octet-stream'
    }
  });
}
