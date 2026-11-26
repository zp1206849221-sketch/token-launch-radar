// Token Launch Radar — board rendering, filters, sorting and the detail view.
// Data arrives as window.RADAR from ../data.js, written by main.ts from the same board.
(function () {
  'use strict';
  var R = window.RADAR;
  var rows = R.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(v) {
    if (v === null || v === undefined) return '<span class="flat">—</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    var arrow = v > 0 ? '&#9650; ' : v < 0 ? '&#9660; ' : '';
    return '<span class="' + cls + '">' + arrow + (v > 0 ? '+' : '') + v.toFixed(2) + '%</span>';
  }
  function confCell(r) {
    var b = r.breakdown;
    return '<span class="conf conf-' + b.confidence_tier.toLowerCase() + '">' + b.confidence_tier + '</span>' +
      '<span class="conf-score">' + b.confidence.toFixed(2) + '</span>';
  }
  function age(v) {
    return v === null || v === undefined ? '—' : v.toFixed(1) + 'y';
  }

  // Header chips, all read from the data so the page can never disagree with the board.
  var s = R.stats;
  document.getElementById('chips').innerHTML = [
    'Snapshot <b>' + esc(R.asOf) + '</b>',
    '<b>' + s.protocolsScanned + '</b> protocols scanned',
    'Watchlist <b>' + s.watchlistCount + '/' + s.watchlistCount + '</b> covered',
    '<b>' + s.rows + '</b> ranked',
    'Model: <b>' + s.peerCount + '</b> token peers',
    '<b>' + s.categoryFitCount + '</b> category curves fitted'
  ].map(function (c) { return '<span class="chip">' + c + '</span>'; }).join('');

  // Filter options, from the rows themselves.
  function fillSelect(id, values, allLabel) {
    var el = document.getElementById(id);
    el.innerHTML = '<option value="">' + allLabel + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
  }
  var cats = [];
  var chains = [];
  rows.forEach(function (r) {
    var c = r.category || 'Uncategorised';
    if (cats.indexOf(c) < 0) cats.push(c);
    r.chains.forEach(function (ch) { if (chains.indexOf(ch) < 0) chains.push(ch); });
  });
  cats.sort();
  chains.sort();
  fillSelect('f-category', cats, 'All categories');
  fillSelect('f-chain', chains, 'All chains');

  var boardView = document.getElementById('board-view');
  var detailView = document.getElementById('detail-view');
  var tbody = document.getElementById('rows');
  var countLine = document.getElementById('count-line');

  function currentRows() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var cat = document.getElementById('f-category').value;
    var chain = document.getElementById('f-chain').value;
    var watchOnly = document.getElementById('f-watch').checked;
    var sort = document.getElementById('f-sort').value;
    var out = rows.filter(function (r) {
      if (watchOnly && !r.watchlist) return false;
      if (cat && (r.category || 'Uncategorised') !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      implied: function (a, b) { return b.implied - a.implied; },
      tvl: function (a, b) { return b.tvl - a.tvl; },
      change: function (a, b) {
        var x = a.change7d === null ? -Infinity : a.change7d;
        var y = b.change7d === null ? -Infinity : b.change7d;
        return y - x;
      },
      confidence: function (a, b) { return b.breakdown.confidence - a.breakdown.confidence || a.rank - b.rank; },
      age: function (a, b) {
        var x = a.ageYears === null ? -1 : a.ageYears;
        var y = b.ageYears === null ? -1 : b.ageYears;
        return y - x;
      }
    };
    out.sort(by[sort] || by.rank);
    return out;
  }

  function rowHtml(r) {
    var chainText = r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '');
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="num rank">' + r.rank + '</td>' +
      '<td><span class="pname">' + esc(r.name) + '</span>' +
      (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '') +
      '<span class="pcat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
      '<td class="num"><span class="implied">' + money(r.implied) + '</span>' +
      '<span class="range">' + money(r.low) + ' – ' + money(r.high) + '</span></td>' +
      '<td class="num">' + money(r.tvl) + '</td>' +
      '<td class="num">' + r.multiple.toFixed(2) + '&times;</td>' +
      '<td class="num">' + confCell(r) + '</td>' +
      '<td class="num">' + pct(r.change7d) + '</td>' +
      '<td class="num">' + age(r.ageYears) + '</td>' +
      '<td class="chains">' + esc(chainText) + '</td>' +
      '<td><button class="farm-btn" type="button" data-slug="' + esc(r.slug) + '">Farm plan</button></td>' +
      '</tr>';
  }

  function render() {
    var list = currentRows();
    tbody.innerHTML = list.map(rowHtml).join('');
    countLine.textContent = 'Showing ' + list.length + ' of ' + rows.length + ' ranked protocols';
  }

  var catPeers = {};
  R.categoryMultiples.forEach(function (c) { catPeers[c.category || 'Uncategorised'] = c.peers; });

  function whyLine(r) {
    var cat = r.category || 'uncategorised';
    var b = r.breakdown;
    var track = r.ageYears === null
      ? 'an unrecorded start date, so no track-record adjustment'
      : 'a ' + r.ageYears.toFixed(1) + '-year track record (factor ' + r.ageFactor.toFixed(2) + ')';
    var curve = b.category_curve_usd === null
      ? 'its category has too few tokenised peers for its own curve, so the blend rests on the global size curve and the multiple'
      : 'its category also contributes its own fitted curve (' + money(b.category_curve_usd) + ', R\u00b2 ' +
        b.category_fit_r2.toFixed(2) + ' on ' + b.category_fit_peers + ' peers)';
    return 'Ranked #' + r.rank + ' of ' + rows.length + ': ' + r.name + ' pairs ' + money(r.tvl) +
      ' of TVL with a ' + cat + ' peer multiple of ' + r.categoryMultiple.toFixed(2) + 'x. Blending the size curve (' +
      money(r.sizeCurveValue) + ') with that multiple gives ' + money(r.implied) + ' — ' + r.multiple.toFixed(2) +
      'x its TVL — after a momentum factor of ' + r.momentumFactor.toFixed(2) + ' and ' + track + '. ' +
      'Confidence is ' + b.confidence_tier.toLowerCase() + ' (' + b.confidence.toFixed(2) + '): ' + curve + '.';
  }

  function showDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var lo = Math.log10(r.low);
    var hi = Math.log10(r.high);
    var pos = hi > lo ? ((Math.log10(r.implied) - lo) / (hi - lo)) * 100 : 50;
    var b = r.breakdown;
    var wpct = function (w) { return Math.round(w * 100) + '%'; };
    var curveRow = b.category_curve_usd === null
      ? '<li><span class="k">Category curve</span><span class="v">not fitted — ' +
        (catPeers[r.category || 'Uncategorised'] || 0) + ' peers (&lt; 8)</span></li>'
      : '<li><span class="k">Category curve (' + b.category_fit_peers + ' peers, R\u00b2 ' + b.category_fit_r2.toFixed(2) +
        ', weight ' + wpct(b.weights.curve) + ')</span><span class="v">' + money(b.category_curve_usd) + '</span></li>';
    var fitR2Used = b.category_fit_r2 === null ? R.stats.fit.r2 : b.category_fit_r2;
    var phases = ['Week 0 · set up', 'Week 0 · open', 'Week 1 · second presence',
      'Weeks 1–' + r.farmSummary.weeks + ' · upkeep', 'Weeks 1–' + r.farmSummary.weeks + ' · watch',
      'Week ' + r.farmSummary.weeks + ' · close out'];
    var steps = r.farmSteps.map(function (st, i) {
      return '<li><span class="when">' + esc(phases[i] || ('Step ' + (i + 1))) + '</span>' + esc(st) + '</li>';
    }).join('');
    var costRows = r.farmSummary.costs.map(function (c) {
      return '<li><span class="k">' + esc(c.label) + '</span><span class="v">' + money(c.usd) + '</span></li>';
    }).join('') +
      '<li class="total"><span class="k">Total estimated cost</span><span class="v">' + money(r.farmSummary.total_cost_usd) + '</span></li>';
    var riskItems = r.farmSummary.risks.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    document.getElementById('detail').innerHTML =
      '<div class="detail-head"><div>' +
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="detail-sub">Rank #' + r.rank + ' of ' + rows.length + ' &middot; ' + esc(r.category || 'Uncategorised') +
      ' &middot; records no token in the snapshot</p></div>' +
      '<div class="big-value"><div class="cap">Implied launch value</div><div class="amount">' + money(r.implied) + '</div></div></div>' +
      '<div class="rangebar"><div class="track"><div class="marker" style="left:' + pos.toFixed(1) + '%"></div></div>' +
      '<div class="ends"><span>low ' + money(r.low) + '</span><span>estimate range (x10<sup>±0.45</sup>)</span><span>high ' + money(r.high) + '</span></div></div>' +
      '<div class="cards">' +
      '<div class="card"><h3>Snapshot facts</h3><dl class="facts">' +
      '<dt>TVL</dt><dd>' + money(r.tvl) + '</dd>' +
      '<dt>7d change</dt><dd>' + (r.change7d === null ? '—' : (r.change7d > 0 ? '+' : '') + r.change7d.toFixed(2) + '%') + '</dd>' +
      '<dt>First tracked</dt><dd>' + esc(r.listedAt || 'not recorded') + '</dd>' +
      '<dt>Age</dt><dd>' + age(r.ageYears) + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(r.chains.join(', ') || '—') + '</dd>' +
      '<dt>Watchlist</dt><dd>' + (r.watchlist ? 'yes — at/above the $50M floor' : (r.tvl >= 50000000 ? 'no — above-floor protocol admitted by the blind-spot review' : 'no — below-floor find')) + '</dd>' +
      '</dl></div>' +
      '<div class="card"><h3>Model breakdown — how the value is built</h3><ul class="breakdown">' +
      '<li><span class="k">TVL (snapshot)</span><span class="v">' + money(r.tvl) + '</span></li>' +
      '<li><span class="k">Size curve, global fit (weight ' + wpct(b.weights.size) + ')</span><span class="v">' + money(b.size_curve_usd) + '</span></li>' +
      '<li><span class="k">Category multiple ' + b.category_multiple.toFixed(2) + 'x (weight ' + wpct(b.weights.multiple) + ')</span><span class="v">' + money(b.category_multiple_usd) + '</span></li>' +
      curveRow +
      '<li><span class="k">Blended base value</span><span class="v">' + money(b.base_value_usd) + '</span></li>' +
      '<li><span class="k">Momentum factor (7d)</span><span class="v">x' + b.momentum_factor.toFixed(2) + '</span></li>' +
      '<li><span class="k">Track-record factor</span><span class="v">x' + b.age_factor.toFixed(2) + '</span></li>' +
      '<li class="total"><span class="k">Implied value</span><span class="v">' + money(r.implied) + ' (' + r.multiple.toFixed(2) + 'x TVL)</span></li>' +
      '</ul>' +
      '<div class="conf-block"><div class="conf-head"><span>Confidence</span><span class="conf conf-' +
      b.confidence_tier.toLowerCase() + '">' + b.confidence_tier + ' · ' + b.confidence.toFixed(2) + '</span></div>' +
      '<div class="conf-meter"><div class="conf-fill conf-' + b.confidence_tier.toLowerCase() +
      '" style="width:' + Math.round(b.confidence * 100) + '%"></div></div>' +
      '<p class="conf-note">From ' + (catPeers[r.category || 'Uncategorised'] || 0) + ' tokenised ' +
      esc(r.category || 'category') + ' peers, a pricing-curve R\u00b2 of ' + fitR2Used.toFixed(2) +
      ', and whether this TVL sits inside the size range that curve was fitted on.</p></div></div>' +
      '<div class="card"><h3>Why this rank</h3><p class="why">' + esc(whyLine(r)) + '</p></div>' +
      '<div class="card"><h3>Plan summary &amp; costs</h3><div class="summary-box">' +
      '<span class="k">Est. total cost</span><span class="v">' + money(r.farmSummary.total_cost_usd) + '</span>' +
      '<span class="k">Setup time</span><span class="v">' + esc(r.farmSummary.setup_time) + '</span>' +
      '<span class="k">Weekly upkeep</span><span class="v">' + esc(r.farmSummary.weekly_upkeep) + '</span>' +
      '<span class="k">Horizon</span><span class="v">' + esc(r.farmSummary.horizon) + '</span>' +
      '</div><ul class="breakdown costs">' + costRows + '</ul></div>' +
      '<div class="card"><h3>Risks</h3><ul class="risks">' + riskItems + '</ul></div>' +
      '</div>' +
      '<div class="card" style="margin-top:14px"><h3>Farm plan — ' + esc(r.name) + '</h3><ol class="plan">' + steps + '</ol></div>';
    boardView.hidden = true;
    detailView.hidden = false;
    window.scrollTo(0, 0);
  }

  tbody.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  document.getElementById('back').addEventListener('click', function () {
    detailView.hidden = true;
    boardView.hidden = false;
  });
  ['q', 'f-category', 'f-chain', 'f-watch', 'f-sort'].forEach(function (id) {
    var el = document.getElementById(id);
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  render();
})();
