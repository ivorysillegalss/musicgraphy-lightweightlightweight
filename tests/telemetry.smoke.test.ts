// 行为埋点冒烟（W8-9 立项 2026-11-15 · PRD §6 行为类四仪表数据源 · 评审案 docs/telemetry-review.md）：
// 0005 telemetry_days 天粒度计数 / opt-out 停记（mg_metrics=closed）/ 搜索·导出·详情·曝光·归因接线 / 28 天窗口实算
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Context, Hono } from 'hono';
import { createApp } from '../src/server/app';
import { loadConfig, type Config } from '../src/server/config';
import { DAO } from '../src/server/db/dao';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { createTelemetry, localDay, WINDOW_DAYS } from '../src/server/db/telemetry';

interface CoverageBody {
  data: {
    coverage: number | null;
    search_fail_rate: number | null;
    echo_ctr: number | null;
    note_revisit_rate: number | null;
    export_usage: number | null;
    notes: Partial<Record<string, string>>;
  };
}

/** 最小 Context 形状（hono/cookie getCookie 只读 header）——gate 单测用 */
const ctxOf = (cookie?: string): Context => {
  const raw = new Request('http://localhost/', { headers: cookie ? { cookie } : {} });
  return { req: { raw, header: (n: string) => raw.headers.get(n) } } as unknown as Context;
};

describe('行为埋点（W8-9 立项 · PRD §6 · 评审案 docs/telemetry-review.md）', () => {
  let dir: string;
  let db: Db;
  let dao: DAO;
  let cfg: Config;
  let app: Hono;
  let G: RequestInit;
  let session: string;
  let now: Date;
  let rec: ReturnType<typeof createTelemetry>;
  const r1 = { recordId: '', albumId: '' };
  const r2 = { recordId: '', albumId: '' };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mg-telemetry-'));
    db = openDatabase(join(dir, 't.db'));
    runMigrations(db, 'db/migrations');
    dao = new DAO(db);
    cfg = loadConfig();
    now = new Date('2026-11-15T12:00:00'); // 假时钟（本地时区解析）：day = 2026-11-15
    rec = createTelemetry(db, { nowFn: () => now });
    app = createApp(dao, cfg, [], { telemetry: rec });
    G = { headers: { Authorization: `Bearer ${cfg.accessKey}` } };
    // 页面通道需会话（D1 修复后 use('/*') 全路径 302 守卫）：POST /login 换 cookie
    const login = await app.request('/login', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `access_key=${encodeURIComponent(cfg.accessKey)}`
    });
    assert.equal(login.status, 303);
    session = /mg_session=[^;]*/.exec(login.headers.get('Set-Cookie') ?? '')?.[0] ?? '';
    assert.notEqual(session, '');
    // 种子两张记录：r1 添加于「今天」（无线索）；r2 note 线索、added_at 由测试内改为一年前
    r1.albumId = dao.upsertAlbum({ source: 'musicbrainz', source_id: 'tel-1', title: 'Tel One', artist: 'A1', release_year: 2020, genres: [], cover_url: null }).id;
    r1.recordId = dao.createRecord({ album_id: r1.albumId, note: null, listened_at: null, listened_precision: null }).id;
    r2.albumId = dao.upsertAlbum({ source: 'musicbrainz', source_id: 'tel-2', title: 'Tel Two', artist: 'A2', release_year: 2021, genres: [], cover_url: null }).id;
    r2.recordId = dao.createRecord({ album_id: r2.albumId, note: '为什么留下它', listened_at: null, listened_precision: null }).id;
    db.prepare(`UPDATE collection_record SET added_at = ? WHERE id = ?`).run('2026-11-15T09:00:00', r1.recordId); // 添加当日（回访排除）
    db.prepare(`UPDATE collection_record SET added_at = ? WHERE id = ?`).run('2025-11-15T10:00:00Z', r2.recordId); // 一年前（回访命中）
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('0005 迁移：telemetry_days 表在档（不硬编码 user_version——netease.smoke 教训）', () => {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'telemetry_days'`).get();
    assert.ok(row, 'telemetry_days 表必须存在');
  });

  test('opt-out 停记：mg_metrics=closed → 不记录；无 cookie → 记录（评审案 Q3）', () => {
    const before0 = rec.windowSums('2000-01-01').export_cnt;
    rec.exported(ctxOf('mg_metrics=closed'));
    assert.equal(rec.windowSums('2000-01-01').export_cnt, before0, 'closed 必须停记');
    rec.exported(ctxOf());
    assert.equal(rec.windowSums('2000-01-01').export_cnt, before0 + 1);
  });

  test('搜索零结果 = 失败口径：空源链 200 {data:[]} → search_total=1 search_fail=1', async () => {
    const res = await app.request('/api/v1/search/albums?q=zzzzzz', G);
    assert.equal(res.status, 200);
    const w = rec.windowSums('2000-01-01');
    assert.equal(w.search_total, 1);
    assert.equal(w.search_fail, 1);
  });

  test('详情视图：添加当日不记回访；?from=echo 归因 echo_click；一年前 note 记回访', async () => {
    const H = { headers: { Cookie: session } };
    assert.equal((await app.request(`/album/${r1.recordId}`, H)).status, 200); // 添加当日：detail_view only
    assert.equal((await app.request(`/album/${r1.recordId}?from=echo`, H)).status, 200); // 归因：echo_click
    assert.equal((await app.request(`/album/${r2.recordId}`, H)).status, 200); // 一年前 note：note_view
    const w = rec.windowSums('2000-01-01');
    assert.equal(w.detail_view, 3);
    assert.equal(w.note_view, 1);
    assert.equal(w.echo_click, 1);
  });

  test('导出计数：GET /api/v1/export 200 → export_cnt+1 且 export_days=1', async () => {
    const res = await app.request('/api/v1/export', G);
    assert.equal(res.status, 200);
    const w = rec.windowSums('2000-01-01');
    assert.equal(w.export_cnt, 2); // gate 测试已 +1
    assert.equal(w.export_days, 1);
  });

  test('coverage 实算：28 天窗口四值 + notes 仅 null 字段（实算后移除）+ 端点与 DAO 同值', () => {
    db.prepare(`INSERT INTO telemetry_days (day, echo_shown, echo_click, updated_at) VALUES (?, 8, 0, ?) ON CONFLICT(day) DO UPDATE SET echo_shown = echo_shown + 8`).run(localDay(now), now.toISOString());
    const d = dao.metricsCoverage();
    const w = rec.windowSums(localDay(now));
    assert.equal(d.coverage, 0.5); // r1 无线索 / r2 note 线索
    assert.equal(d.search_fail_rate, 1); // 1 败 / 1 会话
    assert.equal(d.echo_ctr, w.echo_click / w.echo_shown); // 曝光 8 + 点击 1（路由归因）
    assert.equal(d.note_revisit_rate, 1 / 3); // note_view 1 / detail_view 3
    const ageDays = Math.max(1, Math.floor((Date.now() - Date.parse('2025-11-15T10:00:00Z')) / 86_400_000) + 1);
    assert.equal(d.export_usage, w.export_days / Math.min(WINDOW_DAYS, ageDays));
    assert.equal(Object.keys(d.notes).length, 0, '四项全部实算后 notes 必须清空');
  });

  test('窗口排除：day 早于窗口起点（>28 天前）不计入聚合', () => {
    const oldDay = localDay(new Date(now.getTime() - 30 * 86_400_000));
    db.prepare(`INSERT INTO telemetry_days (day, echo_shown, updated_at) VALUES (?, 999, ?)`).run(oldDay, now.toISOString());
    const d = dao.metricsCoverage();
    assert.equal(d.echo_ctr, rec.windowSums(localDay(now)).echo_click / rec.windowSums(localDay(now)).echo_shown);
    assert.ok(d.echo_ctr !== undefined && d.echo_ctr !== null);
  });

  test('端点与 DAO 同值（{data} 包裹）', async () => {
    const res = await app.request('/api/v1/metrics/coverage', G);
    assert.equal(res.status, 200);
    const d = (JSON.parse(await res.text()) as CoverageBody).data;
    const m = dao.metricsCoverage();
    assert.equal(d.echo_ctr, m.echo_ctr);
    assert.equal(d.export_usage, m.export_usage);
    assert.equal(d.note_revisit_rate, m.note_revisit_rate);
  });

  test('跨日分行：nowFn 推进一天 → 新行（同日累加不串行）', () => {
    now = new Date('2026-11-16T08:00:00');
    rec.echoShown(ctxOf());
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM telemetry_days`).get() as { n: number };
    assert.equal(Number(rows.n), 3); // 11-15 + 窗口外旧行 + 11-16
    assert.equal(rec.windowSums('2026-11-16').echo_shown, 1);
  });
});
