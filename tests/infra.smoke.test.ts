// 基础设施冒烟：封面落盘（F3，零网络）+ 备份（R1/V14 按天去重与保留策略）
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { backupNow, pruneBackups } from '../src/server/db/backup';
import { CoverDownloadError, downloadCover } from '../src/server/metadata/covers';

describe('封面落盘（F3）', () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-cover-'));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('成功：sha1(source_id) 命名 + 幂等（第二次不触网）', async () => {
    const coversDir = join(dir, 'covers');
    let calls = 0;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const fetchFn = (async () => {
      calls++;
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    }) as typeof fetch;
    const name = await downloadCover({ coverUrl: 'https://coverartarchive.org/release/x/front-250', sourceId: 'src-1', coversDir, userAgent: 't', fetchFn });
    assert.match(name, /^[0-9a-f]{40}\.jpg$/);
    assert.equal(calls, 1);
    assert.ok(existsSync(join(coversDir, name)));
    const again = await downloadCover({ coverUrl: 'https://coverartarchive.org/release/x/front-250', sourceId: 'src-1', coversDir, userAgent: 't', fetchFn });
    assert.equal(again, name);
    assert.equal(calls, 1, '已落盘应跳过下载');
  });

  test('非图片响应 / 超过大小上限 → CoverDownloadError', async () => {
    const htmlFn = (async () => new Response('<html/>', { status: 200, headers: { 'Content-Type': 'text/html' } })) as typeof fetch;
    await assert.rejects(
      () => downloadCover({ coverUrl: 'u', sourceId: 's2', coversDir: join(dir, 'c2'), userAgent: 't', fetchFn: htmlFn }),
      CoverDownloadError
    );
    const big = new Uint8Array(64);
    big.fill(1);
    const bigFn = (async () => new Response(big, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })) as typeof fetch;
    await assert.rejects(
      () => downloadCover({ coverUrl: 'u', sourceId: 's3', coversDir: join(dir, 'c3'), userAgent: 't', fetchFn: bigFn, maxBytes: 8 }),
      CoverDownloadError
    );
  });
});

describe('备份（R1/V14）', () => {
  let dir: string;
  let db: Db;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-bk-'));
    db = openDatabase(join(dir, 't.db'));
    runMigrations(db, 'db/migrations');
  });
  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('VACUUM INTO 快照 + 同日去重 + 保留最近 7 天', () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups, { recursive: true });
    const f1 = backupNow(db, backups, new Date('2026-11-12T10:00:00'));
    assert.equal(f1, 'musicgraphy-20261112.db');
    assert.ok(f1 !== null && existsSync(join(backups, f1)));
    assert.equal(backupNow(db, backups, new Date('2026-11-12T18:00:00')), null, '同日应去重跳过');

    for (let d = 1; d <= 9; d++) {
      writeFileSync(join(backups, `musicgraphy-202611${String(d).padStart(2, '0')}.db`), 'x');
    }
    pruneBackups(backups, 7);
    const left = readdirSync(backups)
      .filter((f) => f.endsWith('.db'))
      .sort();
    assert.equal(left.length, 7);
    assert.equal(left[0], 'musicgraphy-20261104.db', '最旧的 3 份被清理');
  });
});
