import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import type { Db } from './connection';
import { logger } from '../logger';

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

// 迁移执行器：顺序 SQL 文件 + PRAGMA user_version（ADR-001 / 评审 R2 注记：
// DDL 事务包裹，journal_mode 等 PRAGMA 不得在事务内——已在 connection 层处理）
export function runMigrations(db: Db, migrationsDir: string): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number | bigint } | undefined;
  const current = Number(row?.['user_version'] ?? 0);
  const files = readdirSync(migrationsDir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort();
  let applied = 0;
  for (const file of files) {
    const version = Number(file.slice(0, 4));
    if (version <= current) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
      applied++;
      logger.info('migrate', `applied ${file}`, { version });
    } catch (err) {
      db.exec('ROLLBACK');
      logger.error('migrate', `failed ${file}`, { err: String(err) });
      throw err;
    }
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
