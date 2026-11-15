// ============================================================
// Musicgraphy 2.0 · 进度看板渲染器（a-b-c-d 步骤链 + 需求卡表格视图）
// 2026-11-15 展现改版第二则（用户裁决，协议 §7④ 已登记）：
//   各主线内卡片按串行依赖序呈现为步骤链（步标 a/b/c/d…），
//   每卡以统一表格呈现（需求所属专项 / 需求状态 / 需求确认日期 /
//   需求内容 = 简要 + 详细 / 更新历史 / 需求涉及范围 / 前置依赖 / 证据），
//   并新增「需求并行度统计」区（scope 域标签 → 共享卡列表）。
//   ⑦ 专项主线（跨线专项归口）与其他主线走完全相同的渲染——同类型设计参考。
//   进度数据本身仍只存在于 progress-data.js——本文件不含任何具体进度。
// 安全姿态不变：零外部请求、零 eval、零 innerHTML——数据一律 textContent 注入。
// 新表格 CSS 由本文件动态注入（复用 index.html 既有 MASTER token 变量；
//   index.html 展示壳未动——协议 §5/§7④）。
// 数据源：progress-data.js（window.MG_PROGRESS，结构 = meta + tracks + relations + notes）
// ============================================================
(function () {
  'use strict';

  var STATUS_LABEL = {
    done: { label: '已完成', cls: 'st-done' },
    in_progress: { label: '进行中', cls: 'st-progress' },
    pending: { label: '待办', cls: 'st-pending' },
    blocked: { label: '受阻', cls: 'st-blocked' },
    watch: { label: '护栏', cls: 'st-watch' },
  };
  var TRACK_LABEL = {
    done: '主线完成', in_progress: '主线进行中', pending: '主线待启动', blocked: '受阻', watch: '持续观察',
  };

  // 注入样式（仅用 index.html 既有 CSS 变量，不引入外部资源）
  var CSS = [
    '.chain { display: flex; flex-direction: column; }',
    '.step { background: var(--color-card); border: 1px solid var(--color-border); border-left: 3px solid var(--color-border); border-radius: 8px; padding: 12px 14px; }',
    '.step.st-done { border-left-color: var(--color-ok); }',
    '.step.st-progress { border-left-color: var(--color-accent); }',
    '.step.st-blocked { border-left-color: var(--color-destructive); }',
    '.step.st-watch { border-left-color: var(--color-secondary); }',
    '.step-link { margin: 4px 0 4px 30px; color: var(--color-accent-text); font-family: var(--font-mono); font-size: 12px; }',
    '.step-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }',
    '.step-badge { font-family: var(--font-mono); font-weight: 700; font-size: 13px; color: var(--color-on-primary); background: var(--color-primary); border-radius: 6px; padding: 1px 9px; }',
    '.step-id { font-family: var(--font-mono); font-size: 12px; color: var(--color-secondary); }',
    '.step-title { font-size: 14px; font-weight: 600; }',
    '.req-table { width: 100%; border-collapse: collapse; font-size: 12px; }',
    '.req-table th { text-align: left; vertical-align: top; white-space: nowrap; width: 104px; padding: 6px 10px 6px 0; color: var(--color-accent-text); font-weight: 600; border-top: 1px dashed var(--color-border); }',
    '.req-table td { vertical-align: top; padding: 6px 0; border-top: 1px dashed var(--color-border); }',
    '.req-table tr:first-child th, .req-table tr:first-child td { border-top: none; }',
    '.mono-cell { font-family: var(--font-mono); font-size: 11px; }',
    '.brief-key { color: var(--color-accent-text); font-weight: 700; margin-right: 4px; }',
    '.brief-line { color: var(--color-foreground); font-weight: 600; }',
    '.detail-line { color: var(--color-muted-foreground); margin-top: 3px; font-weight: 400; }',
    '.hist-list { list-style: none; padding: 0; margin: 0; }',
    '.hist-list li { padding: 1px 0; }',
    '.hist-v { font-family: var(--font-mono); color: var(--color-accent-text); font-weight: 700; margin-right: 6px; }',
    '.hist-date { font-family: var(--font-mono); color: var(--color-secondary); margin-right: 6px; }',
    '.scope-chip { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 9px; margin: 0 4px 3px 0; border-radius: 999px; background: var(--color-muted); border: 1px solid var(--color-border); color: var(--color-muted-foreground); }',
    '.scope-hint { margin-top: 4px; font-size: 11px; color: var(--color-secondary); }',
    '.ev-cell { font-family: var(--font-mono); font-size: 11px; color: var(--color-muted-foreground); background: var(--color-muted); border: 1px dashed var(--color-border); border-radius: 6px; padding: 6px 8px; word-break: break-word; }',
    '.par-note { font-size: 12px; color: var(--color-muted-foreground); margin-bottom: 10px; }',
    '.par-table { width: 100%; border-collapse: collapse; font-size: 12px; background: var(--color-card); border: 1px solid var(--color-border); }',
    '.par-table th { text-align: left; padding: 6px 10px; background: var(--color-muted); color: var(--color-muted-foreground); border-bottom: 1px solid var(--color-border); white-space: nowrap; }',
    '.par-table td { padding: 6px 10px; border-bottom: 1px dashed var(--color-border); vertical-align: top; }',
  ].join('\n');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  // id → { card, track } 索引：供依赖行标注「卡号 标题（所属主线）」
  var INDEX = {};

  function buildIndex(D) {
    INDEX = {};
    (D.tracks || []).forEach(function (tr) {
      (tr.cards || []).forEach(function (c) { INDEX[c.id] = { card: c, track: tr }; });
    });
  }

  function depLabel(id) {
    var hit = INDEX[id];
    return hit ? id + ' ' + hit.card.title + '（' + hit.track.short + '）' : id;
  }

  // 步标：主线内依赖序 a, b, c, d …（超出 26 步回退 w27 形式）
  function stepLabel(i) {
    return i < 26 ? String.fromCharCode(97 + i) : 'w' + (i + 1);
  }

  function trackCount(tr) {
    var done = 0, total = 0;
    (tr.cards || []).forEach(function (t) {
      if (t.status === 'watch') return;
      total++;
      if (t.status === 'done') done++;
    });
    return { done: done, total: total };
  }

  // 并行度统计：scope 域标签 → 卡列表（基于全板数据，不随筛选变化）
  function buildScopeMap(D) {
    var map = {};
    (D.tracks || []).forEach(function (tr) {
      (tr.cards || []).forEach(function (c) {
        (c.scope || []).forEach(function (s) {
          if (!map[s]) map[s] = [];
          map[s].push({ id: c.id, track: tr.short });
        });
      });
    });
    return map;
  }

  function scopeHint(c, scopeMap) {
    var seen = {}, ids = [];
    (c.scope || []).forEach(function (s) {
      (scopeMap[s] || []).forEach(function (m) {
        if (m.id === c.id || seen[m.id]) return;
        seen[m.id] = true;
        ids.push(m.id);
      });
    });
    if (!ids.length) return '当前无同域卡——与任一异域需求可并行。';
    var head = ids.slice(0, 8).join('、');
    return '同域卡 ' + ids.length + ' 张（' + head + (ids.length > 8 ? ' 等' : '') +
      '）——涉同域须串行协调；全异域组合可并行。';
  }

  function stepCard(t, tr, seq, scopeMap) {
    var meta = STATUS_LABEL[t.status] || STATUS_LABEL.pending;
    var art = el('article', 'step ' + meta.cls);
    var head = el('div', 'step-head');
    head.appendChild(el('span', 'step-badge', stepLabel(seq)));
    head.appendChild(el('span', 'step-id', t.id));
    head.appendChild(el('span', 'step-title', t.title));
    head.appendChild(el('span', 'chip ' + meta.cls, meta.label));
    art.appendChild(head);

    var table = el('table', 'req-table');
    var tbody = el('tbody');
    function row(thText, tdNode) {
      var r = el('tr');
      r.appendChild(el('th', null, thText));
      r.appendChild(tdNode);
      tbody.appendChild(r);
    }

    row('需求所属专项', el('td', null, tr.title));
    var stTd = el('td');
    stTd.appendChild(el('span', 'chip ' + meta.cls,
      meta.label + (tr.counted === false ? ' · 护栏观察不计数' : '')));
    row('需求状态', stTd);
    row('需求确认日期', el('td', 'mono-cell', t.confirmed || '—'));

    var cTd = el('td');
    var brief = el('div', 'brief-line');
    brief.appendChild(el('span', 'brief-key', '简要：'));
    brief.appendChild(el('span', null, t.brief || '—'));
    cTd.appendChild(brief);
    var detail = el('div', 'detail-line');
    detail.appendChild(el('span', 'brief-key', '详细：'));
    detail.appendChild(el('span', null, t.desc || '—'));
    cTd.appendChild(detail);
    row('需求内容', cTd);

    var hTd = el('td');
    if (t.history && t.history.length) {
      var ul = el('ul', 'hist-list');
      t.history.forEach(function (h) {
        var li = el('li');
        li.appendChild(el('span', 'hist-v', h.v || ''));
        li.appendChild(el('span', 'hist-date', h.date || ''));
        li.appendChild(el('span', null, h.note || ''));
        ul.appendChild(li);
      });
      hTd.appendChild(ul);
    } else {
      hTd.appendChild(el('span', null, '—'));
    }
    row('更新历史', hTd);

    var sTd = el('td');
    if (t.scope && t.scope.length) {
      t.scope.forEach(function (s) { sTd.appendChild(el('span', 'scope-chip', s)); });
    } else {
      sTd.appendChild(el('span', null, '—'));
    }
    sTd.appendChild(el('div', 'scope-hint', '并行度：' + scopeHint(t, scopeMap)));
    row('需求涉及范围', sTd);

    row('前置依赖', el('td', 'mono-cell',
      t.deps && t.deps.length ? t.deps.map(depLabel).join(' · ') : '—（无显式前置依赖）'));

    var eTd = el('td', 'ev-cell');
    eTd.appendChild(el('span', 'ev-key', '证据'));
    eTd.appendChild(el('span', null, t.evidence || '—'));
    row('证据', eTd);

    if (t.origin || t.note) {
      var oTd = el('td');
      if (t.origin) {
        var o1 = el('div', 'detail-line');
        o1.appendChild(el('span', 'brief-key', '卡源：'));
        o1.appendChild(el('span', null, t.origin));
        oTd.appendChild(o1);
      }
      if (t.note) {
        var o2 = el('div', 'detail-line');
        o2.appendChild(el('span', 'brief-key', '备注：'));
        o2.appendChild(el('span', null, t.note));
        oTd.appendChild(o2);
      }
      row('卡源 / 备注', oTd);
    }

    table.appendChild(tbody);
    art.appendChild(table);
    return art;
  }

  function isVisible(t, filter) {
    return filter === 'all' || t.status === filter || (filter === 'active' && (t.status === 'in_progress' || t.status === 'blocked'));
  }

  function renderParallelism(root, D) {
    var scopeMap = buildScopeMap(D);
    var domains = Object.keys(scopeMap).sort(function (a, b) {
      return scopeMap[b].length - scopeMap[a].length;
    });
    var shared = 0, totalCards = 0;
    domains.forEach(function (d) { if (scopeMap[d].length > 1) shared++; });
    (D.tracks || []).forEach(function (tr) { totalCards += tr.cards.length; });

    var sec = el('section', 'phase');
    sec.appendChild(el('h2', 'phase-title', '需求并行度统计（按涉及范围域标签）'));
    sec.appendChild(el('p', 'par-note',
      '全板 ' + totalCards + ' 卡 × ' + domains.length + ' 个域标签，共享域 ' + shared + ' 个。判定口径：涉同一域的需求共享模块边界 = 不可并行（须串行协调）；涉及范围全异域的需求组合 = 可并行。统计基于全板数据，不随筛选变化。'));
    var table = el('table', 'par-table');
    var tbody = el('tbody');
    var hrow = el('tr');
    ['域标签', '卡数', '需求卡（卡号）', '并行判定'].forEach(function (h) { hrow.appendChild(el('th', null, h)); });
    tbody.appendChild(hrow);
    domains.forEach(function (d) {
      var r = el('tr');
      r.appendChild(el('td', null, d));
      r.appendChild(el('td', 'mono-cell', String(scopeMap[d].length)));
      r.appendChild(el('td', 'mono-cell', scopeMap[d].map(function (m) { return m.id; }).join('、')));
      r.appendChild(el('td', null, scopeMap[d].length > 1 ? '同域互斥 · 须串行协调' : '独占域 · 可并行'));
      tbody.appendChild(r);
    });
    table.appendChild(tbody);
    sec.appendChild(table);
    root.appendChild(sec);
  }

  function render(filter) {
    var D = window.MG_PROGRESS;
    buildIndex(D);
    var root = document.getElementById('board');
    root.textContent = '';

    // 计数：护栏线（counted=false）与 watch 状态卡不计
    var done = 0, active = 0;
    (D.tracks || []).forEach(function (tr) {
      if (tr.counted === false) return;
      tr.cards.forEach(function (t) {
        if (t.status === 'watch') return;
        active++;
        if (t.status === 'done') done++;
      });
    });
    var pct = active ? Math.round((done / active) * 100) : 0;
    document.getElementById('bar-fill').style.width = pct + '%';
    document.getElementById('bar-text').textContent =
      '已排任务进度（计数主线全部已排卡，护栏线与观察卡不计）' + pct + '%（' + done + '/' + active + ' 卡完成）';
    document.getElementById('last-sync').textContent = '最近同步 ' + D.meta.lastSync + ' · ' + D.meta.syncNote;

    // 各分区：a-b-c-d 步骤链 + 需求卡表格（⑦ 专项与其他主线同款渲染）
    var scopeMap = buildScopeMap(D);
    (D.tracks || []).forEach(function (tr) {
      var hasVisible = tr.cards.some(function (t) { return isVisible(t, filter); });
      if (!hasVisible) return;

      var sec = el('section', 'phase' + (tr.status === 'pending' ? ' phase-soft' : ''));
      var head = el('div', 'phase-head');
      var hwrap = el('div', 'phase-title-wrap');
      hwrap.appendChild(el('h2', 'phase-title', tr.title));
      var cnt = trackCount(tr);
      var winText = tr.counted === false ? tr.subtitle
        : tr.subtitle + ' · 串行 ' + cnt.done + '/' + cnt.total + ' 完成';
      hwrap.appendChild(el('span', 'phase-window', winText));
      head.appendChild(hwrap);
      head.appendChild(el('span', 'chip phase-chip ' + (STATUS_LABEL[tr.status] || STATUS_LABEL.pending).cls,
        TRACK_LABEL[tr.status] || tr.status));
      sec.appendChild(head);

      var chain = el('div', 'chain');
      var shown = 0;
      tr.cards.forEach(function (t, i) {
        if (!isVisible(t, filter)) return;
        if (shown > 0) chain.appendChild(el('div', 'step-link', '↓'));
        chain.appendChild(stepCard(t, tr, i, scopeMap));
        shown++;
      });
      sec.appendChild(chain);
      root.appendChild(sec);
    });

    renderParallelism(root, D);

    // 主线间关系（依赖与供给流说明）
    if (D.relations && D.relations.length) {
      var rel = el('section', 'phase');
      rel.appendChild(el('h2', 'phase-title', '主线间关系（供给 / 验收 / 收口 / 约束）'));
      var rlist = el('div', 'notes');
      (D.relations || []).forEach(function (r) {
        rlist.appendChild(el('div', 'note note-' + (r.level || 'info'),
          '〔' + r.from + ' → ' + r.to + ' · ' + r.type + '〕' + r.text));
      });
      rel.appendChild(rlist);
      root.appendChild(rel);
    }

    // 横切备注
    var notes = el('section', 'phase');
    notes.appendChild(el('h2', 'phase-title', '横切状态与风险备注'));
    var nlist = el('div', 'notes');
    (D.notes || []).forEach(function (n) {
      nlist.appendChild(el('div', 'note note-' + (n.level || 'info'), n.text));
    });
    notes.appendChild(nlist);
    root.appendChild(notes);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var D = window.MG_PROGRESS;
    var styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    document.getElementById('proj').textContent = D.meta.project + ' · 实现进度看板';
    document.getElementById('line').textContent = D.meta.line + ' · 主线仓 ' + D.meta.mainlineRepo;
    document.title = D.meta.project + ' 进度看板';

    var bar = document.querySelector('.filters');
    ['all', 'active', 'done', 'pending', 'watch'].forEach(function (f) {
      var b = el('button', 'filter-btn' + (f === 'all' ? ' on' : ''),
        { all: '全部', active: '进行中/受阻', done: '已完成', pending: '待办', watch: '护栏' }[f]);
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(bar.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
        render(f);
      });
      bar.appendChild(b);
    });

    render('all');
  });
})();
