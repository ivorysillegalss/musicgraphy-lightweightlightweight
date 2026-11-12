import { mkdirSync } from 'node:fs';

export interface Config {
  env: 'development' | 'production';
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  backupsDir: string;
  coversDir: string;
  accessKey: string;
  sessionSecret: string;
  userAgent: string;
  /** Discogs 个人令牌（冷门兜底源；缺省 → 该源停用，降级链自动跳过，Step 4） */
  discogsToken: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProd = env['NODE_ENV'] === 'production';
  const accessKey = env['ACCESS_KEY'] ?? (isProd ? '' : 'dev-local');
  const sessionSecret = env['SESSION_SECRET'] ?? (isProd ? '' : 'dev-secret-override-me-32-bytes!!');
  if (isProd && (accessKey === '' || sessionSecret === '')) {
    throw new Error('生产环境必须设置 ACCESS_KEY 与 SESSION_SECRET（fail-fast，复审 V10）');
  }
  if (!isProd && (env['ACCESS_KEY'] === undefined || env['SESSION_SECRET'] === undefined)) {
    console.warn('[config] 开发环境使用内置默认 ACCESS_KEY/SESSION_SECRET（仅限本机 127.0.0.1）');
  }
  const dataDir = env['DATA_DIR'] ?? './data';
  return {
    env: isProd ? 'production' : 'development',
    port: Number(env['PORT'] ?? 3000),
    host: env['HOST'] ?? '127.0.0.1',
    dataDir,
    dbPath: `${dataDir}/musicgraphy.db`,
    backupsDir: `${dataDir}/backups`,
    coversDir: `${dataDir}/covers`,
    accessKey,
    sessionSecret,
    // 上游 UA 合规（复审 V2）：MusicBrainz 要求显式 UA，缺失视为匿名加重限流
    userAgent: env['USER_AGENT'] ?? 'Musicgraphy/0.1.0 (dev; contact unset)',
    discogsToken: env['DISCOGS_TOKEN'] ?? null
  };
}

export function ensureDirs(cfg: Config): void {
  mkdirSync(cfg.dataDir, { recursive: true });
  mkdirSync(cfg.backupsDir, { recursive: true });
  mkdirSync(cfg.coversDir, { recursive: true });
}
