// lib/model.ts — the token launch radar's model, written for this entry.
//
// One sealed DefiLlama snapshot in, one ranked board out. The board covers the snapshot's whole
// watchlist (pre-token protocols at or above the $50M TVL floor) and fills the rest of its 200
// rows with pre-token protocols below the floor that pass the same hygiene the watchlist rule
// uses, so the radar also surfaces early protocols before they reach the floor.
//
// The value model is fitted on the snapshot's own tokenised peers (protocols that already record
// a market cap), never on a hardcoded list of names:
//   1. a size curve: OLS in log10 space, log10(mcap) = a + b * log10(tvl), over every peer;
//   2. a category multiple: the median mcap/TVL of the protocol's category peers, shrunk toward
//      the global median multiple with weight n/(n+6);
//   3. a category curve: for categories with at least 8 tokenised peers, their own log-log OLS,
//      shrunk toward the global fit with weight n/(n+8);
//   4. the base log-value blends the estimates: 50/50 size curve and category multiple, or
//      40/30/30 when a category curve exists for the protocol's category;
//   5. momentum (7-day TVL change) and track record (age since first tracked) adjust it.
// Every row also carries a confidence score built from the category's peer count, the fit
// quality of the curve that priced it, and how far its TVL sits from its category peers'.
// Every figure the dashboard shows is recomputed from the snapshot by this file.

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
export interface Protocol {
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

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** One category's own log-log fit, shrunk toward the global fit by peer count. */
export interface CategoryFit {
  n: number;
  a: number;
  b: number;
  r2: number;
  /** Shrinkage weight the category's own line kept: n/(n+8). */
  weight: number;
}

/** Peer support for one category: how many tokenised peers and their median log10 TVL. */
export interface CategoryPeerStats {
  n: number;
  medianLogTvl: number;
}

/** The fitted peer model: size curve, global multiple and per-category multiples. */
export interface Fit {
  peers: number;
  a: number;
  b: number;
  r2: number;
  globalMultiple: number;
  /** Median log10 TVL over all tokenised peers, the confidence distance anchor. */
  peerMedianLogTvl: number;
  categoryMultiples: Map<string, { n: number; multiple: number }>;
  /** Own log-log fits, only for categories with at least 8 tokenised peers. */
  categoryFits: Map<string, CategoryFit>;
  categoryPeerStats: Map<string, CategoryPeerStats>;
}

/** The full model breakdown of one row: every component that produced its implied value. */
export interface ModelBreakdown {
  /** Estimate from the global log-log size curve. */
  size_curve_usd: number;
  /** The shrunk category multiple applied to the row's TVL. */
  category_multiple: number;
  /** Estimate from that multiple: TVL times the multiple. */
  category_multiple_usd: number;
  /** Estimate from the category's own shrunk log-log fit, or null when the category has none. */
  category_curve_usd: number | null;
  /** Tokenised peers behind the category fit, 0 when there is none. */
  category_fit_peers: number;
  /** R2 of the category fit, or null when there is none. */
  category_fit_r2: number | null;
  /** Blend weights actually used, in log space: size curve / category multiple / category curve. */
  weights: { size: number; multiple: number; curve: number };
  /** The blended base value before momentum and track-record factors. */
  base_value_usd: number;
  momentum_factor: number;
  age_factor: number;
  /** Confidence in the estimate, 0..1, from peer count, fit quality and TVL distance. */
  confidence: number;
  confidence_tier: 'High' | 'Medium' | 'Low';
}

/** One scored candidate before ranks are assigned. */
interface Scored {
  p: Protocol;
  watchlist: boolean;
  implied: number;
  low: number;
  high: number;
  sizeCurveValue: number;
  categoryMultiple: number;
  momentumFactor: number;
  ageFactor: number;
  ageYears: number | null;
  breakdown: ModelBreakdown;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  implied_value_usd: number;
  model_breakdown: ModelBreakdown;
  farm_steps: string[];
}

/** The cost/time summary of one row's farm plan, shown in the detail view. */
export interface FarmSummary {
  total_cost_usd: number;
  setup_time: string;
  weekly_upkeep: string;
  horizon: string;
  /** Plan duration in weeks, derived from the protocol's TVL tier and category. */
  weeks: number;
  /** Minutes of upkeep work per week. */
  weekly_minutes: number;
  /** The itemised cost table behind total_cost_usd, in display order. */
  costs: { label: string; usd: number }[];
  /** Risk notes for this protocol, from its category and its snapshot figures. */
  risks: string[];
}

/** One row as the dashboard consumes it: every display field, in a fixed key order. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change7d: number | null;
  listedAt: string | null;
  ageYears: number | null;
  watchlist: boolean;
  implied: number;
  low: number;
  high: number;
  multiple: number;
  momentumFactor: number;
  ageFactor: number;
  categoryMultiple: number;
  sizeCurveValue: number;
  /** The row's full model breakdown, the same object board.json carries. */
  breakdown: ModelBreakdown;
  farmSteps: string[];
  farmSummary: FarmSummary;
}

/** Everything dataScript serialises for the dashboard. */
export interface Radar {
  asOf: string;
  stats: {
    protocolsScanned: number;
    watchlistCount: number;
    rows: number;
    peerCount: number;
    fit: { a: number; b: number; r2: number };
    globalMultiple: number;
    /** How many categories earned their own shrunk log-log fit (8+ tokenised peers). */
    categoryFitCount: number;
  };
  categoryMultiples: { category: string | null; peers: number; multiple: number }[];
  rows: RadarRow[];
}

const DAY_MS = 86_400_000;

/** Round to a fixed number of decimals, for stable serialised figures. */
function roundTo(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Clamp `n` into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`, both YYYY-MM-DD read as UTC; null when unusable. */
function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((a - b) / DAY_MS);
}

/** Parse and validate the sealed snapshot; throws a plain Error naming the first problem. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('snapshot is not an object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || doc.as_of.length === 0) throw new Error('snapshot.as_of is missing');
  if (typeof doc.floor_usd !== 'number' || !(doc.floor_usd > 0)) throw new Error('snapshot.floor_usd is missing');
  if (!Array.isArray(doc.protocols) || doc.protocols.length === 0) throw new Error('snapshot.protocols is missing');
  if (!Array.isArray(doc.watchlist)) throw new Error('snapshot.watchlist is missing');
  const protocols: Protocol[] = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`protocols[${i}] is not an object`);
    const p = entry as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    if (typeof p.slug !== 'string' || p.slug.length === 0) throw new Error(`protocols[${i}].slug is missing`);
    if (typeof p.name !== 'string' || p.name.length === 0) throw new Error(`protocols[${i}].name is missing`);
    if (typeof p.tvl_usd !== 'number') throw new Error(`protocols[${i}].tvl_usd is missing`);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  const watchlist = doc.watchlist.filter((s): s is string => typeof s === 'string');
  return {
    as_of: doc.as_of,
    source: typeof doc.source === 'string' ? doc.source : '',
    floor_usd: doc.floor_usd,
    protocols,
    watchlist,
  };
}

/** Ordinary least squares in log10 space over paired points: y = a + b*x, with R2. */
function fitLine(xs: number[], ys: number[]): { a: number; b: number; r2: number } {
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varX = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i]! - meanX) * (ys[i]! - meanY);
    varX += (xs[i]! - meanX) ** 2;
    ssTot += (ys[i]! - meanY) ** 2;
  }
  const b = varX > 0 ? cov / varX : 0;
  const a = meanY - b * meanX;
  let ssRes = 0;
  for (let i = 0; i < n; i++) ssRes += (ys[i]! - (a + b * xs[i]!)) ** 2;
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { a, b, r2 };
}

/** Minimum tokenised peers for a category to earn its own log-log fit. */
const CATEGORY_FIT_MIN_PEERS = 8;

/** Fit the peer model: the log-log size curve, shrunk category multiples and category fits. */
export function fitPeers(snapshot: Snapshot): Fit {
  const peers = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const global = fitLine(
    peers.map((p) => Math.log10(p.tvl_usd)),
    peers.map((p) => Math.log10(p.mcap_usd!)),
  );
  const globalMultiple = median(peers.map((p) => p.mcap_usd! / p.tvl_usd));
  const peerMedianLogTvl = median(peers.map((p) => Math.log10(p.tvl_usd)));
  const byCategory = new Map<string, Protocol[]>();
  for (const p of peers) {
    const key = p.category ?? '';
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  const categoryMultiples = new Map<string, { n: number; multiple: number }>();
  const categoryFits = new Map<string, CategoryFit>();
  const categoryPeerStats = new Map<string, CategoryPeerStats>();
  for (const [key, members] of byCategory) {
    const ratios = members.map((p) => p.mcap_usd! / p.tvl_usd);
    const catMedian = median(ratios);
    const multiple = (ratios.length * catMedian + 6 * globalMultiple) / (ratios.length + 6);
    categoryMultiples.set(key, { n: ratios.length, multiple });
    categoryPeerStats.set(key, { n: members.length, medianLogTvl: median(members.map((p) => Math.log10(p.tvl_usd))) });
    if (members.length >= CATEGORY_FIT_MIN_PEERS) {
      const own = fitLine(
        members.map((p) => Math.log10(p.tvl_usd)),
        members.map((p) => Math.log10(p.mcap_usd!)),
      );
      // Shrink the category's own line toward the global line, weight n/(n+8).
      const w = members.length / (members.length + 8);
      categoryFits.set(key, {
        n: members.length,
        a: w * own.a + (1 - w) * global.a,
        b: w * own.b + (1 - w) * global.b,
        r2: own.r2,
        weight: w,
      });
    }
  }
  return {
    peers: peers.length,
    a: global.a,
    b: global.b,
    r2: global.r2,
    globalMultiple,
    peerMedianLogTvl,
    categoryMultiples,
    categoryFits,
    categoryPeerStats,
  };
}

/** Categories the watchlist hygiene keeps off the board. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A name ending in a version marker reads as a pool of another protocol. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Whole words that mark a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Names that begin with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** The watchlist rule's hygiene, applied to below-floor candidates. */
function passesHygiene(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** Confidence tier label for a 0..1 confidence score. */
function confidenceTier(confidence: number): 'High' | 'Medium' | 'Low' {
  if (confidence >= 0.55) return 'High';
  if (confidence >= 0.38) return 'Medium';
  return 'Low';
}

/** Score one pre-token protocol under the fitted model. */
function score(p: Protocol, snapshot: Snapshot, fit: Fit, watchlist: boolean): Scored {
  const key = p.category ?? '';
  const logTvl = Math.log10(Math.max(1, p.tvl_usd));
  const sizeLog = fit.a + fit.b * logTvl;
  const cat = fit.categoryMultiples.get(key);
  const categoryMultiple = cat === undefined ? fit.globalMultiple : cat.multiple;
  const catLog = logTvl + Math.log10(categoryMultiple);
  const catFit = fit.categoryFits.get(key);
  const curveLog = catFit === undefined ? null : catFit.a + catFit.b * logTvl;
  // Blend in log space: 50/50 size curve and category multiple, or 40/30/30 when the
  // category earned its own shrunk log-log fit.
  const weights = curveLog === null ? { size: 0.5, multiple: 0.5, curve: 0 } : { size: 0.4, multiple: 0.3, curve: 0.3 };
  const baseLog = weights.size * sizeLog + weights.multiple * catLog + (curveLog === null ? 0 : weights.curve * curveLog);
  const momentumFactor = p.change_7d === null ? 1 : 1 + 0.01 * clamp(p.change_7d, -25, 25);
  const days = ageInDays(snapshot.as_of, p.listed_at);
  const ageYears = days === null ? null : days / 365.25;
  let ageFactor = 1;
  if (ageYears !== null) ageFactor = ageYears < 0.25 ? 0.9 : 1 + 0.06 * Math.min(ageYears, 4);
  const implied = Math.max(1, Math.round(10 ** baseLog * momentumFactor * ageFactor));
  // Confidence: how much evidence backs this row's estimate. Peer support counts the
  // category's tokenised peers; fit quality is the R2 of the curve that priced the row
  // (the category fit when there is one, else the global fit); distance measures how far
  // the row's TVL sits from its category peers' median TVL, in log10 space.
  const stats = fit.categoryPeerStats.get(key);
  const peerScore = stats === undefined ? 0.1 : clamp(stats.n / 12, 0.15, 1);
  const fitScore = clamp(catFit === undefined ? fit.r2 : catFit.r2, 0, 1);
  const anchor = stats === undefined ? fit.peerMedianLogTvl : stats.medianLogTvl;
  const distanceScore = clamp(1 - Math.abs(logTvl - anchor) / 1.5, 0, 1);
  const confidence = roundTo(0.4 * peerScore + 0.35 * fitScore + 0.25 * distanceScore, 3);
  const breakdown: ModelBreakdown = {
    size_curve_usd: Math.round(10 ** sizeLog),
    category_multiple: roundTo(categoryMultiple, 6),
    category_multiple_usd: Math.round(10 ** catLog),
    category_curve_usd: curveLog === null ? null : Math.round(10 ** curveLog),
    category_fit_peers: catFit === undefined ? 0 : catFit.n,
    category_fit_r2: catFit === undefined ? null : roundTo(catFit.r2, 4),
    weights,
    base_value_usd: Math.round(10 ** baseLog),
    momentum_factor: roundTo(momentumFactor, 4),
    age_factor: roundTo(ageFactor, 4),
    confidence,
    confidence_tier: confidenceTier(confidence),
  };
  return {
    p,
    watchlist,
    implied,
    low: Math.max(1, Math.round(implied * 10 ** -0.45)),
    high: Math.round(implied * 10 ** 0.45),
    sizeCurveValue: Math.round(10 ** sizeLog),
    categoryMultiple,
    momentumFactor,
    ageFactor,
    ageYears,
    breakdown,
  };
}

/** Build the ranked board and the dashboard's data from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const fit = fitPeers(snapshot);
  const bySlugMap = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlistSet = new Set(snapshot.watchlist);
  const chosen: Scored[] = [];
  for (const slug of snapshot.watchlist) {
    const p = bySlugMap.get(slug);
    if (p !== undefined) chosen.push(score(p, snapshot, fit, true));
  }
  const belowFloor = snapshot.protocols
    .filter((p) => !watchlistSet.has(p.slug) && p.gecko_id === null && p.symbol === null && p.tvl_usd < snapshot.floor_usd && passesHygiene(p))
    .sort((x, y) => y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));
  for (const p of belowFloor.slice(0, Math.max(0, 200 - chosen.length))) {
    chosen.push(score(p, snapshot, fit, false));
  }
  chosen.sort((x, y) => y.implied - x.implied || y.p.tvl_usd - x.p.tvl_usd || (x.p.slug < y.p.slug ? -1 : x.p.slug > y.p.slug ? 1 : 0));
  let previous = Number.POSITIVE_INFINITY;
  for (const row of chosen) {
    row.implied = Math.min(row.implied, previous);
    row.low = Math.max(1, Math.round(row.implied * 10 ** -0.45));
    row.high = Math.round(row.implied * 10 ** 0.45);
    previous = row.implied;
  }
  const board: BoardRow[] = chosen.map((row, i) => ({
    rank: i + 1,
    slug: row.p.slug,
    name: row.p.name,
    category: row.p.category,
    chains: row.p.chains,
    tvl_usd: row.p.tvl_usd,
    change_7d: row.p.change_7d,
    listed_at: row.p.listed_at,
    implied_value_usd: row.implied,
    model_breakdown: row.breakdown,
    farm_steps: farmSteps(row),
  }));
  const rows: RadarRow[] = chosen.map((row, i) => ({
    rank: i + 1,
    slug: row.p.slug,
    name: row.p.name,
    category: row.p.category,
    chains: row.p.chains,
    tvl: row.p.tvl_usd,
    change7d: row.p.change_7d,
    listedAt: row.p.listed_at,
    ageYears: row.ageYears === null ? null : roundTo(row.ageYears, 2),
    watchlist: row.watchlist,
    implied: row.implied,
    low: row.low,
    high: row.high,
    multiple: roundTo(row.implied / row.p.tvl_usd, 4),
    momentumFactor: roundTo(row.momentumFactor, 4),
    ageFactor: roundTo(row.ageFactor, 4),
    categoryMultiple: roundTo(row.categoryMultiple, 6),
    sizeCurveValue: row.sizeCurveValue,
    breakdown: row.breakdown,
    farmSteps: board[i]!.farm_steps,
    farmSummary: farmSummary(row),
  }));
  const categoryMultiples = [...fit.categoryMultiples.entries()]
    .map(([key, v]) => ({ category: key === '' ? null : key, peers: v.n, multiple: roundTo(v.multiple, 6) }))
    .sort((x, y) => (x.category ?? '') < (y.category ?? '') ? -1 : (x.category ?? '') > (y.category ?? '') ? 1 : 0);
  const radar: Radar = {
    asOf: snapshot.as_of,
    stats: {
      protocolsScanned: snapshot.protocols.length,
      watchlistCount: snapshot.watchlist.length,
      rows: board.length,
      peerCount: fit.peers,
      fit: { a: roundTo(fit.a, 6), b: roundTo(fit.b, 6), r2: roundTo(fit.r2, 6) },
      globalMultiple: roundTo(fit.globalMultiple, 6),
      categoryFitCount: fit.categoryFits.size,
    },
    categoryMultiples,
    rows,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- farm plans
// Protocol-specific plan generator: every plan is built from the protocol's own snapshot
// record — its full chain list ordered by gas cost, its category's product mechanics, its
// TVL tier (working capital, duration) and its 7-day TVL move (a risk input). Steps carry
// concrete actions, per-step times and dollar costs; the summary carries the itemised cost
// table, the weekly upkeep load, the horizon in weeks and the risk notes.

/** Per-transaction gas ranges by chain, in dollars, as [low, high, mid]. */
const CHAIN_GAS: Record<string, [number, number, number]> = {
  Solana: [0.05, 1, 0.3],
  Base: [0.05, 1, 0.3],
  Arbitrum: [0.05, 1, 0.3],
  Optimism: [0.05, 1, 0.3],
  Monad: [0.05, 1, 0.3],
  'BNB Chain': [0.05, 1, 0.3],
  Ethereum: [5, 25, 15],
};
const GAS_DEFAULT: [number, number, number] = [1, 5, 3];

/** The protocol's cheapest chain by gas tier, and that tier. */
function cheapestChain(p: Protocol): { chain: string; gas: [number, number, number] } {
  let best: { chain: string; gas: [number, number, number] } | null = null;
  for (const chain of p.chains) {
    const gas = CHAIN_GAS[chain] ?? GAS_DEFAULT;
    if (best === null || gas[2] < best.gas[2]) best = { chain, gas };
  }
  return best ?? { chain: 'its main chain', gas: GAS_DEFAULT };
}

/** Minimum working capital for a farm position, from the protocol's TVL tier. */
function capitalFor(tvl: number): number {
  if (tvl >= 200_000_000) return 5000;
  if (tvl >= 50_000_000) return 1000;
  return 250;
}

/** Format a whole-dollar figure with thousands separators. */
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** The figures one row's plan is built from, shared by the steps and the summary. */
interface PlanFigures {
  /** Cheapest chain by gas tier: where the position is opened. */
  chain: string;
  gasText: string;
  gasMid: number;
  /** The protocol's other chains, cheapest first: where a second presence is built. */
  otherChains: { chain: string; gas: [number, number, number] }[];
  capital: number;
  /** Plan duration in weeks. */
  weeks: number;
  /** Minutes of upkeep work per week. */
  weeklyMinutes: number;
  /** Itemised costs behind the total, in display order. */
  costs: { label: string; usd: number }[];
  totalCost: number;
  /** Risk notes for this protocol. */
  risks: string[];
}

/** Plan duration from the protocol's size and category: deep books and RWA run longer. */
function planWeeks(p: Protocol): number {
  let weeks = 6;
  if (p.tvl_usd >= 200_000_000) weeks = 8;
  else if (p.tvl_usd < 5_000_000) weeks = 4;
  if (p.category === 'RWA') weeks = Math.max(weeks, 8);
  return weeks;
}

/** Weekly upkeep minutes: more chains and health-sensitive categories need more watching. */
function planWeeklyMinutes(p: Protocol): number {
  let minutes = 10;
  if (p.chains.length >= 3) minutes += 5;
  if (p.category === 'CDP' || p.category === 'Lending' || p.category === 'Basis Trading') minutes += 5;
  return Math.min(minutes, 20);
}

/** Category risk notes: the failure modes of each product mechanic. */
const CATEGORY_RISKS: Record<string, string> = {
  Lending: 'Liquidation risk: if collateral falls or borrow rates spike, the position can be liquidated; keep the health factor comfortably above 1.5.',
  Dexs: 'Impermanent loss: if the farmed pair diverges in price, the LP position can end worth less than simply holding both assets.',
  Yield: 'Strategy risk: the vault yield comes from underlying strategies that can underperform or be exploited; the headline APY is not guaranteed.',
  RWA: 'Access and settlement risk: tokenized real-world assets can require KYC, carry transfer restrictions and settle slowly; redemption is not always instant.',
  'Risk Curators': 'Curator risk: returns depend on the curator\u2019s risk calls; a bad allocation inside a curated vault hits every depositor in it.',
  'Onchain Capital Allocator': 'Opacity risk: allocator strategies rebalance on their own schedule, so the wallet\u2019s exact exposure at any moment is only partly visible.',
  'Basis Trading': 'Funding risk: if funding rates flip sign for a sustained stretch, the basis position pays instead of earns and returns compress fast.',
  CDP: 'Liquidation risk: if collateral falls toward the mint ratio, the position can be liquidated at a penalty; keep the ratio well above the minimum.',
  Restaking: 'Slashing and lockup risk: restaked assets can be slashed for operator faults and withdrawals can queue for weeks.',
};

/** Risk notes for one protocol: its category's failure mode plus what its own figures say. */
function planRisks(p: Protocol, row: Scored): string[] {
  const risks: string[] = [
    'No token is guaranteed: the protocol may never launch one, or may launch with no allocation for early users; the working capital stays at smart-contract risk the whole time.',
  ];
  const catRisk = p.category !== null ? CATEGORY_RISKS[p.category] : undefined;
  if (catRisk !== undefined) risks.push(catRisk);
  if (p.change_7d !== null && p.change_7d <= -10) {
    risks.push(`Momentum risk: TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in the snapshot's last 7 days; size in only after the trend stabilises.`);
  }
  if (row.ageYears !== null && row.ageYears < 0.25) {
    risks.push('Young protocol: it has been tracked for under three months, so there is little operating history behind the numbers.');
  }
  if (p.chains.length <= 1) {
    risks.push('Single-chain concentration: the whole position depends on one chain\u2019s uptime, bridges and gas market.');
  }
  return risks;
}

/** Derive a row's plan figures: chains by gas cost, capital tier, duration and the cost table. */
function planFigures(row: Scored): PlanFigures {
  const p = row.p;
  const { chain, gas } = cheapestChain(p);
  const seen = new Set<string>([chain]);
  const otherChains: { chain: string; gas: [number, number, number] }[] = [];
  for (const c of p.chains) {
    if (seen.has(c)) continue;
    seen.add(c);
    otherChains.push({ chain: c, gas: CHAIN_GAS[c] ?? GAS_DEFAULT });
  }
  otherChains.sort((x, y) => x.gas[2] - y.gas[2] || (x.chain < y.chain ? -1 : 1));
  const capital = capitalFor(p.tvl_usd);
  const weeks = planWeeks(p);
  const weeklyMinutes = planWeeklyMinutes(p);
  // 4 setup transactions on the primary chain, 2 upkeep transactions a week for the whole
  // horizon, one bridged round trip if a second chain is used, plus flat wallet/fees buffer.
  const setupGas = Math.round(4 * gas[2]);
  const upkeepGas = Math.round(2 * gas[2] * weeks);
  const second = otherChains[0];
  const bridgeCost = second === undefined ? 0 : Math.round(2 * second.gas[2] + 4);
  const costs: { label: string; usd: number }[] = [
    { label: `Setup gas on ${chain} (4 transactions)`, usd: setupGas },
    { label: `Upkeep gas on ${chain} (2 transactions x ${weeks} weeks)`, usd: upkeepGas },
  ];
  if (second !== undefined) costs.push({ label: `Second-chain presence on ${second.chain} (bridge + gas)`, usd: bridgeCost });
  costs.push({ label: 'Wallet, approvals and miscellaneous fees', usd: 10 });
  const totalCost = costs.reduce((s, c) => s + c.usd, 0);
  return {
    chain,
    gasText: `$${gas[0]}-$${gas[1]}`,
    gasMid: gas[2],
    otherChains,
    capital,
    weeks,
    weeklyMinutes,
    costs,
    totalCost,
    risks: planRisks(p, row),
  };
}

/** The category action library: the core move and the diversifying second move, per category. */
const CATEGORY_ACTIONS: Record<string, { core: (f: PlanFigures, name: string) => string; second: (f: PlanFigures, name: string) => string }> = {
  Lending: {
    core: (f, name) => `Supply at least ${usd(f.capital)} of USDC or ETH as collateral in ${name} on ${f.chain} and, if the market allows, draw a small borrow against it and repay it a week later, so the wallet shows both sides of the lending book. Gas runs about ${f.gasText}; the supply takes about 15 minutes.`,
    second: (f, name) => `Add a second supply position in ${name} in a different asset than the first, about a quarter of its size, so the wallet is not a one-market user. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  Dexs: {
    core: (f, name) => `Swap at least ${usd(f.capital)} through ${name}'s main pool on ${f.chain}, then add the proceeds as liquidity to that pool and keep the LP position open. Two transactions at about ${f.gasText} of gas each; the whole opening takes about 20 minutes.`,
    second: (f, name) => `Trade a second pair on ${name} a few days later, about a quarter of the first swap's size, so the wallet shows repeat trading rather than a single touch. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  Yield: {
    core: (f, name) => `Deposit at least ${usd(f.capital)} into ${name}'s main vault on ${f.chain} and hold the vault shares in the same wallet; do not loop or leverage the position. One deposit at about ${f.gasText} of gas, done in about 10 minutes.`,
    second: (f, name) => `Open a second, smaller deposit in another of ${name}'s vaults, about a quarter of the first, to diversify across its strategies. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  RWA: {
    core: (f, name) => `Complete ${name}'s onboarding on ${f.chain} first, including KYC if the asset requires it (about 30 minutes), then buy at least ${usd(f.capital)} of its tokenized asset and hold it in the same wallet. Onboarding is usually free; the purchase costs about ${f.gasText} of gas.`,
    second: (f, name) => `Add a second, smaller holding in a different ${name} asset, about a quarter of the first purchase, once the first has settled. Budget about ${f.gasText} of gas and 10 minutes, plus any repeat checks onboarding asks for.`,
  },
  'Risk Curators': {
    core: (f, name) => `Deposit at least ${usd(f.capital)} into a vault curated through ${name} on ${f.chain}, choosing the vault whose underlying market you understand best, and hold the shares. One deposit at about ${f.gasText} of gas, done in about 10 minutes.`,
    second: (f, name) => `Split a second deposit, about a quarter of the first, into a different ${name}-curated vault so the wallet is exposed to more than one curator's book. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Onchain Capital Allocator': {
    core: (f, name) => `Deposit at least ${usd(f.capital)} into ${name}'s allocator vault on ${f.chain} and leave the allocation untouched for the first two weeks, so the wallet reads as patient capital. One deposit at about ${f.gasText} of gas, done in about 10 minutes.`,
    second: (f, name) => `Top up the ${name} position by about a quarter after the first rebalance you observe, rather than on day one, so the wallet's timing follows the allocator's own rhythm. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Basis Trading': {
    core: (f, name) => `Fund ${name}'s basis vault on ${f.chain} with at least ${usd(f.capital)} of USDC and hold the position through at least one full funding cycle. One deposit at about ${f.gasText} of gas, done in about 10 minutes.`,
    second: (f, name) => `Add a second tranche, about a quarter of the first, after the first funding cycle settles, so the wallet shows it stayed for the yield rather than the snapshot. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  CDP: {
    core: (f, name) => `Open a collateralised position in ${name} on ${f.chain}: deposit at least ${usd(f.capital)} of collateral, mint a conservative amount of its stablecoin against it (keep the collateral ratio above 200%), and hold both. Two transactions at about ${f.gasText} of gas each, about 20 minutes in all.`,
    second: (f, name) => `Use a small part of the minted stablecoin inside ${name}'s own ecosystem, for example its stability pool, so the wallet shows the full mint-and-use loop. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  Restaking: {
    core: (f, name) => `Restake at least ${usd(f.capital)} worth of ETH or an ETH liquid staking token through ${name} on ${f.chain} and hold the restaked position; do not withdraw inside the first month. One deposit at about ${f.gasText} of gas, done in about 15 minutes.`,
    second: (f, name) => `Delegate or allocate a second, smaller restake, about a quarter of the first, to a different operator or strategy in ${name} if it offers one. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
};

/** The fallback pair for categories without their own entry in the library. */
const GENERIC_ACTIONS = {
  core: (f: PlanFigures, name: string) => `Deposit at least ${usd(f.capital)} into ${name} on ${f.chain} and use its core product the way a real user would, keeping the position open rather than touching it once. One or two transactions at about ${f.gasText} of gas each, about 15 minutes in all.`,
  second: (f: PlanFigures, name: string) => `Repeat ${name}'s core action a few days later at about a quarter of the first position's size, so the wallet shows genuine repeated use. Budget about ${f.gasText} of gas and 10 minutes.`,
};

/** What the weekly upkeep visit watches, per category. */
const UPKEEP_FOCUS: Record<string, string> = {
  Lending: 'check the health factor and top up collateral if it drifts toward 1.5',
  Dexs: 'check the LP range and pool share, and rebalance if the price has moved out of the farmed band',
  Yield: 'check the vault share price and the strategy allocation for changes',
  RWA: 'check settlement status of any pending purchase or redemption and the asset\u2019s reporting',
  'Risk Curators': 'check the curated vault\u2019s underlying markets for new risk flags',
  'Onchain Capital Allocator': 'note any rebalance the allocator ran and how the allocation changed',
  'Basis Trading': 'check the funding rate sign and the vault\u2019s margin headroom',
  CDP: 'check the collateral ratio and top up if it drifts toward 200%',
  Restaking: 'check operator status and any slashing or withdrawal-queue news',
};

/** Six concrete steps for one row: setup, core action, second presence, upkeep, watch, exit. */
function farmSteps(row: Scored): string[] {
  const p = row.p;
  const f = planFigures(row);
  const actions = (p.category !== null ? CATEGORY_ACTIONS[p.category] : undefined) ?? GENERIC_ACTIONS;
  const second = f.otherChains[0];
  const chainList = p.chains.length > 1
    ? ` It also operates on ${p.chains.filter((c) => c !== f.chain).slice(0, 3).join(', ')}, which the plan uses for a second presence in step 3.`
    : '';
  const secondStep = second === undefined
    ? actions.second(f, p.name)
    : `${actions.second(f, p.name)} Do it on ${second.chain}, ${p.name}'s next-cheapest chain, instead of repeating it on ${f.chain}: bridge a small amount over first (about $${(2 * second.gas[2] + 4).toFixed(0)} all-in), so the wallet is a genuine user on two of its chains.`;
  const focus = (p.category !== null ? UPKEEP_FOCUS[p.category] : undefined) ?? 'check balances and rebalance or top up if the position drifts by more than a fifth';
  const move = p.change_7d === null
    ? 'Its 7-day TVL change is not recorded in the snapshot, so judge momentum from the announcements feed instead.'
    : `In the snapshot its TVL moved ${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}% over 7 days; recheck that trend before adding size.`;
  return [
    `Set up a dedicated wallet for ${p.name} and fund it on ${f.chain}, its cheapest chain: gas there runs about ${f.gasText} per transaction, so keep a small buffer of the chain's gas token plus ${usd(f.capital)} of working capital ready.${chainList} Setup takes about 20 minutes.`,
    actions.core(f, p.name),
    secondStep,
    `Maintain the ${p.name} position weekly for the full ${f.weeks}-week plan: one visit a week of about ${f.weeklyMinutes} minutes to ${focus}, and log every visit with its date and transaction hashes. Upkeep gas runs about ${f.gasText} per visit on ${f.chain}.`,
    `Watch ${p.name} for the remaining weeks: follow its official announcements and re-check it on this radar weekly. ${move} Keep the dated transaction log current; it is the evidence of genuine early use if a snapshot or claim is ever announced.`,
    `Close out ready: over the ${f.weeks}-week horizon the plan costs about ${usd(f.totalCost)} in gas and fees (setup ${usd(f.costs[0]!.usd)}, upkeep ${usd(f.costs[1]!.usd)}), on top of the ${usd(f.capital)} of working capital that stays in the position. Main risk — ${(f.risks[1] ?? f.risks[0]!).replace(/\.$/, '')}. Be ready to claim and stake any token it issues, and unwind in an orderly way if it announces there will be none.`,
  ];
}

/** The summary figures the detail view shows beside the plan. */
function farmSummary(row: Scored): FarmSummary {
  const f = planFigures(row);
  return {
    total_cost_usd: f.totalCost,
    setup_time: 'about 35 minutes',
    weekly_upkeep: `about ${f.weeklyMinutes} minutes and ~$${(2 * f.gasMid).toFixed(2)} of gas`,
    horizon: `${f.weeks} weeks`,
    weeks: f.weeks,
    weekly_minutes: f.weeklyMinutes,
    costs: f.costs,
    risks: f.risks,
  };
}

// ---------------------------------------------------------------- the gate

/** The first reason the gate would refuse this board, or null when the board is clean. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!known.has(row.slug)) return `row ${row.rank} names ${row.slug}, which the snapshot does not list`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  const ranks = [...board].sort((x, y) => x.rank - y.rank);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i]!.rank !== i + 1) return `ranks are not exactly 1..${ranks.length}`;
    if (!Number.isInteger(ranks[i]!.implied_value_usd) || ranks[i]!.implied_value_usd <= 0) return `row ${ranks[i]!.slug} has a bad implied value`;
    if (i > 0 && ranks[i]!.implied_value_usd > ranks[i - 1]!.implied_value_usd) return `implied value rises at rank ${i + 1}`;
    const steps = ranks[i]!.farm_steps;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) return `row ${ranks[i]!.slug} has ${Array.isArray(steps) ? steps.length : 0} farm steps`;
    for (const step of steps) {
      const len = typeof step === 'string' ? step.trim().length : 0;
      if (len < 20 || len > 600) return `row ${ranks[i]!.slug} has a farm step of ${len} characters`;
    }
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'every row carries the same implied value';
  return null;
}

/** The dashboard's data file: one assignment, fixed key order, no wall-clock anywhere. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
