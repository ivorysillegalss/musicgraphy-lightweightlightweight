// 备份（评审 R1 + 复审 V14）：VACUUM INTO 产出一致快照（W0 spike 实测 21ms/5000 行），
// 触发 = 启动时 + 每日定时（server.ts 接线）；按天去重（当日已存在则跳过）；保留最近 7 天
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './connection';

const BACKUP_FILE = /^musicgraphy-(\d{8})\.db$/;

/** 返回新建备份文件名；当日已有备份返回 null（跳过） */
export function backupNow(db: Db, backupsDir: string, now = new Date()): string | null {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const name = `musicgraphy-${y}${m}${d}.db`;
  const target = join(backupsDir, name);
  if (existsSync(target)) return null;
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  pruneBackups(backupsDir, 7);
  return name;
}

/** 按文件名日期倒序保留最近 keepDays 份 */
export function pruneBackups(backupsDir: string, keepDays: number): void {
  const files = readdirSync(backupsDir)
    .map((f) => {
      const m = BACKUP_FILE.exec(f);
      return m === null ? null : { f, day: m[1] ?? '' };
    })
    .filter((x): x is { f: string; day: string } => x !== null)
    .sort((a, b) => b.day.localeCompare(a.day));
  for (const old of files.slice(keepDays)) {
    try {
      unlinkSync(join(backupsDir, old.f));
    } catch {
      // 单个删除失败不阻塞（下次窗口重试）
    }
  }
}
