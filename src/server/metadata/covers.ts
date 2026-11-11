// 封面落盘管线（F3 / ADR-005 纪律②）：流式写盘（禁读入内存）、sha1(source_id) 命名、
// 幂等（已存在跳过）、5MB 上限、跟随 CAA 307 → archive.org（fetch redirect:follow）
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';

export class CoverDownloadError extends Error {}

export async function downloadCover(opts: {
  coverUrl: string;
  sourceId: string;
  coversDir: string;
  userAgent: string;
  fetchFn?: typeof fetch;
  maxBytes?: number;
}): Promise<string> {
  const fetchFn = opts.fetchFn ?? fetch;
  const max = opts.maxBytes ?? 5 * 1024 * 1024;
  const filename = `${createHash('sha1').update(opts.sourceId).digest('hex')}.jpg`;
  const dst = join(opts.coversDir, filename);
  if (existsSync(dst)) return filename; // 幂等：同一专辑不重复下载

  const res = await fetchFn(opts.coverUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': opts.userAgent }
  });
  if (!res.ok || res.body === null) throw new CoverDownloadError(`HTTP ${res.status}`);
  const contentType = res.headers.get('Content-Type') ?? '';
  if (!contentType.startsWith('image/')) throw new CoverDownloadError(`非图片响应：${contentType}`);

  await mkdir(opts.coversDir, { recursive: true });
  let seen = 0;
  const counter = new Transform({
    transform(chunk: unknown, _enc, cb) {
      seen += (chunk as Buffer).length;
      if (seen > max) {
        cb(new CoverDownloadError('cover exceeds size cap'));
        return;
      }
      cb(null, chunk as Buffer);
    }
  });
  const tmp = `${dst}.part`;
  await pipeline(Readable.fromWeb(res.body as unknown as NodeWebReadableStream), counter, createWriteStream(tmp));
  await rename(tmp, dst); // .part 原子落名，避免半截文件被当成封面
  return filename;
}
