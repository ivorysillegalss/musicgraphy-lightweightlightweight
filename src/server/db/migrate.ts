import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import type { Db } from './connection';
import { logger } from '../logger';

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

// 迁移执行器：顺序 SQL 文件 + PRAGMA user_version（ADR-001 / 评审 R2 注记：
// DDL 事务包裹，journal_mode 等 PRAGMA 不得在事务内——已在 connection 层处理）
// 表重建类迁移（0003 四步重建父表）须在事务**外**临时 foreign_keys=OFF（SQLite 官方配方；
// 实测：FK=ON 时 DROP 被引用父表必炸、事务内设 foreign_keys 为 no-op、defer_foreign_keys
// 的违规计数在 RENAME 换名后不愈合）。基线 FK=ON 在迁移窗口结束立即恢复（IM-25），
// 且每个迁移 COMMIT 后跑 foreign_key_check 兜底——零违规才算应用成功。
export function runMigrations(db: Db, migrationsDir: string): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number | bigint } | undefined;
  const current = Number(row?.['user_version'] ?? 0);
  const files = readdirSync(migrationsDir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort();
  let applied = 0;
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    for (const file of files) {
      const version = Number(file.slice(0, 4));
      if (version <= current) continue;
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(sql);
        db.exec(`PRAGMA user_version = ${version}`);
        db.exec('COMMIT');
        const violations = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
        if (violations.length > 0) {
          throw new Error(`foreign_key_check reported ${violations.length} violation(s) after ${file}`);
        }
        applied++;
        logger.info('migrate', `applied ${file}`, { version });
      } catch (err) {
        db.exec('ROLLBACK');
        logger.error('migrate', `failed ${file}`, { err: String(err) });
        throw err;
      }
    }
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
  return applied;
}

// CLI 入口：npm run migrate
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { loadConfig, ensureDirs } = await import('../config');
  const { openDatabase } = await import('./connection');
  const cfg = loadConfig();
  ensureDirs(cfg);
  const db = openDatabase(cfg.dbPath);
  const applied = runMigrations(db, 'db/migrations');
  logger.info('migrate', 'done', { applied, dbPath: cfg.dbPath });
}
