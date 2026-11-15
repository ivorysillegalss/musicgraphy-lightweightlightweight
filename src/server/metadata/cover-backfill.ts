// 封面回填驱动（IM-22 R4 收口接线 · 2026-11-15）：R4 交付了 downloadBackfill 空闲门
// 原语但无驱动循环——本模块补上：扫描 cover_url 在档而 cover_local 缺失的专辑，
// 经空闲门逐张补齐（空闲 >10s 才注入 = 交互永远优先），写回 cover_local。
// 单次 pass 吞吐全部存量缺口；每 10 分钟重扫一轮（新导入 / 失败行的自然回归点；
// 失败行次轮重试，唯一出口 = 日志，不阻塞不静默吞）。
import type { Db } from '../db/connection';
import type { CoverGate } from './cover-gate';
import { logger } from '../logger';

export interface CoverBackfillPassResult {
  downloaded: number;
  failed: number;
  remaining: number;
}

/** 单次回填 pass：pass 开始一次取全量缺口清单，逐行恰好尝试一次（避免跨批重复计数），返回计数 */
export async function coverBackfillPass(
  db: Db,
  gate: CoverGate,
  coversDir: string,
  userAgent: string,
  fetchFn?: typeof fetch
): Promise<CoverBackfillPassResult> {
  const findMissing = db.prepare(
    'SELECT id, cover_url AS coverUrl FROM album_metadata WHERE cover_url IS NOT NULL AND cover_local IS NULL ORDER BY created_at DESC'
  );
  const setLocal = db.prepare('UPDATE album_metadata SET cover_local = ? WHERE id = ?');
  const rows = findMissing.all() as Array<{ id: string; coverUrl: string }>;
  let downloaded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const filename = await gate.downloadBackfill({ coverUrl: row.coverUrl, coversDir, userAgent, fetchFn });
      setLocal.run(filename, row.id);
      downloaded += 1;
    } catch (err) {
      failed += 1;
      logger.warn('covers', 'backfill download failed', { albumId: row.id, err: String(err) });
    }
  }
  const remaining = (findMissing.all() as Array<unknown>).length;
  return { downloaded, failed, remaining };
}

export interface CoverBackfillOptions {
  /** boot 后首扫延迟（错过 boot 高峰，交互优先）；默认 15s */
  initialDelayMs?: number;
  /** 重扫间隔；默认 10min */
  intervalMs?: number;
}

/** 常驻驱动：boot 首扫 + 定时重扫（timer 全部 unref，不阻进程退出） */
export function startCoverBackfill(
  db: Db,
  gate: CoverGate,
  coversDir: string,
  userAgent: string,
  opts: CoverBackfillOptions = {}
): void {
  const tick = (): void => {
    void coverBackfillPass(db, gate, coversDir, userAgent)
      .then((r) => {
        if (r.downloaded > 0 || r.failed > 0) {
          logger.info('covers', 'backfill pass', { downloaded: r.downloaded, failed: r.failed, remaining: r.remaining });
        }
      })
      .catch(() => {});
  };
  setTimeout(tick, opts.initialDelayMs ?? 15_000).unref();
  setInterval(tick, opts.intervalMs ?? 10 * 60_000).unref();
}
