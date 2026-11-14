/* Token Radar's page: renders window.RADAR (written by main.ts from the
   sealed snapshot) into a sortable, filterable board with a detail view per
   protocol and a live-token reference. No network, no framework: the whole
   dataset arrives in data.js beside this page. */
'use strict';

const RADAR = window.RADAR;
if (!RADAR) throw new Error('Token Radar: no data.js loaded beside this page');

/* ---------- formatting ---------- */

function usd(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function pct(n) {
  if (n === null || n === undefined) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

function ageText(days) {
  if (days === null || days === undefined) return '—';
  if (days < 30) return days + 'd';
  if (days < 365) return Math.round(days / 30) + 'mo';
  return (days / 365).toFixed(1) + 'y';
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/* ---------- header, stats, method ---------- */

const meta = document.getElementById('top-meta');
const metaSnapshot = el('span', null, 'Snapshot ');
metaSnapshot.appendChild(el('b', null, RADAR.as_of));
meta.append(metaSnapshot, el('span', null, 'Model ' + RADAR.model_version), el('span', null, 'Floor ' + usd(RADAR.floor_usd)));

const stats = document.getElementById('stats');
const statData = [
  [String(RADAR.protocols_total), 'protocols scanned'],
  [String(RADAR.watchlist_size), 'on the watchlist'],
  [String(RADAR.board_size), 'rows on the board'],
  [String(RADAR.early_size), 'early finds below the floor'],
  [String(RADAR.live_size), 'live reference'],
];
for (const [value, label] of statData) {
  const card = el('div', 'stat');
  card.append(el('div', 'v', value), el('div', 'k', label));
  stats.appendChild(card);
}

document.getElementById('method-formula').textContent =
  'implied = TVL × category multiple × (1 + clamp(7d %, −60, 120) / 100 × 0.6)' +
  ' × (0.7 + min(age, 1095) / 1095 × 0.3) × (0.95 + 0.02 × min(chains, 5))';

const multBody = document.querySelector('#multiples tbody');
const shown = RADAR.category_multiples
  .filter((m) => m.live_count >= 1)
  .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
for (const m of shown) {
  const tr = el('tr');
  tr.append(el('td', null, m.category), el('td', 'num mono', m.multiple.toFixed(3)), el('td', 'num', String(m.live_count)));
  multBody.appendChild(tr);
}
const globalRow = el('tr');
globalRow.append(
  el('td', null, 'Fallback (fewer than 3 live protocols)'),
  el('td', 'num mono', RADAR.global_multiple.toFixed(3)),
  el('td', 'num', '—'),
);
multBody.appendChild(globalRow);

document.getElementById('foot-source').textContent =
  'Source: ' + RADAR.source + '. Snapshot date ' + RADAR.as_of + '; floor ' + usd(RADAR.floor_usd) +
  ' (watchlist: TVL at or above the floor, no token recorded, not a wrapped, staked or bridged product).';

/* ---------- filters ---------- */

const qInput = document.getElementById('q');
const chainSelect = document.getElementById('chain');
const categorySelect = document.getElementById('category');
const watchlistOnly = document.getElementById('watchlist-only');
const minValueSelect = document.getElementById('min-value');
const countEl = document.getElementById('count');
const boardBody = document.querySelector('#board-table tbody');
const boardEmpty = document.getElementById('board-empty');
const detailEl = document.getElementById('detail');
const livePanel = document.getElementById('live-panel');
const tabBoard = document.getElementById('tab-board');
const tabLive = document.getElementById('tab-live');

// Each row carries watchlist: true when its slug is one of the snapshot's
// watchlist slugs (marked by main.ts); the badge and the filter read it.
const chains = [...new Set(RADAR.rows.flatMap((r) => r.chains))].sort();
for (const c of chains) chainSelect.appendChild(el('option', null, c)).value = c;
const categories = [...new Set(RADAR.rows.map((r) => r.category || '(no category)'))].sort();
for (const c of categories) categorySelect.appendChild(el('option', null, c)).value = c;

let sortKey = 'rank';
let sortDir = 1;
let selectedSlug = null;

function readHash() {
  const out = {};
  for (const part of location.hash.slice(1).split('&')) {
    if (!part) continue;
    const [k, v] = part.split('=');
    out[decodeURIComponent(k)] = v === undefined ? '' : decodeURIComponent(v);
  }
  return out;
}

function writeHash() {
  const parts = [];
  if (selectedSlug) parts.push('detail=' + encodeURIComponent(selectedSlug));
  const tab = tabLive.classList.contains('active') ? 'live' : 'board';
  if (tab === 'live') parts.push('tab=live');
  if (qInput.value) parts.push('q=' + encodeURIComponent(qInput.value));
  if (chainSelect.value) parts.push('chain=' + encodeURIComponent(chainSelect.value));
  if (categorySelect.value) parts.push('category=' + encodeURIComponent(categorySelect.value));
  if (watchlistOnly.checked) parts.push('watchlist=1');
  if (minValueSelect.value !== '0') parts.push('min=' + minValueSelect.value);
  const next = parts.length ? '#' + parts.join('&') : '';
  if (location.hash !== next) history.replaceState(null, '', next || location.pathname);
}

function filteredRows() {
  const q = qInput.value.trim().toLowerCase();
  const chain = chainSelect.value;
  const category = categorySelect.value;
  const min = Number(minValueSelect.value);
  return RADAR.rows.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    if (chain && !r.chains.includes(chain)) return false;
    if (category && (r.category || '(no category)') !== category) return false;
    if (watchlistOnly.checked && !r.watchlist) return false;
    if (min && r.implied_value_usd < min) return false;
    return true;
  });
}

function sortRows(rows) {
  const key = sortKey;
  const dir = sortDir;
  const val = (r) => {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'category') return (r.category || '').toLowerCase();
    if (key === 'chains') return r.chains.join(',').toLowerCase();
    if (key === 'change_7d') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age_days') return r.age_days === null ? -Infinity : r.age_days;
    return r[key];
  };
  return [...rows].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.rank - b.rank;
  });
}

function renderBoard() {
  const rows = sortRows(filteredRows());
  const maxImplied = RADAR.rows[0].implied_value_usd;
  boardBody.replaceChildren();
  for (const r of rows) {
    const tr = el('tr');
    if (r.slug === selectedSlug) tr.classList.add('selected');
    const rankTd = el('td', 'num', String(r.rank));
    const nameTd = el('td');
    nameTd.append(el('span', 'name', r.name), el('span', 'slug', ' ' + r.slug));
    if (r.watchlist) nameTd.appendChild(el('span', 'badge', 'WATCHLIST'));
    const catTd = el('td', 'wrap', r.category || '—');
    const chainTd = el('td', 'wrap', r.chains.length > 2 ? r.chains.slice(0, 2).join(', ') + ' +' + (r.chains.length - 2) : r.chains.join(', ') || '—');
    const tvlTd = el('td', 'num', usd(r.tvl_usd));
    const changeTd = el('td', 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), pct(r.change_7d));
    const ageTd = el('td', 'num', ageText(r.age_days));
    const impliedTd = el('td', 'num', usd(r.implied_value_usd));
    const shareTd = el('td', 'num');
    const bar = el('span', 'bar');
    const fill = el('i');
    fill.style.width = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%';
    bar.appendChild(fill);
    shareTd.append(bar);
    tr.append(rankTd, nameTd, catTd, chainTd, tvlTd, changeTd, ageTd, impliedTd, shareTd);
    tr.addEventListener('click', () => selectRow(r.slug));
    boardBody.appendChild(tr);
  }
  boardEmpty.hidden = rows.length > 0;
  countEl.textContent = rows.length + ' of ' + RADAR.rows.length + ' rows';
  document.querySelectorAll('#board-table th[data-sort]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.sort === sortKey);
    th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (th.dataset.sort === sortKey ? (sortDir === 1 ? ' ▲' : ' ▼') : '');
  });
}

/* ---------- detail view ---------- */

function selectRow(slug) {
  selectedSlug = slug;
  const r = RADAR.rows.find((x) => x.slug === slug);
  renderBoard();
  if (!r) {
    detailEl.hidden = true;
    detailEl.replaceChildren();
    writeHash();
    return;
  }
  detailEl.hidden = false;
  detailEl.replaceChildren();
  const close = el('button', 'detail-close', 'Close');
  close.addEventListener('click', () => selectRow(null));
  detailEl.appendChild(close);
  detailEl.appendChild(el('h2', null, '#' + r.rank + ' — ' + r.name));
  const slugLine = el('p', 'slug-line', r.slug + ' · ' + (r.category || 'no category') + ' · ' + (r.chains.join(', ') || 'no chain listed'));
  detailEl.appendChild(slugLine);

  const facts = el('div', 'facts');
  const factData = [
    [usd(r.tvl_usd), 'TVL'],
    [pct(r.change_7d), 'TVL change, 7d'],
    [ageText(r.age_days), 'Tracked since ' + (r.listed_at || 'unknown')],
    [usd(r.implied_value_usd), 'Implied value'],
  ];
  for (const [v, k] of factData) {
    const f = el('div', 'fact');
    f.append(el('div', 'v', v), el('div', 'k', k));
    facts.appendChild(f);
  }
  detailEl.appendChild(facts);

  const math = el('table', 'math');
  const head = el('tr');
  head.append(el('th', null, 'Step'), el('th', 'num', 'Figure'), el('th', 'num', 'Multiplier'));
  math.appendChild(head);
  const base = r.tvl_usd * r.category_multiple;
  const mathRows = [
    ['TVL × category multiple (' + r.category_multiple.toFixed(3) + ')', usd(r.tvl_usd), '× ' + r.category_multiple.toFixed(3)],
    ['Base value', usd(base), ''],
    ['Growth, 7d ' + pct(r.change_7d), '', '× ' + r.growth_multiplier.toFixed(4)],
    ['Maturity, ' + ageText(r.age_days) + ' old', '', '× ' + r.maturity_multiplier.toFixed(4)],
    ['Breadth, ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's'), '', '× ' + r.breadth_multiplier.toFixed(4)],
    ['Implied value', usd(r.implied_value_usd), ''],
  ];
  for (const [label, figure, mult] of mathRows) {
    const tr = el('tr');
    tr.append(el('td', null, label), el('td', 'num', figure), el('td', 'num', mult));
    math.appendChild(tr);
  }
  detailEl.appendChild(el('h3', null, 'How the number is built'));
  detailEl.appendChild(math);

  detailEl.appendChild(el('h3', null, 'Farm plan — six steps'));
  const steps = el('ol', 'steps');
  for (const s of r.farm_steps) steps.appendChild(el('li', null, s));
  detailEl.appendChild(steps);
  detailEl.appendChild(el('p', 'disclaimer',
    'This protocol records no token in the snapshot — no market cap, no CoinGecko id, no symbol. ' +
    'That is the record, not proof: it may still have a token the record does not carry. ' +
    'The implied value is this radar\u2019s own claim, not a prediction of a launch.'));
  detailEl.scrollIntoView({ block: 'nearest' });
  writeHash();
}

/* ---------- live reference ---------- */

const liveBody = document.querySelector('#live-table tbody');
for (const p of RADAR.live) {
  const tr = el('tr');
  const nameTd = el('td');
  nameTd.append(el('span', 'name', p.name), el('span', 'slug', ' ' + p.slug));
  tr.append(
    nameTd,
    el('td', 'wrap', p.category || '—'),
    el('td', 'wrap', p.chains.length > 2 ? p.chains.slice(0, 2).join(', ') + ' +' + (p.chains.length - 2) : p.chains.join(', ') || '—'),
    el('td', 'num', usd(p.tvl_usd)),
    el('td', 'num', usd(p.mcap_usd)),
    el('td', 'num', p.mcap_tvl_ratio === null ? '—' : p.mcap_tvl_ratio.toFixed(3)),
    el('td', 'num ' + (p.change_7d === null ? '' : p.change_7d >= 0 ? 'pos' : 'neg'), pct(p.change_7d)),
  );
  liveBody.appendChild(tr);
}

/* ---------- tabs, sorting, filters, hash ---------- */

function setTab(live) {
  tabBoard.classList.toggle('active', !live);
  tabLive.classList.toggle('active', live);
  tabBoard.setAttribute('aria-selected', String(!live));
  tabLive.setAttribute('aria-selected', String(live));
  livePanel.hidden = !live;
  writeHash();
}
tabBoard.addEventListener('click', () => setTab(false));
tabLive.addEventListener('click', () => setTab(true));

document.querySelectorAll('#board-table th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortDir = -sortDir;
    else { sortKey = key; sortDir = key === 'name' || key === 'category' || key === 'chains' ? 1 : -1; }
    renderBoard();
  });
});

for (const input of [qInput, chainSelect, categorySelect, watchlistOnly, minValueSelect]) {
  input.addEventListener('input', () => { renderBoard(); writeHash(); });
}

(function initFromHash() {
  const h = readHash();
  if (h.q) qInput.value = h.q;
  if (h.chain && [...chainSelect.options].some((o) => o.value === h.chain)) chainSelect.value = h.chain;
  if (h.category && [...categorySelect.options].some((o) => o.value === h.category)) categorySelect.value = h.category;
  if (h.watchlist === '1') watchlistOnly.checked = true;
  if (h.min) minValueSelect.value = h.min;
  renderBoard();
  if (h.tab === 'live') setTab(true);
  if (h.detail) selectRow(h.detail);
})();
