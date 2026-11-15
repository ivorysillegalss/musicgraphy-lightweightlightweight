// 观察池仪表冒烟（PRD §6 / 02 §4 metrics 行）：覆盖率对种子库手工核算值断言（北极星口径：
// ≥1 根线索 Note/Tag/听期）· 空档案 0/0 → null · 行为类四项 28 天窗口实算（W8-9 立项 2026-11-15，
// 评审案 docs/telemetry-review.md）——本文件无埋点实例 → 窗口无样本 → null + notes 口径说明 · 鉴权守卫
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Hono } from 'hono';
import { createApp } from '../src/server/app';
import { loadConfig, type Config } from '../src/server/config';
import { DAO } from '../src/server/db/dao';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';

interface CoverageBody {
  data: {
    coverage: number | null;
    search_fail_rate: number | null;
    named_view_rate: number | null;
    echo_ctr: number | null;
    note_revisit_rate: number | null;
    export_usage: number | null;
    generated_at: string;
    notes: Partial<Record<string, string>>;
  };
}

describe('观察池仪表（PRD §6，02 §4 metrics 行）', () => {
  let dir: string;
  let db: Db;
  let dao: DAO;
  let cfg: Config;
  let app: Hono;
  let G: RequestInit;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mg-metrics-'));
    db = openDatabase(join(dir, 't.db'));
    runMigrations(db, 'db/migrations');
    dao = new DAO(db);
    cfg = loadConfig();
    app = createApp(dao, cfg, []);
    G = { headers: { Authorization: `Bearer ${cfg.accessKey}` } };
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('空档案：coverage = null（0/0 无定义）+ 行为类四项窗口无样本 null + notes 口径说明 + {data} 包裹', async () => {
    const res = await app.request('/api/v1/metrics/coverage', G);
    assert.equal(res.status, 200);
    const d = (JSON.parse(await res.text()) as CoverageBody).data;
    assert.equal(d.coverage, null);
    for (const k of ['search_fail_rate', 'echo_ctr', 'note_revisit_rate', 'export_usage'] as const) {
      assert.equal(d[k], null, `${k} 窗口无样本必须 null（勿伪造数字）`);
      assert.ok((d.notes[k] ?? '').length > 0, `${k} 无样本须附口径/无样本说明`);
    }
    // named_view_rate：P1-10 saved_views 落地后实算（2026-11-14 用户批准）——空档案无视图仍 null，但 notes 缺口说明已移除
    assert.equal(d.named_view_rate, null);
    assert.ok(!('named_view_rate' in d.notes));
    assert.ok(!Number.isNaN(Date.parse(d.generated_at)));
  });

  test('未带凭据 → 401（/api/v1/* 全局守卫，metrics 不豁免）', async () => {
    const res = await app.request('/api/v1/metrics/coverage');
    assert.equal(res.status, 401);
  });

  test('种子 6 张手工核算：covered=3（note/tag/听期各一）→ coverage = 3/6 = 0.5', async () => {
    // 手工核算口径：r0 note 命中；r1 tag 命中；r2 听期命中；r3 仅 favorite（非根线索）；
    // r4 note='' 空串（writes 不归一空串，SQL 防御性排除）；r5 全空（非线索）
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const { id: albumId } = dao.upsertAlbum({
        source: 'musicbrainz',
        source_id: `met-${i}`,
        title: `Metrics ${i}`,
        artist: `Artist ${i}`,
        release_year: 2000 + i,
        genres: ['Jazz'],
        cover_url: null
      });
      const { id } = dao.createRecord({ album_id: albumId, note: null, listened_at: null, listened_precision: null });
      ids.push(id);
    }
    dao.updateRecord(ids[0]!, { note: '为什么留下它' });
    dao.setTags(ids[1]!, ['夜晚']);
    dao.updateRecord(ids[2]!, { listened_at: '2025-01-02T00:00:00Z', listened_precision: 'day' });
    dao.updateRecord(ids[3]!, { is_favorite: true });
    dao.updateRecord(ids[4]!, { note: '' });

    const d = dao.metricsCoverage();
    assert.equal(d.coverage, 0.5);
    assert.equal(d.search_fail_rate, null);
    assert.equal(d.echo_ctr, null);
  });

  test('种子后 HTTP 端点与 DAO 同值（端点形状 = {data}，notes 仍在）', async () => {
    const res = await app.request('/api/v1/metrics/coverage', G);
    assert.equal(res.status, 200);
    const d = (JSON.parse(await res.text()) as CoverageBody).data;
    assert.equal(d.coverage, dao.metricsCoverage().coverage);
    assert.equal(d.coverage, 0.5);
    assert.equal(d.named_view_rate, dao.metricsCoverage().named_view_rate); // P1-10 落地后实算，端点与 DAO 同值
    assert.equal(d.notes['named_view_rate'], undefined); // 缺口说明随实算移除
  });
});
