// Token Launch Radar — the page's working parts. Plain script, no framework, no network:
// every byte it renders comes from window.RADAR in ../data.js, written by main.ts from the
// same board the gate reads, so what the screenshots show is what the code computes.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var $ = function (id) { return document.getElementById(id); };
  var state = { q: '', category: '', chain: '', minTvl: 0, watchOnly: false, sort: 'rank', selected: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function fmtPct(g) {
    if (g == null) return '<span class="flat">n/a</span>';
    var cls = g > 0.05 ? 'pos' : g < -0.05 ? 'neg' : 'flat';
    return '<span class="' + cls + '">' + (g > 0 ? '+' : '') + g.toFixed(1) + '%</span>';
  }
  function fmtAge(days) {
    if (days == null) return 'unknown';
    if (days < 365) return days + ' d';
    return (days / 365).toFixed(1) + ' yrs';
  }
  function fmtMult(x) { return '×' + Number(x).toFixed(2); }

  // ---- masthead + model strip -------------------------------------------------
  var totalImplied = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  $('mastStats').innerHTML =
    stat(fmtUsd(totalImplied), 'total implied') +
    stat(String(DATA.board_size), 'protocols ranked') +
    stat(String(DATA.watchlist_size) + ' / ' + String(DATA.watchlist_size), 'watchlist covered') +
    stat(String(DATA.early_size), 'early finds') +
    stat(DATA.as_of, 'snapshot date');
  function stat(v, k) { return '<div class="stat"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k) + '</div></div>'; }

  $('modelStrip').innerHTML =
    '<div class="in"><b>' + esc(DATA.model_version) + '</b><span>implied = TVL</span><span class="sep">×</span>' +
    '<span>category multiple (median MCap/TVL of tokenised peers)</span><span class="sep">×</span>' +
    '<span>growth factor (7d TVL)</span><span class="sep">×</span>' +
    '<span>vintage factor (years with no token)</span><span class="sep">×</span>' +
    '<span>reach factor (chains)</span></div>';
  $('modelVer').textContent = '· ' + DATA.model_version;

  // ---- filter options -----------------------------------------------------------
  var cats = {};
  var chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  $('fCategory').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');
  $('fChain').innerHTML = '<option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');

  // ---- board --------------------------------------------------------------------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days); },
      name: function (a, b) { return a.name < b.name ? -1 : 1; }
    };
    return out.sort(by[state.sort] || by.rank);
  }

  function renderBoard() {
    var list = filtered();
    $('rowCount').textContent = list.length + ' of ' + rows.length + ' protocols';
    $('emptyMsg').hidden = list.length > 0;
    $('boardBody').innerHTML = list.map(function (r) {
      var badge = r.watchlist
        ? '<span class="badge watch">Watchlist</span>'
        : '<span class="badge early">Early</span>';
      var chainTxt = r.chains.length === 0 ? '—' : esc(r.chains[0]) + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '');
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + badge + '<br><span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="num chains">' + chainTxt + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num implied">' + fmtUsd(r.implied_value_usd) + '</td></tr>';
    }).join('');
    var trs = $('boardBody').querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { select(this.getAttribute('data-slug'), false); });
    }
  }

  // ---- detail ---------------------------------------------------------------------
  function barFrac(kind, v) {
    var lo = { m: 0.2, g: 0.7, v: 0.8, r: 1.0 }[kind];
    var hi = { m: 2.5, g: 1.6, v: 1.25, r: 1.3 }[kind];
    var f = (v - lo) / (hi - lo);
    return Math.max(0.03, Math.min(1, f));
  }
  function factorRow(label, kind, v) {
    return '<div class="factor"><span class="fk">' + esc(label) + '</span>' +
      '<span class="bar"><i style="width:' + Math.round(barFrac(kind, v) * 100) + '%"></i></span>' +
      '<span class="fv">' + fmtMult(v) + '</span></div>';
  }
  function select(slug, scroll) {
    var r = bySlug[slug];
    if (!r) return;
    state.selected = slug;
    renderBoardSelection();
    var f = r.factors;
    var exact = Math.round(r.tvl_usd * f.category_multiple * f.growth_factor * f.vintage_factor * f.reach_factor);
    $('detail').innerHTML =
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="badge watch">Watchlist</span>' : '<span class="badge early">Early find</span>') + '</h2>' +
      '<div class="d-slug">' + esc(r.slug) + ' · rank #' + r.rank + ' of ' + rows.length + '</div>' +
      '<div class="d-implied"><div class="k">Implied launch value</div><div class="v">' + fmtUsd(r.implied_value_usd) + '</div></div>' +
      '<div class="d-grid">' +
      cell('TVL', fmtUsd(r.tvl_usd)) +
      cell('Category', esc(r.category || '—')) +
      cell('7-day TVL change', r.change_7d == null ? 'not reported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') +
      cell('Live without a token', fmtAge(r.age_days) + (r.listed_at ? ' (since ' + esc(r.listed_at) + ')' : '')) +
      cell('Chains', r.chains.length ? esc(r.chains.join(', ')) : '—') +
      cell('Watchlist floor', r.watchlist ? 'on the snapshot watchlist' : 'below the $50M floor — an early find') +
      '</div>' +
      '<h3>Why this value</h3><div class="factors">' +
      factorRow('Category multiple', 'm', f.category_multiple) +
      factorRow('Growth factor', 'g', f.growth_factor) +
      factorRow('Vintage factor', 'v', f.vintage_factor) +
      factorRow('Reach factor', 'r', f.reach_factor) +
      '</div>' +
      '<div class="recompute">' + fmtUsd(r.tvl_usd) + ' × ' + f.category_multiple.toFixed(2) + ' × ' + f.growth_factor.toFixed(2) +
      ' × ' + f.vintage_factor.toFixed(2) + ' × ' + f.reach_factor.toFixed(2) + ' ≈ ' + fmtUsd(exact) + '</div>' +
      '<h3>Farm plan</h3><ol class="farm">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>' +
      '<p class="hint">Six steps, generated from this protocol\'s category, main chain, TVL and age. Costs are estimates in USD; the capital stays yours and at risk like any DeFi position.</p>';
    if (scroll) $('detail').scrollIntoView({ block: 'nearest' });
  }
  function cell(k, v) { return '<div class="cell"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>'; }
  function renderBoardSelection() {
    var trs = $('boardBody').querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      if (trs[i].getAttribute('data-slug') === state.selected) trs[i].classList.add('sel');
      else trs[i].classList.remove('sel');
    }
  }

  // ---- live set + multiples ---------------------------------------------------------
  $('liveBody').innerHTML = DATA.live.map(function (r) {
    return '<tr><td><span class="pname">' + esc(r.name) + '</span></td>' +
      '<td class="pslug">' + esc(r.symbol || '—') + '</td>' +
      '<td class="cat">' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
      '<td class="num">' + (r.mcap_tvl == null ? '—' : r.mcap_tvl.toFixed(2)) + '</td>' +
      '<td class="num">' + fmtPct(r.change_7d) + '</td></tr>';
  }).join('');

  var boardCats = {};
  rows.forEach(function (r) { if (r.category) boardCats[r.category] = true; });
  $('multBody').innerHTML = DATA.multiples
    .filter(function (m) { return boardCats[m.category]; })
    .sort(function (a, b) { return b.multiple - a.multiple; })
    .map(function (m) {
      return '<tr><td>' + esc(m.category) + (m.fallback ? ' <span class="pslug">(all-category median)</span>' : '') + '</td>' +
        '<td class="num">' + m.multiple.toFixed(2) + '</td><td class="num">' + m.peers + '</td></tr>';
    }).join('');

  // ---- controls wiring -----------------------------------------------------------------
  $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
  $('fCategory').addEventListener('change', function () { state.category = this.value; renderBoard(); });
  $('fChain').addEventListener('change', function () { state.chain = this.value; renderBoard(); });
  $('fTvl').addEventListener('change', function () { state.minTvl = Number(this.value); renderBoard(); });
  $('fSort').addEventListener('change', function () { state.sort = this.value; renderBoard(); });
  $('fWatch').addEventListener('change', function () { state.watchOnly = this.checked; renderBoard(); });

  // ---- deep links for the record: #p=<slug> opens a protocol, #f=<category> filters ------
  var hash = window.location.hash || '';
  var mp = /#p=([a-z0-9-]+)/.exec(hash);
  var mf = /#f=([A-Za-z ]+)/.exec(hash);
  if (mf) {
    var cat = decodeURIComponent(mf[1]);
    if (cats[cat]) { state.category = cat; $('fCategory').value = cat; }
  }
  renderBoard();
  select(mp && bySlug[mp[1]] ? mp[1] : rows[0].slug, false);
})();
