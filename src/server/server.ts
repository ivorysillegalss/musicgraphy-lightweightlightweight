import { serve } from '@hono/node-server';
import { loadConfig, ensureDirs } from './config';
import { logger } from './logger';
import { openDatabase } from './db/connection';
import { runMigrations } from './db/migrate';
import { DAO } from './db/dao';
import { createApp } from './app';
import { MetadataRateLimiter } from './metadata/queue';
import { MusicBrainzClient } from './metadata/musicbrainz';

const cfg = loadConfig();
ensureDirs(cfg);

const db = openDatabase(cfg.dbPath);
const applied = runMigrations(db, 'db/migrations');
const dao = new DAO(db);

// 元数据上游限流（复审 V2）：全局串行 ≥1.05s + 30/min 自我防线；UA 合规见 config
const limiter = new MetadataRateLimiter();
const mb = new MusicBrainzClient(limiter, cfg.userAgent);
const app = createApp(dao, cfg, mb);

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
