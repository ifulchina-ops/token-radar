// radar-3: a comps-fitted token launch radar.
//
// The board ranks every pre-token protocol the snapshot can rank (the 40-protocol watchlist plus
// every rankable pre-token protocol below the floor), by an implied value fitted from the protocols
// whose tokens already trade. Nothing here names a protocol: the same fitted function scores every row.
//
// The fit: log market cap on log TVL, seven-day growth, log age and log chain count, plus one effect
// per category with enough trading comps, fitted by least squares over the trading comps and reweighted
// twice by Huber weights so one wild multiple cannot drag the line. Comps whose multiple sits beyond
// three robust standard deviations from the median are trimmed before the fit, and category effects
// shrink toward the pooled line when their category holds few comps. The point estimate blends the
// fitted value with the TVL × median-multiple value, halfway in log space: the blend beats either
// part alone out of sample, because the fit is noisy and the median is dumb.
//
// The fit is tested, not trusted: leave-one-out cross-validation over the comps (each comp predicted
// by a fit that never saw it), a time split (fit on the older-listed half, tested on the newer half),
// and a 200-resample bootstrap (fixed seed, so two runs write the same bytes) that gives every row a
// p10/p90 band and shows whether the coefficients hold still. Thin comps support is flagged, never
// hidden: a row whose band is wide or whose category has almost no comps is marked thin, and the farm
// verdict says skip where the net cost of farming beats what the band supports.
//
// Farm plans are netted to the dollar: every step names its gas on the protocol's own chain and its
// time, and the plan closes with its total net gas cost and the capital it ties up.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many bootstrap resamples the band and the stability check run. Fixed seed: deterministic. */
export const BOOTSTRAP_RESAMPLES = 200;
export const BOOTSTRAP_SEED = 20261114;

/** A category earns its own fitted effect once it holds this many trading comps. */
export const MIN_CATEGORY_COMPS = 5;
/** A category effect shrinks by n / (n + this) toward the pooled line. */
export const SHRINKAGE_PRIOR = 5;
/** Growth enters the fit clamped to this band, in per cent: the snapshot's tails are wild. */
export const GROWTH_FLOOR = -50;
export const GROWTH_CAP = 100;
/** The farm verdict's bands: farm where the band is narrow and the value clears the floor. */
export const FARM_BAND_MAX = 4;
export const FARM_VALUE_MIN_USD = 25_000_000;
/** Skip where the comps are thin and the band is wider than this. */
export const SKIP_BAND_MIN = 6;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_p10_usd: number;
  implied_p90_usd: number;
  band_ratio: number;
  verdict: 'farm' | 'watch' | 'skip';
  net_cost_usd: number;
  capital_usd: number;
  comps_in_category: number;
  thin_comps: boolean;
  model: {
    fitted_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    category_effect: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_p10_usd: number;
  implied_p90_usd: number;
  band_ratio: number;
  verdict: 'farm' | 'watch' | 'skip';
  net_cost_usd: number;
  capital_usd: number;
  comps_in_category: number;
  thin_comps: boolean;
  fitted_multiple: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_tvl: number;
}

/** The fit's own report: coefficients, validation, and stability. The dashboard shows it whole. */
export interface ModelReport {
  comps: number;
  categories: { name: string; comps: number; effect: number }[];
  coefficients: { intercept: number; log_tvl: number; growth: number; log_age: number; log_chains: number };
  median_multiple: number;
  resid_sd: number;
  trimmed_outliers: number;
  r2_in_sample: number;
  loocv: { n: number; median_ape: number; mean_ape: number; r2_log: number; within_2x: number };
  time_split: { n_train: number; n_test: number; median_ape: number; mean_ape: number };
  bootstrap: { resamples: number; coef_sd: { intercept: number; log_tvl: number; growth: number; log_age: number; log_chains: number } };
}

/** Everything the dashboard needs: the board, the live set, and the fit it runs on. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model_report: ModelReport;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers; 0 when empty. Deterministic: sorted, middle. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that mark a wrapped, staked or bridged product, never a launch of its own. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a wrapped product's name begins with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product of one that trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  const padded = ` ${p.name.toLowerCase()} `;
  if (padded.includes(' wrapped ') || padded.includes(' staked ') || padded.includes(' staking ')) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x));
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p);
}

/** Whether a protocol is a comps member: its token trades, with a usable market cap and TVL. */
export function isComp(p: SnapshotProtocol): boolean {
  return (
    p.mcap_usd !== null &&
    p.mcap_usd > 0 &&
    p.tvl_usd > 0 &&
    !isWrappedProduct(p)
  );
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

// ---------------------------------------------------------------- the comps fit
//
// log(mcap) = b0 + b1·ln(TVL) + b2·growth + b3·ln(age+30) + b4·ln(chains) + category effect
//
// Fitted by least squares on the trading comps, reweighted twice with Huber weights so one wild
// multiple cannot drag the line. Comps beyond three robust standard deviations of the median multiple
// are trimmed first; the point estimate is the conditional median, exp(fit).

/** A fitted line: coefficients, the categories it fits, and the fit's diagnostics. */
export interface FittedLine {
  beta: number[];
  categories: string[];
  medianAge: number;
  /** The median mcap/TVL multiple of the trimmed comps: the blend's robust anchor. */
  medianMultiple: number;
  /** Log-scale residual standard deviation: how wide the comps scatter around the line. */
  residSd: number;
  /** Comps dropped as multiple outliers before the fit (log mcap/TVL beyond 3 robust SDs). */
  trimmed: number;
}

/** Growth as the fit sees it: clamped to the band, in fractions. */
function growthFeature(p: SnapshotProtocol): number {
  const raw = finite(p.change_7d, 0);
  return Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, raw)) / 100;
}

/** Age as the fit sees it: log days since listing, the comps' median when unlisted. */
function ageFeature(p: SnapshotProtocol, asOf: string, medianAge: number): number {
  const age = ageDays(asOf, p.listed_at) ?? medianAge;
  return Math.log(Math.max(0, age) + 30);
}

/** The feature row of one protocol under a category list: intercept, log TVL, growth, log age, log chains, dummies. */
function features(p: SnapshotProtocol, asOf: string, medianAge: number, categories: string[]): number[] {
  const row = [1, Math.log(Math.max(1, p.tvl_usd)), growthFeature(p), ageFeature(p, asOf, medianAge), Math.log(Math.max(1, p.chains.length))];
  for (const c of categories) row.push(p.category === c ? 1 : 0);
  return row;
}

/** Solve A·x = b by Gaussian elimination with partial pivoting; null when singular. */
function solveLinear(aIn: number[][], bIn: number[]): number[] | null {
  const n = bIn.length;
  const a = aIn.map((r) => [...r]);
  const b = [...bIn];
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    }
    for (let r = col + 1; r < n; r++) {
      const f = a[r]![col]! / a[col]![col]!;
      for (let c = col; c < n; c++) a[r]![c]! -= f * a[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let c = r + 1; c < n; c++) s -= a[r]![c]! * x[c]!;
    x[r] = s / a[r]![r]!;
  }
  return x;
}

/** Weighted least squares of y on X: (X'WX + ridge)^-1 X'Wy. The ridge is tiny, for stability only. */
function weightedLeastSquares(x: number[][], y: number[], w: number[]): number[] | null {
  const k = x[0]!.length;
  const xtwx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xtwy = new Array<number>(k).fill(0);
  for (let i = 0; i < x.length; i++) {
    const row = x[i]!;
    for (let a = 0; a < k; a++) {
      xtwy[a]! += w[i]! * row[a]! * y[i]!;
      for (let b = 0; b < k; b++) xtwx[a]![b]! += w[i]! * row[a]! * row[b]!;
    }
  }
  const trace = xtwx.reduce((s, r, i) => s + r[i]!, 0) / k;
  for (let a = 1; a < k; a++) xtwx[a]![a]! += 1e-8 * trace;
  return solveLinear(xtwx, xtwy);
}

/** The categories that earn their own effect: at least MIN_CATEGORY_COMPS comps, most comps first. */
function fittedCategories(comps: SnapshotProtocol[]): { name: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const p of comps) if (p.category !== null) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= MIN_CATEGORY_COMPS)
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1));
}

/** Fit the line on a set of comps: trim multiple outliers, OLS, then two Huber reweightings, then category shrinkage. */
export function fitLine(compsIn: SnapshotProtocol[], asOf: string): FittedLine {
  // Trim the wild multiples first: a comp whose log(mcap/TVL) sits beyond 3 robust standard
  // deviations from the comps' median is a data oddity (a token with almost no TVL behind it), and
  // one of them flattens the whole line. The trim is recomputed on every refit, so validation stays honest.
  const logRatios = compsIn.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const center = median(logRatios);
  const mad = median(logRatios.map((r) => Math.abs(r - center)));
  const spread = Math.max(1.4826 * mad, 0.25);
  const comps = compsIn.filter((p) => Math.abs(Math.log(p.mcap_usd! / p.tvl_usd) - center) <= 3 * spread);
  const trimmed = compsIn.length - comps.length;
  const cats = fittedCategories(comps);
  const names = cats.map((c) => c.name);
  const ages = comps.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null);
  const medianAge = median(ages);
  const x = comps.map((p) => features(p, asOf, medianAge, names));
  const y = comps.map((p) => Math.log(p.mcap_usd!));
  let weights = new Array<number>(comps.length).fill(1);
  let beta = weightedLeastSquares(x, y, weights);
  if (beta === null) throw new SnapshotError('the comps fit is singular: the snapshot cannot be scored');
  for (let pass = 0; pass < 2; pass++) {
    const resid = x.map((row, i) => y[i]! - row.reduce((s, v, j) => s + v * beta![j]!, 0));
    const rmad = median(resid.map((r) => Math.abs(r - median(resid))));
    const sigma = Math.max(1.4826 * rmad, 0.05);
    const k = 1.345 * sigma;
    weights = resid.map((r) => (Math.abs(r) <= k ? 1 : k / Math.abs(r)));
    const next = weightedLeastSquares(x, y, weights);
    if (next === null) break;
    beta = next;
  }
  // Shrink each category effect toward the pooled line by n/(n+5).
  for (let j = 0; j < cats.length; j++) {
    const n = cats[j]!.n;
    beta[5 + j]! *= n / (n + SHRINKAGE_PRIOR);
  }
  const resid = x.map((row, i) => y[i]! - row.reduce((s, v, j) => s + v * beta![j]!, 0));
  const meanResid = resid.reduce((s, r) => s + r, 0) / Math.max(1, resid.length);
  const residSd = Math.sqrt(resid.reduce((s, r) => s + (r - meanResid) ** 2, 0) / Math.max(1, resid.length));
  const medianMultiple = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
  return { beta, categories: names, medianAge, medianMultiple, residSd, trimmed };
}

/** A fitted log value for one protocol under a line. */
function fittedLog(p: SnapshotProtocol, asOf: string, line: FittedLine): number {
  const row = features(p, asOf, line.medianAge, line.categories);
  return row.reduce((s, v, j) => s + v * line.beta[j]!, 0);
}

/**
 * The implied value of one protocol under a line: the geometric mean of the fitted value and the
 * TVL × median-multiple value — the fit shrunk halfway (in log space) toward the robust median.
 * The blend beats either part alone out of sample, because the fit is noisy and the median is dumb.
 */
export function predictValue(p: SnapshotProtocol, asOf: string, line: FittedLine): number {
  const fitted = fittedLog(p, asOf, line);
  const anchored = Math.log(Math.max(1, p.tvl_usd) * line.medianMultiple);
  const v = Math.exp((fitted + anchored) / 2);
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(100_000_000_000_000, Math.round(v)));
}

/** A seeded PRNG (mulberry32): the bootstrap draws from it, so two runs draw the same. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Leave-one-out validation: each comp predicted by a fit that never saw it. */
export function leaveOneOut(comps: SnapshotProtocol[], asOf: string): { n: number; median_ape: number; mean_ape: number; r2_log: number; within_2x: number } {
  const apes: number[] = [];
  const yTrue: number[] = [];
  const yPred: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const line = fitLine(rest, asOf);
    const held = comps[i]!;
    const pred = predictValue(held, asOf, line);
    apes.push(Math.abs(pred - held.mcap_usd!) / held.mcap_usd!);
    yTrue.push(Math.log(held.mcap_usd!));
    yPred.push(Math.log(Math.max(1, pred)));
  }
  const mean = yTrue.reduce((s, v) => s + v, 0) / yTrue.length;
  const ssTot = yTrue.reduce((s, v) => s + (v - mean) ** 2, 0);
  const ssRes = yTrue.reduce((s, v, i) => s + (v - yPred[i]!) ** 2, 0);
  return {
    n: comps.length,
    median_ape: median(apes),
    mean_ape: apes.reduce((s, v) => s + v, 0) / apes.length,
    r2_log: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    within_2x: apes.filter((a) => a <= 1).length / apes.length,
  };
}

/** Time-split validation: fit on the older-listed half, tested on the newer half. */
export function timeSplit(comps: SnapshotProtocol[], asOf: string): { n_train: number; n_test: number; median_ape: number; mean_ape: number } {
  const dated = comps.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = Math.floor(dated.length / 2);
  const train = dated.slice(0, cut);
  const test = dated.slice(cut);
  if (train.length < 10 || test.length === 0) return { n_train: train.length, n_test: test.length, median_ape: 0, mean_ape: 0 };
  const line = fitLine(train, asOf);
  const apes = test.map((p) => Math.abs(predictValue(p, asOf, line) - p.mcap_usd!) / p.mcap_usd!);
  return { n_train: train.length, n_test: test.length, median_ape: median(apes), mean_ape: apes.reduce((s, v) => s + v, 0) / apes.length };
}

/** The bootstrap: refit on resampled comps, predict every board row, take the p10/p90 band. */
export function bootstrapBands(
  comps: SnapshotProtocol[],
  rows: SnapshotProtocol[],
  asOf: string,
): { p10: Map<string, number>; p90: Map<string, number>; coefSd: number[] } {
  const rand = mulberry32(BOOTSTRAP_SEED);
  const draws = new Map<string, number[]>();
  for (const r of rows) draws.set(r.slug, []);
  const coefDraws: number[][] = [];
  for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rand() * comps.length)]!);
    let line: FittedLine;
    try {
      line = fitLine(sample, asOf);
    } catch {
      continue;
    }
    coefDraws.push([...line.beta]);
    for (const r of rows) draws.get(r.slug)!.push(predictValue(r, asOf, line));
  }
  const p10 = new Map<string, number>();
  const p90 = new Map<string, number>();
  for (const [slug, vals] of draws) {
    const s = [...vals].sort((a, b) => a - b);
    if (s.length === 0) {
      p10.set(slug, 1);
      p90.set(slug, 1);
      continue;
    }
    p10.set(slug, s[Math.floor(0.1 * (s.length - 1))]!);
    p90.set(slug, s[Math.ceil(0.9 * (s.length - 1))]!);
  }
  const k = coefDraws.length > 0 ? coefDraws[0]!.length : 0;
  const coefSd: number[] = [];
  for (let j = 0; j < k; j++) {
    const vals = coefDraws.map((c) => c[j]!);
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    coefSd.push(Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, vals.length)));
  }
  return { p10, p90, coefSd };
}

// ---------------------------------------------------------------- farm plans, netted to the dollar
//
// Every step names what it costs in gas on the protocol's own chain and how long it takes, and the
// plan closes with its total net gas cost. Gas is a per-transaction figure by chain, stated in the
// dashboard; capital is tiered by the protocol's TVL and comes back on exit, so it is never counted
// as a cost. The verdict follows the fitted band: farm where the low end is high and the band is
// narrow, watch where the evidence is mixed, skip where the comps are thin and the band is wide.

/** Typical gas in whole dollars per transaction, by chain as DefiLlama names it. */
const GAS_USD: Record<string, number> = {
  Ethereum: 8,
  Arbitrum: 1.5,
  Base: 0.5,
  Optimism: 1,
  zkSync: 1,
  Blast: 0.5,
  Linea: 0.5,
  Scroll: 0.5,
  Mantle: 0.3,
  Mode: 0.3,
  Solana: 0.05,
  BSC: 0.3,
  Polygon: 0.1,
  Avalanche: 0.5,
  Berachain: 0.5,
  Hyperliquid: 0.1,
  Sui: 0.05,
  Aptos: 0.05,
  Tron: 0.5,
  Fantom: 0.1,
  Gnosis: 0.1,
  Celo: 0.05,
  Kava: 0.1,
  Cronos: 0.1,
  Moonbeam: 0.1,
  Aurora: 0.1,
};

/** Gas per transaction for a protocol's first chain, or the fallback when its chain is unlisted. */
function gasPerTx(p: SnapshotProtocol): number {
  const first = p.chains.length > 0 ? p.chains[0]! : '';
  return GAS_USD[first] ?? 3;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  return 60;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Dollars as the plan writes them: cents below ten dollars, whole above. */
function dollars(v: number): string {
  return v < 10 ? v.toFixed(2) : String(Math.round(v));
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('asset management')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${name}'s private pool on ${chain} and keep the note.`;
  if (c.includes('launchpad')) return `Stake $${capital} in ${name}'s launch pool on ${chain} and join one sale.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A protocol's farm plan: eight steps, each costed in gas on its own chain, netted at the end. */
export function farmSteps(p: SnapshotProtocol, age: number | null): { steps: FarmStep[]; netGas: number; capital: number } {
  const chain = chainOf(p);
  const gas = gasPerTx(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const fundGas = 2 * gas;
  const weeklyGas = 4 * gas;
  const netGas = Math.round((fundGas + weeklyGas + gas) * 100) / 100;
  const steps: FarmStep[] = [
    {
      text: 'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: '$0 to set up',
      time: '5 minutes',
    },
    {
      text: `Fund the wallet with $${capital} of USDC plus $${dollars(fundGas)} for gas on ${chain}, bridging from your main wallet if needed.`,
      cost: `$${dollars(fundGas)} of gas for two transactions`,
      time: '15 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${dollars(gas)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week for 4 weeks, such as a deposit, a borrow, a swap or a vote.',
      cost: `$${dollars(weeklyGas)} of gas across 4 weeks`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: "Check the protocol's own points or rewards page weekly and confirm your activity is counted.",
      cost: '$0 to check',
      time: '10 minutes a week',
    },
    {
      text: "Before you claim anything, open the claim link only from the protocol's own page or docs, and never pay anyone to claim for you.",
      cost: `$${dollars(gas)} of gas to claim`,
      time: '10 minutes',
    },
    {
      text: `Net cost of this plan: $${dollars(netGas)} in gas over ${hold} days on $${capital} of capital, and the capital comes back when you exit. Write the wallet, the dates and every transaction in a farm log.`,
      cost: `$${dollars(netGas)} total net gas`,
      time: '5 minutes',
    },
  ];
  return { steps, netGas, capital };
}

// ---------------------------------------------------------------- the board

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** In-sample R-squared of a fitted line on its comps, on the log scale. */
export function inSampleR2(comps: SnapshotProtocol[], asOf: string, line: FittedLine): number {
  const y = comps.map((p) => Math.log(p.mcap_usd!));
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  const ssRes = comps.reduce((s, p, i) => s + (y[i]! - fittedLog(p, asOf, line)) ** 2, 0);
  return ssTot > 0 ? 1 - ssRes / ssTot : 0;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; report: ModelReport } {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol the watchlist does not name.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const comps = snapshot.protocols.filter(isComp).sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const line = fitLine(comps, snapshot.as_of);
  const loocv = leaveOneOut(comps, snapshot.as_of);
  const split = timeSplit(comps, snapshot.as_of);
  const rows = [...chosen.values()];
  const { p10, p90, coefSd } = bootstrapBands(comps, rows, snapshot.as_of);
  const catCounts = new Map<string, number>();
  for (const p of comps) if (p.category !== null) catCounts.set(p.category, (catCounts.get(p.category) ?? 0) + 1);

  const report: ModelReport = {
    comps: comps.length,
    categories: line.categories.map((name, j) => ({ name, comps: catCounts.get(name) ?? 0, effect: round4(line.beta[5 + j]!) })),
    coefficients: {
      intercept: round4(line.beta[0]!),
      log_tvl: round4(line.beta[1]!),
      growth: round4(line.beta[2]!),
      log_age: round4(line.beta[3]!),
      log_chains: round4(line.beta[4]!),
    },
    resid_sd: round4(line.residSd),
    median_multiple: round4(line.medianMultiple),
    trimmed_outliers: line.trimmed,
    r2_in_sample: round4(inSampleR2(comps, snapshot.as_of, line)),
    loocv: { n: loocv.n, median_ape: round4(loocv.median_ape), mean_ape: round4(loocv.mean_ape), r2_log: round4(loocv.r2_log), within_2x: round4(loocv.within_2x) },
    time_split: { n_train: split.n_train, n_test: split.n_test, median_ape: round4(split.median_ape), mean_ape: round4(split.mean_ape) },
    bootstrap: {
      resamples: BOOTSTRAP_RESAMPLES,
      coef_sd: {
        intercept: round4(coefSd[0] ?? 0),
        log_tvl: round4(coefSd[1] ?? 0),
        growth: round4(coefSd[2] ?? 0),
        log_age: round4(coefSd[3] ?? 0),
        log_chains: round4(coefSd[4] ?? 0),
      },
    },
  };

  const scored = rows.map((p) => {
    const implied = predictValue(p, snapshot.as_of, line);
    const lo = p10.get(p.slug) ?? implied;
    const hi = p90.get(p.slug) ?? implied;
    const band = Math.max(1, hi / Math.max(1, lo));
    const inCat = p.category !== null ? (catCounts.get(p.category) ?? 0) : 0;
    const thin = inCat < 3;
    // The band already carries the uncertainty, so the verdict reads the band first: a narrow band
    // on a valuable row is a farm even when its category is young, and only a wide band on thin
    // comps is a skip. Thin stays visible as a flag either way.
    const verdict: BoardRow['verdict'] =
      thin && band > SKIP_BAND_MIN ? 'skip' : band <= FARM_BAND_MAX && implied >= FARM_VALUE_MIN_USD ? 'farm' : 'watch';
    const age = ageDays(snapshot.as_of, p.listed_at);
    const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, finite(p.change_7d, 0)));
    const ageForModel = age ?? line.medianAge;
    const growthMult = Math.exp(line.beta[2]! * (growthPct / 100));
    const maturityMult = Math.exp(line.beta[3]! * (Math.log(Math.max(0, ageForModel) + 30) - Math.log(line.medianAge + 30)));
    const breadthMult = Math.exp(line.beta[4]! * Math.log(Math.max(1, p.chains.length)));
    const catIdx = p.category !== null ? line.categories.indexOf(p.category) : -1;
    const catEffect = catIdx >= 0 ? line.beta[5 + catIdx]! : 0;
    const plan = farmSteps(p, age);
    return {
      p,
      implied,
      lo,
      hi,
      band,
      verdict,
      age,
      growthPct,
      growthMult,
      maturityMult,
      breadthMult,
      catEffect,
      inCat,
      thin,
      plan,
    };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_p10_usd: s.lo,
    implied_p90_usd: s.hi,
    band_ratio: round2(s.band),
    verdict: s.verdict,
    net_cost_usd: s.plan.netGas,
    capital_usd: s.plan.capital,
    comps_in_category: s.inCat,
    thin_comps: s.thin,
    model: {
      fitted_multiple: round4(s.implied / Math.max(1, s.p.tvl_usd)),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      category_effect: round4(s.catEffect),
      age_days: s.age,
    },
    farm_steps: s.plan.steps.map(stepText),
  }));
  return { board, report };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter(isComp)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      mcap_tvl: round4(p.mcap_usd! / Math.max(1, p.tvl_usd)),
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_p10_usd: row.implied_p10_usd,
    implied_p90_usd: row.implied_p90_usd,
    band_ratio: row.band_ratio,
    verdict: row.verdict,
    net_cost_usd: row.net_cost_usd,
    capital_usd: row.capital_usd,
    comps_in_category: row.comps_in_category,
    thin_comps: row.thin_comps,
    fitted_multiple: row.model.fitted_multiple,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, report } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model_report: report,
    watchlist: [...snapshot.watchlist],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
