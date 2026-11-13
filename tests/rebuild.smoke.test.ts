// P1-3 阶段 DoD「导出可重建档案验证」（PM §4 W8 门禁；02 §5.4 导出即完整备份）：
// 导出 JSON → 空库 → rebuildArchive（走 DAO 正常记录路径，与手工重新记录同构）→ 条数比对 + 逐条字段保真抽样。
// 另验：重复导入幂等（D2 永不产生第二条记录）、version 字段校验（拓展点 #11）、CLI --force 守卫。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { DAO } from '../src/server/db/dao';
import { parseExportPayload, rebuildArchive } from '../scripts/rebuild';

let dir: string;
let srcDb: Db;
let dao: DAO;

const add = (title: string, opts: { tags?: string[]; note?: string; listened?: string; precision?: 'day' | 'year'; favorite?: boolean; genres?: string[]; year?: number } = {}): void => {
  const { id: albumId } = dao.upsertAlbum({
    source: 'musicbrainz',
    source_id: `rb-${title}`,
    title,
    artist: `Artist of ${title}`,
    release_year: opts.year ?? 2012,
    genres: opts.genres ?? ['Electronic', 'Ambient']
  });
  const { id } = dao.createRecord({
    album_id: albumId,
    added_at: '2023-08-15T10:00:00.000Z',
    listened_at: opts.listened,
    listened_precision: opts.precision,
    note: opts.note
  });
  if (opts.tags) dao.setTags(id, opts.tags);
  if (opts.favorite) dao.updateRecord(id, { is_favorite: true });
};

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'mg-rebuild-'));
  srcDb = openDatabase(join(dir, 'src.db'));
  runMigrations(srcDb, 'db/migrations');
  dao = new DAO(srcDb);
  add('Blue Ocean', { tags: ['夜晚', '海边'], note: '青旅的天台', listened: '2023-08-15T00:00:00.000Z', precision: 'day', favorite: true });
  add('Paper Moon', { tags: ['通勤'], listened: '2022-01-01T00:00:00.000Z', precision: 'year', genres: ['Jazz'] });
  add('Quiet Note', { note: '', year: 1999 }); // 空串 note（防御排除口径）+ 无标签无听期（0 线索也导出）
});

after(() => {
  srcDb.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('导出可重建档案验证（P1-3 数据主权验收）', () => {
  const payloadOf = (): ReturnType<DAO['exportAll']> => dao.exportAll();

  test('导出 → 空库重建 → 条数比对 + 逐条字段保真（note/tags/listened/favorite/genres/year）', () => {
    const payload = payloadOf();
    assert.equal(payload.records.length, 3);
    assert.equal(payload.version, '2.0');

    const target = openDatabase(join(dir, 'rebuilt.db'));
    runMigrations(target, 'db/migrations');
    const summary = rebuildArchive(target, payload);
    assert.equal(summary.exported, 3);
    assert.equal(summary.rebuilt, 3);
    assert.equal(summary.skippedDuplicates, 0);
    assert.equal(summary.verified, true);

    const rdao = new DAO(target);
    const blue = rdao.listPage({ filters: { q: 'Blue Ocean' } }).items[0];
    assert.notEqual(blue, undefined);
    const detail = rdao.getRecord((blue as { id: string }).id);
    assert.equal(detail.note, '青旅的天台');
    assert.equal(detail.is_favorite, true);
    assert.equal(detail.listened_at, '2023-08-15T00:00:00.000Z');
    assert.equal(detail.listened_precision, 'day');
    assert.deepEqual(detail.tags.slice().sort(), ['夜晚', '海边']); // sort() = UTF-16 码点序
    assert.deepEqual(detail.album.genres, ['Electronic', 'Ambient']);
    assert.equal(detail.album.release_year, 2012);
    assert.equal(detail.added_at, '2023-08-15T10:00:00.000Z'); // added_at 事实保真

    // 线索覆盖率重建后与源库一致（北极星数据主权——线索也带得走）
    assert.equal(rdao.metricsCoverage().coverage, dao.metricsCoverage().coverage);
    target.close();
  });

  test('重复导入幂等：UNIQUE(user_id,album_id) → 跳过计数，永不产生第二条记录（D2）', () => {
    const target = openDatabase(join(dir, 'rebuilt2.db'));
    runMigrations(target, 'db/migrations');
    const first = rebuildArchive(target, payloadOf());
    assert.equal(first.rebuilt, 3);
    const second = rebuildArchive(target, payloadOf());
    assert.equal(second.rebuilt, 0);
    assert.equal(second.skippedDuplicates, 3);
    const rdao = new DAO(target);
    assert.equal(rdao.listPage({ limit: 60 }).meta.has_next, false);
    assert.equal(rdao.stats().records, 3);
    target.close();
  });

  test('version 字段校验（拓展点 #11）：缺 version / 缺 records → 拒绝重建', () => {
    assert.throws(() => parseExportPayload('{"records":[]}'), /version/);
    assert.throws(() => parseExportPayload('{"version":"2.0"}'), /records/);
    assert.throws(() => parseExportPayload('not-json'), /JSON|Unexpected/i);
    const ok = parseExportPayload('{"version":"2.0","exported_at":"t","records":[]}');
    assert.deepEqual(ok.records, []);
  });

  test('CLI 形状：缺 --force 拒绝覆盖已存在目标（退出码 2）；--force 重建成功且抽样 PASS（退出码 0）', () => {
    const jsonPath = join(dir, 'export.json');
    writeFileSync(jsonPath, JSON.stringify(payloadOf()));
    const dbPath = join(dir, 'cli.db');
    writeFileSync(dbPath, 'not-a-db'); // 预置目标触发 --force 守卫
    const base = ['--import', 'tsx', 'scripts/rebuild.ts', jsonPath, '--target', dbPath];
    const refused = spawnSync(process.execPath, base, { cwd: resolveCwd(), encoding: 'utf8' });
    assert.equal(refused.status, 2);
    assert.match(String(refused.stderr), /--force/);
    const okRun = spawnSync(process.execPath, [...base, '--force'], { cwd: resolveCwd(), encoding: 'utf8' });
    assert.equal(okRun.status, 0, `stderr: ${String(okRun.stderr)}`);
    assert.match(String(okRun.stdout), /PASS/);
    assert.match(String(okRun.stdout), /重建 3 条/);
  });
});

const resolveCwd = (): string => process.cwd();
