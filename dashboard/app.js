// Token Launch Radar dashboard: board, detail view, filters, live comps, method.
// Renders from window.RADAR (data.js), no network, no framework.

const R = window.RADAR;
const $ = (id) => document.getElementById(id);

const fmtUsd = (v) => {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
};
const fmtPct = (v) => (v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%');
const pctCls = (v) => (v === null || v === undefined ? '' : v >= 0 ? 'up' : 'down');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const watchSet = new Set(R.watchlist); // the snapshot's own list: TVL alone cannot re-derive it
const WATCH = watchSet;

$('modelVersion').textContent = R.model_version;
$('srcLine').textContent = R.source + ' · as of ' + R.as_of;
$('statChips').innerHTML = [
  '<span class="chip"><b>' + R.board_size + '</b> rows</span>',
  '<span class="chip"><b>' + R.watchlist_size + '</b> watchlist</span>',
  '<span class="chip"><b>' + R.early_size + '</b> early</span>',
  '<span class="chip"><b>' + R.model_report.comps + '</b> trading comps</span>',
  '<span class="chip">as of <b>' + R.as_of + '</b></span>',
].join('');

const rep = R.model_report;
$('modelStrip').innerHTML =
  '<span class="eq">ln(mcap) = ' + rep.coefficients.intercept + ' + ' + rep.coefficients.log_tvl + '·ln(TVL) + ' +
  rep.coefficients.growth + '·growth + ' + rep.coefficients.log_age + '·ln(age+30) + ' + rep.coefficients.log_chains +
  '·ln(chains) + category effect</span> — fitted on ' + rep.comps + ' trading comps (' + rep.trimmed_outliers +
  ' wild multiple' + (rep.trimmed_outliers === 1 ? '' : 's') + ' trimmed), Huber-reweighted, blended 50/50 in log space with the TVL × median-multiple value. ' +
  '<span class="ok">Out of sample: leave-one-out median error ' + (rep.loocv.median_ape * 100).toFixed(1) +
  '% (' + (rep.loocv.within_2x * 100).toFixed(0) + '% of comps within 2×), time-split median error ' + (rep.time_split.median_ape * 100).toFixed(1) +
  '%.</span> Every row carries a 200-resample bootstrap band; thin comps are flagged, never hidden.';

// ---- controls ---------------------------------------------------------------
const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
for (const c of cats) $('fCat').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>');
for (const c of chains) $('fChain').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>');

function filtered() {
  const q = $('q').value.trim().toLowerCase();
  const cat = $('fCat').value;
  const chain = $('fChain').value;
  const verdict = $('fVerdict').value;
  const watchOnly = $('fWatch').checked;
  let rows = R.rows.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q))) return false;
    if (cat && r.category !== cat) return false;
    if (chain && !r.chains.includes(chain)) return false;
    if (verdict && r.verdict !== verdict) return false;
    if (watchOnly && !WATCH.has(r.slug)) return false;
    return true;
  });
  const sort = $('sort').value;
  const by = {
    implied: (a, b) => b.implied_value_usd - a.implied_value_usd,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    growth: (a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9),
    band: (a, b) => a.band_ratio - b.band_ratio,
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
  }[sort];
  return rows.sort(by);
}

function renderBoard() {
  const rows = filtered();
  $('rowCount').textContent = rows.length + ' of ' + R.board_size + ' protocols shown · ranked by implied value unless sorted otherwise';
  $('board').querySelector('tbody').innerHTML = rows.map((r) => (
    '<tr data-slug="' + esc(r.slug) + '">' +
    '<td>' + r.rank + '</td>' +
    '<td><b>' + esc(r.name) + '</b><br><span class="dim">' + esc(r.slug) + (WATCH.has(r.slug) ? ' · ★ watchlist' : '') + '</span></td>' +
    '<td>' + esc(r.category || '—') + '</td>' +
    '<td>' + esc(r.chains.slice(0, 2).join(', ') || '—') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
    '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
    '<td class="num ' + pctCls(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
    '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
    '<td class="num">' + fmtUsd(r.implied_p10_usd) + '–' + fmtUsd(r.implied_p90_usd) + '</td>' +
    '<td><span class="pill ' + r.verdict + '">' + r.verdict + '</span></td>' +
    '</tr>'
  )).join('');
}

// ---- detail -----------------------------------------------------------------
function openDetail(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  document.querySelectorAll('#board tbody tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.slug === slug));
  const farm = r.verdict === 'farm' ? 'Farm — high implied value on a narrow band.'
    : r.verdict === 'watch' ? 'Watch — the evidence is mixed; farm small or wait for a tighter band.'
    : 'Skip — the comps are thin and the band is wide; do not farm on this evidence.';
  $('detailBody').innerHTML =
    '<h2>' + esc(r.name) + '</h2>' +
    '<p class="dim">#' + r.rank + ' · ' + esc(r.slug) + ' · ' + esc(r.category || 'no category') + ' · ' + esc(r.chains.join(', ') || 'no chain') +
    (WATCH.has(r.slug) ? ' · ★ on the watchlist' : '') + '</p>' +
    '<div class="big">' + fmtUsd(r.implied_value_usd) + '</div>' +
    '<p class="dim">implied value · bootstrap band ' + fmtUsd(r.implied_p10_usd) + ' – ' + fmtUsd(r.implied_p90_usd) +
    ' (×' + r.band_ratio.toFixed(1) + ') · fitted multiple ' + r.fitted_multiple.toFixed(2) + '× TVL</p>' +
    '<p><span class="pill ' + r.verdict + '">' + r.verdict + '</span> ' + farm + '</p>' +
    (r.thin_comps ? '<div class="warn">Thin comps: only ' + r.comps_in_category + ' trading comp' + (r.comps_in_category === 1 ? '' : 's') + ' in this category, so the fit leans on the pooled line' + (r.band_ratio > 6 ? ' and the band is wide.' : '.') + '</div>' : '') +
    '<h3>The working</h3><div class="kv">' +
    '<div><span>TVL</span><span>' + fmtUsd(r.tvl_usd) + '</span></div>' +
    '<div><span>7d growth</span><span class="' + pctCls(r.change_7d) + '">' + fmtPct(r.change_7d) + '</span></div>' +
    '<div><span>Age</span><span>' + (r.age_days === null ? 'unknown' : r.age_days + ' days') + '</span></div>' +
    '<div><span>Chains</span><span>' + r.chains.length + '</span></div>' +
    '<div><span>Comps in category</span><span>' + r.comps_in_category + ' of ' + rep.comps + '</span></div>' +
    '<div><span>Listed</span><span>' + esc(r.listed_at || 'unknown') + '</span></div>' +
    '</div>' +
    '<h3>Farm plan — net cost $' + r.net_cost_usd.toFixed(2) + ' gas on $' + r.capital_usd + ' capital</h3>' +
    '<ol class="steps">' + r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' +
    '<p class="note">Capital comes back when you exit; the net cost is gas alone. Never pay anyone to claim for you.</p>';
  $('detail').classList.remove('hidden');
}

function closeDetail() {
  $('detail').classList.add('hidden');
  document.querySelectorAll('#board tbody tr').forEach((tr) => tr.classList.remove('sel'));
}

$('board').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-slug]');
  if (tr) openDetail(tr.dataset.slug);
});
$('detailClose').addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
['q', 'fCat', 'fChain', 'fVerdict', 'fWatch', 'sort'].forEach((id) => $(id).addEventListener('input', renderBoard));

// ---- tabs -------------------------------------------------------------------
document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
  $('tab-' + btn.dataset.tab).classList.remove('hidden');
  closeDetail();
}));

// ---- live comps ---------------------------------------------------------------
$('liveTable').querySelector('tbody').innerHTML = R.live.map((r) => (
  '<tr><td><b>' + esc(r.name) + '</b><br><span class="dim">' + esc(r.slug) + '</span></td>' +
  '<td>' + esc(r.category || '—') + '</td>' +
  '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
  '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
  '<td class="num">' + r.mcap_tvl.toFixed(2) + '×</td>' +
  '<td class="num ' + pctCls(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td></tr>'
)).join('');

// ---- method -------------------------------------------------------------------
$('methodBody').innerHTML = '<div class="method">' +
  '<h2>The model — comps-fitted, tested out of sample</h2>' +
  '<p>Implied value is fitted, not asserted. The model regresses <code>ln(market cap)</code> on <code>ln(TVL)</code>, seven-day growth, <code>ln(age + 30)</code> and <code>ln(chains)</code>, plus one effect per category with at least five trading comps, over the <b>' + rep.comps + '</b> protocols whose tokens already trade. Comps whose multiple sits beyond three robust standard deviations from the median are trimmed before the fit (' + rep.trimmed_outliers + ' trimmed); the fit is reweighted twice with Huber weights so one wild multiple cannot drag the line; category effects shrink toward the pooled line by n/(n+5). The point estimate blends the fitted value with the TVL × median-multiple value, halfway in log space (median multiple ' + rep.median_multiple.toFixed(3) + '×): the blend beats either part alone out of sample, because the fit is noisy and the median is dumb. No protocol name is ever special-cased: the same function scores every row. Residual spread around the line is ' + rep.resid_sd.toFixed(2) + ' log points.</p>' +
  '<h2>Validation — the fit is tested, not trusted</h2>' +
  '<p>Leave-one-out cross-validation over all ' + rep.loocv.n + ' comps: each comp is predicted by a fit that never saw it. Median error <b>' + (rep.loocv.median_ape * 100).toFixed(1) + '%</b>, mean ' + (rep.loocv.mean_ape * 100).toFixed(1) + '%, ' + (rep.loocv.within_2x * 100).toFixed(0) + '% of comps predicted within 2×, out-of-sample R² (log scale) ' + rep.loocv.r2_log.toFixed(2) + '. Time split: fitted on the ' + rep.time_split.n_train + ' older-listed comps and tested on the ' + rep.time_split.n_test + ' newer ones, median error ' + (rep.time_split.median_ape * 100).toFixed(1) + '%. A 200-resample bootstrap (fixed seed) gives every row a p10–p90 band; the fitted log-TVL coefficient moves by only ±' + rep.bootstrap.coef_sd.log_tvl.toFixed(2) + ' across resamples, so the line holds still.</p>' +
  '<h2>The board</h2>' +
  '<p>All <b>' + R.board_size + '</b> rankable pre-token protocols: the ' + R.watchlist_size + '-protocol watchlist plus ' + R.early_size + ' early protocols below the $50M floor. Ranked by fitted implied value, highest first. Wrapped, staked and bridged products are excluded by the same rule the watchlist uses (category, version markers, wrapped/staked words, exchange prefixes), so the board holds launches, not wrappers. Protocols that record no token are described as recording no token — the snapshot is a record, not proof.</p>' +
  '<h2>Farm plans — netted to the dollar</h2>' +
  '<p>Every row carries eight steps with a gas cost on its own chain and a time, and the plan closes with its total net gas cost. Capital is tiered by TVL ($200 / $120 / $60) and comes back on exit, so it is never counted as a cost. Verdict: <b>farm</b> where the implied value clears $25M on a band ×4 or narrower; <b>skip</b> where the comps are thin (fewer than 3 in the category) and the band is wider than ×6; <b>watch</b> otherwise. The band already carries the uncertainty, so the verdict reads the band first — a narrow band on a valuable row is a farm even when its category is young. Thin or skip: a row the evidence cannot support is marked, not dressed up.</p>' +
  '<h2>What this is not</h2>' +
  '<p>This radar does not predict whether or when a token launches. Implied value answers one question: what would the token be worth if the protocol launched at the multiple its trading peers support, on the record as it stands. That is this entry\u2019s own claim, never make.fun\u2019s.</p>' +
  '</div>';

// ---- hash state (for screenshots): #detail=<slug> or #verdict=farm etc. --------
(function fromHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('verdict')) $('fVerdict').value = h.get('verdict');
  if (h.get('category')) $('fCat').value = h.get('category');
  if (h.get('watch') === '1') $('fWatch').checked = true;
  if (h.get('q')) $('q').value = h.get('q');
  renderBoard();
  if (h.get('detail')) openDetail(h.get('detail'));
})();
