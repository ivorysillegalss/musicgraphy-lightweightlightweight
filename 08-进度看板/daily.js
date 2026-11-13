// ============================================================
// Musicgraphy 2.0 · 看板「每日日报」渲染器
// 2026-11-14 用户裁决新开（协议 §1/§7 已登记）。稳定件勿改。
// 安全姿态与主看板一致：零外部请求、零 eval、零 innerHTML——
// 数据一律 textContent 注入。
// 数据源：daily-reports.js（window.MG_DAILY_REPORTS，结构 = meta + reports[]）
// ============================================================
(function () {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function statBlock(s) {
    var d = el('div', 'stat');
    d.appendChild(el('div', 'stat-label', s.label || ''));
    d.appendChild(el('div', 'stat-value', s.value || ''));
    return d;
  }

  function listSection(sec) {
    var wrap = el('section', 'sec');
    wrap.appendChild(el('h3', null, sec.heading));
    var ul = el('ul');
    (sec.items || []).forEach(function (item) {
      ul.appendChild(el('li', null, typeof item === 'string' ? item : (item.text || '')));
    });
    wrap.appendChild(ul);
    return wrap;
  }

  function timelineSection(sec) {
    var wrap = el('section', 'sec');
    wrap.appendChild(el('h3', null, sec.heading));
    var tl = el('div', 'timeline');
    (sec.items || []).forEach(function (item) {
      var row = el('div', 'tl-row');
      row.appendChild(el('span', 'tl-time', item.time || ''));
      row.appendChild(el('span', 'tl-text', item.text || ''));
      tl.appendChild(row);
    });
    wrap.appendChild(tl);
    return wrap;
  }

  function reportArticle(rep) {
    var art = el('article', 'daily');

    var head = el('div', 'daily-head');
    head.appendChild(el('span', 'daily-date', rep.date || ''));
    head.appendChild(el('h2', 'daily-title', rep.title || ''));
    art.appendChild(head);

    if (rep.summary) art.appendChild(el('p', 'daily-summary', rep.summary));

    if (rep.stats && rep.stats.length) {
      var grid = el('div', 'stat-grid');
      rep.stats.forEach(function (s) { grid.appendChild(statBlock(s)); });
      art.appendChild(grid);
    }

    (rep.sections || []).forEach(function (sec) {
      art.appendChild(sec.kind === 'timeline' ? timelineSection(sec) : listSection(sec));
    });

    if (rep.evidence && rep.evidence.length) {
      var ev = el('div', 'evidence');
      ev.appendChild(el('div', 'ev-row', '〔证据栏 · 与 progress-data.js 各卡 evidence 同源可核查〕'));
      rep.evidence.forEach(function (e) {
        var row = el('div', 'ev-row');
        row.appendChild(el('span', 'ev-key', e.label || ''));
        row.appendChild(el('span', 'ev-val', e.value || ''));
        ev.appendChild(row);
      });
      art.appendChild(ev);
    }
    return art;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var R = window.MG_DAILY_REPORTS;
    if (!R || !R.meta) return;
    document.getElementById('proj').textContent = R.meta.project + ' · 每日日报';
    document.getElementById('line').textContent =
      '数据源 daily-reports.js · 建于 ' + R.meta.created + ' · 最新条目 ' + R.meta.lastEntry +
      ' · 与实现进度看板互为表里（看板记卡片终态，日报记过程与全貌）';
    document.getElementById('purpose').textContent = R.meta.purpose || '';
    document.title = R.meta.project + ' 每日日报';

    var root = document.getElementById('daily');
    root.textContent = '';
    (R.reports || []).forEach(function (rep) { root.appendChild(reportArticle(rep)); });
  });
})();
