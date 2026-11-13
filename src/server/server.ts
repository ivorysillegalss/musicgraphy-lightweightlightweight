import { serve } from '@hono/node-server';
import { loadConfig, ensureDirs } from './config';
import { logger } from './logger';
import { openDatabase } from './db/connection';
import { runMigrations } from './db/migrate';
import { backupNow } from './db/backup';
import { DAO } from './db/dao';
import { createApp } from './app';
import { MetadataRateLimiter } from './metadata/queue';
import { MusicBrainzClient } from './metadata/musicbrainz';
import { DeezerSource, DiscogsSource, ITunesSource, MusicBrainzSource, type AlbumSource } from './metadata/sources';
import { CoverGate } from './metadata/cover-gate';

const cfg = loadConfig();
ensureDirs(cfg);

const db = openDatabase(cfg.dbPath);
const applied = runMigrations(db, 'db/migrations');
const dao = new DAO(db);

// 元数据上游限流（复审 V2）：全局串行 ≥1.05s + 30/min 自我防线；UA 合规见 config。
// 多源降级链（02 §5.1 / Step 4）：数组序 = 优先级；iTunes 叠加 20/min 单独配额；
// Discogs 无令牌时停用（fail-soft 跳过）。
const limiter = new MetadataRateLimiter();
const mb = new MusicBrainzClient(limiter, cfg.userAgent);
const sources: AlbumSource[] = [
  new MusicBrainzSource(mb),
  new DeezerSource(limiter, cfg.userAgent),
  new ITunesSource(limiter, cfg.userAgent),
  new DiscogsSource(limiter, cfg.userAgent, cfg.discogsToken)
];

// Step 2（F3）：落库后异步封面落盘——不阻塞响应，失败仅日志（重加同专辑可补）。
// Step 4：文件名 = 内容 sha256（covers.ts），懒下载路由（/covers/a/:id）为兜底入口。
// IM-22 R3：钩子与懒下载同走封面门（single-flight 同封面合并 + 独立「串行 ≥1s + 在途 ≤2」，
// 评审案 Q2——不占搜索 30/min 窗）；R4 回填经 downloadBackfill 空闲门注入（交互优先）。
const coverGate = new CoverGate();
const onAlbumAdded = (albumId: string, _sourceId: string, coverUrl: string | null): void => {
  if (coverUrl === null) return;
  void (async () => {
    try {
      const filename = await coverGate.download({ coverUrl, coversDir: cfg.coversDir, userAgent: cfg.userAgent });
      dao.setAlbumCoverLocal(albumId, filename);
      logger.info('covers', 'cover saved', { albumId, filename });
    } catch (err) {
      logger.warn('covers', 'cover download failed', { albumId, err: String(err) });
    }
  })();
};

const app = createApp(dao, cfg, sources, { onAlbumAdded, cover: { gate: coverGate } });

// 备份（R1/V14）：启动时 + 每日定时；按天去重，保留 7 天；失败不阻塞
try {
  const f = backupNow(db, cfg.backupsDir);
  if (f !== null) logger.info('server', 'startup backup created', { file: f });
} catch (err) {
  logger.warn('server', 'startup backup failed', { err: String(err) });
}
setInterval(() => {
  try {
    const f = backupNow(db, cfg.backupsDir);
    if (f !== null) logger.info('server', 'daily backup created', { file: f });
  } catch (err) {
    logger.warn('server', 'daily backup failed', { err: String(err) });
  }
}, 24 * 3600_000).unref();

const server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (_info) => {
  logger.info('server', `listening on http://${cfg.host}:${cfg.port}`, {
    pid: process.pid,
    node: process.version,
    env: cfg.env,
    migrations_applied: applied,
    rss_mb: Math.round(process.memoryUsage().rss / 1048576)
  });
});

// 内存预算看门（复审 V13）：进程定时自读 RSS，越界 WARN——告警发出方，处置交守护进程
const RSS_ALARM = 150 * 1024 * 1024;
const rssTimer = setInterval(() => {
  const rss = process.memoryUsage().rss;
  if (rss > RSS_ALARM) logger.warn('server', 'rss beyond alarm threshold', { rss_mb: Math.round(rss / 1048576), alarm_mb: 150 });
}, 60_000);
rssTimer.unref();

// 退出路径（复审 V8）：正常信号关库；uncaughtException 记日志后 exit(1) 交守护重启（WAL+NORMAL 崩溃不丢数据，评审 R8）
const shutdown = (signal: string): void => {
  logger.info('server', 'shutting down', { signal });
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.error('server', 'uncaughtException, exiting for supervisor restart', { err: String(err?.stack ?? err) });
  process.exit(1);
});
