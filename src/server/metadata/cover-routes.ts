// 封面路由子应用（挂 /covers/*，静态挂载不改 app 主体结构——拆分方案/PM §7.5）。
// 职责（F3 + Step 4）：
//   GET /covers/:file          磁盘命中 → 流式直通 + 一年 immutable（文件名 = 内容 hash，内容寻址）
//   GET /covers/a/:albumId     懒下载入口：首次访问按 album_metadata.cover_url 下载落盘
//                              （内容 hash 命名）→ 回填 cover_local → 302 到 /covers/<hash>；
//                              之后同 URL 仅一次 DAO 读 + 302，字节请求由 immutable 缓存承接。
// 内存纪律：文件内容从不整体读入内存（ReadableStream 直通），无 base64。
// 鉴权豁免（V10）：封面须被 <img> 直接引用，与 /static 同列公开资源。
// IM-22 R3：懒下载与 onAlbumAdded 钩子同走封面门（cover-gate.ts）——single-flight 同封面
// 合并 + 独立「串行 ≥1s + 在途 ≤2」门（不占搜索 30/min 窗）；gate 未注入时的缺省门为零
// 间距（测试便利，保 single-flight 语义），生产 server.ts 必须接线真实门。
import { Hono } from 'hono';
import type { DAO } from '../db/dao';
import { logger } from '../logger';
import { CoverGate } from './cover-gate';
import { CoverDownloadError, serveCoverFile } from './covers';

export interface CoverRouteOptions {
  coversDir: string;
  userAgent: string;
  fetchFn?: typeof fetch;
  /** 封面门（IM-22 R3）；缺省 = 零间距门（仅测试路径） */
  gate?: CoverGate;
}

export function coverRoutes(dao: DAO, opts: CoverRouteOptions): Hono {
  const app = new Hono();
  const gate = opts.gate ?? new CoverGate({ minIntervalMs: 0 });

  // 内容寻址命中（含 Step 2 遗留 sha1(source_id) 文件名）
  app.get('/:file', (c) => {
    const res = serveCoverFile(opts.coversDir, c.req.param('file') ?? '');
    if (res === null) return c.text('not found', 404);
    return res;
  });

  // 懒下载：按专辑解析远端封面，落盘后 302 到内容地址
  app.get('/a/:albumId', async (c) => {
    const album = dao.getAlbum(c.req.param('albumId') ?? '');
    if (album === null) return c.text('not found', 404);
    if (album.cover_local !== null) return c.redirect(`/covers/${album.cover_local}`, 302);
    if (album.cover_url === null) return c.text('not found', 404);
    let filename: string;
    try {
      filename = await gate.download({ coverUrl: album.cover_url, coversDir: opts.coversDir, userAgent: opts.userAgent, fetchFn: opts.fetchFn });
    } catch (err) {
      logger.warn('covers', 'lazy cover download failed', { albumId: album.id, err: String(err) });
      const status = err instanceof CoverDownloadError ? 502 : 500;
      return c.text('cover unavailable', status);
    }
    dao.setAlbumCoverLocal(album.id, filename);
    return c.redirect(`/covers/${filename}`, 302);
  });

  return app;
}
