import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as sqlite from 'node:sqlite';
import { logger } from '../logger';

// DAO 驱动隔离（F2 / 复审 FC1-FC2）：node:sqlite 处于 DatabaseSync→Database 类改名期（DEP0210/0211）。
// 运行时优先用新名 Database（26+），不存在则回退 DatabaseSync（同形，24 可用）——"回退=换一个文件"的一部分。
type SqliteModule = typeof sqlite;
const mod = sqlite as SqliteModule & { Database?: typeof sqlite.DatabaseSync };
const DbClass = mod.Database ?? mod.DatabaseSync;

export type Db = sqlite.DatabaseSync;

export function openDatabase(dbPath: string): Db {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DbClass(dbPath) as Db;
  // PRAGMA 基线（ADR-001 + 评审 R2/R8 + 复审 V13）：
  // journal_mode 持久且必须在事务外设置；其余 per-connection，打开例程统一执行（最易漏 foreign_keys）
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec('PRAGMA cache_size=-8000'); // 8MB，显式封顶
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('PRAGMA busy_timeout=5000');
  logger.debug('db', 'opened', { dbPath });
  return db;
}
