// ============================================================
// Musicgraphy 2.0 · 文档包可用性单元测试（2026-11-14 用户新原则）
// 「所有内容修改完毕后需通过单元测试确保可用性」的落地。
// 运行（cwd = 文档包根）：node --test tests/
// 零依赖（node:test + node:assert）；覆盖：
//   ① 看板数据结构完整性（meta/tracks/卡片字段/状态枚举/日期格式）
//   ② 依赖引用完整性（deps 必须指向存在的卡）
//   ③ 渲染三件套衔接（index.html ↔ progress-data.js ↔ app.js）
//   ④ 事实源文档在档（核心规格/裁决/评审案/协议）
//   ⑤ 登记完整性（IM 编号顺延、追认补记、00 索引同步）
//   ⑥ 日报页三件套衔接（daily.html/daily.js/daily-reports.js，2026-11-14 用户裁决新开）
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KB = join(ROOT, '08-进度看板');

globalThis.window = {};
const require = createRequire(import.meta.url);
require(join(KB, 'progress-data.js'));
const D = globalThis.window.MG_PROGRESS;

const STATUS = new Set(['done', 'in_progress', 'pending', 'blocked', 'watch']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

test('看板：meta 完整', () => {
  assert.ok(D, 'window.MG_PROGRESS 必须存在');
  for (const k of ['project', 'line', 'mainlineRepo', 'lastSync', 'syncNote']) {
    assert.ok(D.meta[k], `meta.${k} 非空`);
  }
  assert.match(D.meta.lastSync, DATE_RE, 'meta.lastSync 格式 YYYY-MM-DD');
});

test('看板：tracks 主线结构合法', () => {
  assert.ok(Array.isArray(D.tracks) && D.tracks.length >= 6, 'tracks >= 6 条主线');
  const trackIds = new Set();
  for (const tr of D.tracks) {
    for (const k of ['id', 'short', 'title', 'subtitle', 'status']) {
      assert.ok(tr[k], `track.${k} 非空 (${tr.id || '未知'})`);
    }
    assert.ok(STATUS.has(tr.status), `track.status 合法 (${tr.id})`);
    assert.equal(typeof tr.counted, 'boolean', `track.counted 布尔 (${tr.id})`);
    assert.ok(Array.isArray(tr.cards) && tr.cards.length > 0, `track.cards 非空 (${tr.id})`);
    assert.ok(!trackIds.has(tr.id), `track.id 唯一 (${tr.id})`);
    trackIds.add(tr.id);
  }
});

test('看板：卡片完整性 + id 全局唯一', () => {
  const ids = new Set();
  for (const tr of D.tracks) {
    for (const c of tr.cards) {
      assert.ok(c.id && !ids.has(c.id), `卡 id 存在且唯一 (${c.id || '缺 id'})`);
      ids.add(c.id);
      assert.ok(c.title, `卡 title 非空 (${c.id})`);
      assert.ok(STATUS.has(c.status), `卡 status 合法 (${c.id}: ${c.status})`);
      assert.ok(c.evidence && c.evidence.length > 5, `卡 evidence 非空 (${c.id})`);
      assert.ok(DATE_RE.test(c.updated || ''), `卡 updated 格式 YYYY-MM-DD (${c.id}: ${c.updated})`);
    }
  }
});

test('看板：deps 前置依赖引用完整性', () => {
  const ids = new Set();
  for (const tr of D.tracks) for (const c of tr.cards) ids.add(c.id);
  for (const tr of D.tracks) {
    for (const c of tr.cards) {
      for (const dep of c.deps || []) {
        assert.ok(ids.has(dep), `${c.id} 的前置依赖 ${dep} 必须指向存在的卡`);
      }
    }
  }
});

const SCOPE_VOCAB = new Set([
  '工程规范与骨架', '存储与迁移', '鉴权与会话', 'API 路由', '元数据与外部源',
  '封面管线', '备份与恢复', '导出与重建', 'SSR 页面', '前端岛屿',
  '设计 tokens 与 CSS', '仪表与埋点', '脚本与 CLI', '测试', '文档包', '看板与部署',
]);

test('看板：需求卡表格字段完整性（2026-11-15 展现改版 §7④）', () => {
  let n = 0;
  for (const tr of D.tracks) {
    for (const c of tr.cards) {
      n++;
      assert.ok(c.brief && c.brief.length > 0, `卡 brief 简要描述非空 (${c.id})`);
      assert.ok(c.desc && c.desc.length > 5, `卡 desc 详细描述非空 (${c.id})`);
      assert.ok(DATE_RE.test(c.confirmed || ''), `卡 confirmed 需求确认日期格式 (${c.id}: ${c.confirmed})`);
      assert.ok(Array.isArray(c.scope) && c.scope.length >= 1, `卡 scope 涉及范围非空 (${c.id})`);
      for (const s of c.scope) {
        assert.ok(SCOPE_VOCAB.has(s), `卡 scope 标签在固定词表内 (${c.id}: ${s})`);
      }
      assert.ok(Array.isArray(c.history) && c.history.length >= 1, `卡 history 更新历史非空 (${c.id})`);
      for (const h of c.history) {
        assert.ok(/^v\d+$/.test(h.v || ''), `history.v 版本号 (${c.id})`);
        assert.ok(DATE_RE.test(h.date || ''), `history.date 格式 (${c.id})`);
        assert.ok(h.note && h.note.length > 0, `history.note 非空 (${c.id})`);
      }
    }
  }
  assert.ok(n >= 44, `全板卡片数 >= 44（实数 ${n}）`);
  const special = D.tracks.find((t) => t.id === 'SPECIAL');
  assert.ok(special && special.cards.some((c) => c.id === 'S2-2') && special.cards.some((c) => c.id === 'S2-3'),
    '⑦ 专项主线专区在档且 S2-2/S2-3 已移入（2026-11-15 用户令）');
});

test('看板：relations 与 notes 完整', () => {
  assert.ok(Array.isArray(D.relations) && D.relations.length >= 6, 'relations >= 6 条');
  for (const r of D.relations) {
    for (const k of ['from', 'to', 'type', 'text']) assert.ok(r[k], `relation.${k} 非空`);
  }
  assert.ok(Array.isArray(D.notes) && D.notes.length >= 10, 'notes >= 10 条');
  for (const n of D.notes) {
    assert.ok(['info', 'warn'].includes(n.level), 'note.level 合法');
    assert.ok(n.text, 'note.text 非空');
  }
});

test('渲染三件套在档且互相衔接', () => {
  for (const f of ['index.html', 'app.js', 'progress-data.js']) {
    assert.ok(existsSync(join(KB, f)), `08-进度看板/${f} 在档`);
  }
  const html = readFileSync(join(KB, 'index.html'), 'utf8');
  assert.ok(html.includes('src="progress-data.js"'), 'index.html 引入 progress-data.js');
  assert.ok(html.includes('src="app.js"'), 'index.html 引入 app.js');
  const appjs = readFileSync(join(KB, 'app.js'), 'utf8');
  assert.ok(appjs.includes('D.tracks'), 'app.js 渲染 tracks 主线视图');
  assert.ok(!/\.innerHTML\s*=/.test(appjs), 'app.js 保持零 innerHTML 赋值（注释提及不算，安全姿态 = textContent 注入）');
});

test('看板日报页三件套在档且互相衔接（2026-11-14 用户裁决新开）', () => {
  for (const f of ['daily.html', 'daily.js', 'daily-reports.js']) {
    assert.ok(existsSync(join(KB, f)), `08-进度看板/${f} 在档`);
  }
  const dailyHtml = readFileSync(join(KB, 'daily.html'), 'utf8');
  assert.ok(dailyHtml.includes('src="daily-reports.js"'), 'daily.html 引入 daily-reports.js');
  assert.ok(dailyHtml.includes('src="daily.js"'), 'daily.html 引入 daily.js');
  assert.ok(dailyHtml.includes('index.html'), 'daily.html 含返回看板入口');
  const dailyJs = readFileSync(join(KB, 'daily.js'), 'utf8');
  assert.ok(!/\.innerHTML\s*=/.test(dailyJs), 'daily.js 保持零 innerHTML 赋值（安全姿态 = textContent 注入）');
  const indexHtml = readFileSync(join(KB, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('daily.html'), 'index.html 含日报页入口链接');
  globalThis.window = {};
  require(join(KB, 'daily-reports.js'));
  const R = globalThis.window.MG_DAILY_REPORTS;
  assert.ok(R && R.meta && Array.isArray(R.reports) && R.reports.length >= 1, 'MG_DAILY_REPORTS.reports 非空');
  for (const r of R.reports) {
    assert.ok(DATE_RE.test(r.date), `report.date 格式 YYYY-MM-DD (${r.date})`);
    assert.ok(r.title && r.summary, `report.title/summary 非空 (${r.date})`);
    assert.ok(Array.isArray(r.stats) && r.stats.length > 0, `report.stats 非空 (${r.date})`);
    assert.ok(Array.isArray(r.sections) && r.sections.length > 0, `report.sections 非空 (${r.date})`);
    for (const s of r.sections) {
      assert.ok(s.heading, `section.heading 非空 (${r.date})`);
      assert.ok(Array.isArray(s.items) && s.items.length > 0, `section.items 非空 (${r.date}/${s.heading})`);
      for (const item of s.items) {
        assert.ok(
          (typeof item === 'string' && item.length > 0) || (item && typeof item === 'object' && item.text),
          `section item 内容非空 (${r.date}/${s.heading})`,
        );
      }
    }
    assert.ok(Array.isArray(r.evidence) && r.evidence.length > 0, `report.evidence 非空 (${r.date})`);
  }
});

test('事实源文档在档（核心规格/裁决/评审案/协议）', () => {
  for (const f of [
    '00-工作区关系与硬约束.md',
    '00-文件目录说明.txt',
    '02-变现文档包/01-PRD-产品需求文档.md',
    '02-变现文档包/02-数据模型与API设计.md',
    '05-系统架构设计/实现决策记录.md',
    '05-系统架构设计/评审案-多用户并发与封面缓存.md',
    '05-系统架构设计/评审案-网易云专辑导入器.md',
    '06-PM排期与研发可持续性计划.md',
    '07-前端设计包/02-前端实现拆分方案.md',
    '08-进度看板/看板更新协议.md',
  ]) {
    assert.ok(existsSync(join(ROOT, f)), `${f} 在档`);
  }
});

test('登记完整性：IM 编号顺延 + 追认补记在档', () => {
  const im = readFileSync(join(ROOT, '05-系统架构设计/实现决策记录.md'), 'utf8');
  for (const n of ['IM-14', 'IM-17', 'IM-21', 'IM-22', 'IM-23']) {
    assert.ok(im.includes(n), `实现决策记录含 ${n}`);
  }
  assert.ok(im.includes('追认补记（2026-11-14）'), 'IM-14/IM-17 追认补记在档');
});

test('00 索引同步：新需求评审案已登记（文档包同步纪律）', () => {
  const idx = readFileSync(join(ROOT, '00-文件目录说明.txt'), 'utf8');
  assert.ok(idx.includes('网易云专辑导入器'), '00 索引含网易云导入器评审案');
  assert.ok(idx.includes('多用户并发'), '00 索引含多用户并发评审案');
});
