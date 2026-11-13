// ============================================================
// Musicgraphy 2.0 · 进度看板渲染器（主线视图）
// 2026-11-14 展现改版（用户裁决，协议 §1/§5 已登记）：
//   phases 周视图 → tracks 主线视图；卡片在各主线内按串行依赖序
//   列举（#序号 + deps 前置依赖行），线间关系由 relations 区显式渲染。
//   进度数据本身仍只存在于 progress-data.js——本文件不含任何具体进度。
// 安全姿态不变：零外部请求、零 eval、零 innerHTML——数据一律 textContent 注入。
// 数据源：progress-data.js（window.MG_PROGRESS，结构 = tracks + relations + notes）
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
    return hit ? id + ' ' + hit.card.title + '（' + hit.track.short + '线）' : id;
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

  function taskCard(t, seq) {
    var meta = STATUS_LABEL[t.status] || STATUS_LABEL.pending;
    var card = el('article', 'card ' + meta.cls);
    var top = el('div', 'card-top');
    top.appendChild(el('span', 'chip ' + meta.cls, meta.label));
    top.appendChild(el('span', 'tid', '#' + seq + ' · ' + t.id));
    card.appendChild(top);
    card.appendChild(el('h3', 'card-title', t.title));
    if (t.desc) card.appendChild(el('p', 'card-desc', t.desc));
    if (t.deps && t.deps.length) {
      card.appendChild(el('p', 'card-desc', '前置依赖：' + t.deps.map(depLabel).join(' · ')));
    }
    if (t.note) card.appendChild(el('p', 'card-desc', '备注：' + t.note));
    if (t.origin) card.appendChild(el('p', 'card-desc', '卡源：' + t.origin));
    var ev = el('div', 'card-evidence');
    ev.appendChild(el('span', 'ev-key', '证据'));
    ev.appendChild(el('span', 'ev-val', t.evidence || '—'));
    card.appendChild(ev);
    card.appendChild(el('div', 'card-updated', '更新 ' + (t.updated || '—')));
    return card;
  }

  function isVisible(t, filter) {
    return filter === 'all' || t.status === filter || (filter === 'active' && (t.status === 'in_progress' || t.status === 'blocked'));
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
      '已排任务进度（五条计数主线全部已排卡，护栏线与观察卡不计）' + pct + '%（' + done + '/' + active + ' 卡完成）';
    document.getElementById('last-sync').textContent = '最近同步 ' + D.meta.lastSync + ' · ' + D.meta.syncNote;

    // 各主线：串行卡列（#序号 = 主线内数组序，过滤模式下保持稳定）
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

      var grid = el('div', 'grid');
      tr.cards.forEach(function (t, i) {
        if (isVisible(t, filter)) grid.appendChild(taskCard(t, i + 1));
      });
      sec.appendChild(grid);
      root.appendChild(sec);
    });

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
