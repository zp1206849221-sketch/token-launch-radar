// lib/model.ts — the token launch radar's model, written for this entry.
//
// One sealed DefiLlama snapshot in, one ranked board out. The board covers the snapshot's whole
// watchlist (pre-token protocols at or above the $50M TVL floor); above the floor it also
// admits, one by one, the pre-token protocols the watchlist left out that a documented
// blind-spot review (below) finds are not products of a token that already trades; and it
// fills the rest of its 200 rows with pre-token protocols below the floor that pass the
// same hygiene the watchlist rule uses, so the radar also surfaces early protocols before
// they reach the floor. On this snapshot those sets hold 40, 15 and 138 protocols: 193 rows.
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
// Every row also carries a confidence score built from the category's peer support, the
// fit quality of the curve that priced it, and whether its size sits inside the range
// that curve was fitted on. Every figure the dashboard shows is recomputed from the
// snapshot by this file.

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
  /** 5th and 95th percentiles of log10 TVL over all tokenised peers: the range the
   * global model was fitted on, the confidence support range for thin categories. */
  peerP05LogTvl: number;
  peerP95LogTvl: number;
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

/** The q-quantile of a non-empty list of numbers, linearly interpolated. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
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
  const peerLogTvls = peers.map((p) => Math.log10(p.tvl_usd));
  const peerMedianLogTvl = median(peerLogTvls);
  const peerP05LogTvl = quantile(peerLogTvls, 0.05);
  const peerP95LogTvl = quantile(peerLogTvls, 0.95);
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
    peerP05LogTvl,
    peerP95LogTvl,
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

/**
 * The blind-spot review: every protocol at or above the floor that records no token and
 * passes the field hygiene above, yet is not on the watchlist. The watchlist rule kept
 * these off for one reason the snapshot cannot show — DefiLlama's parentProtocol record,
 * which is not one of the snapshot's ten fields — so each one was adjudicated by hand
 * from the fields the snapshot does carry (name, category, chains, and what sibling
 * records of the same brand show). The rule the review applies: a candidate stays off
 * the board only when the snapshot itself shows it is a token that already trades in
 * another form — the record is a minted token product, a wrapper of a trading token, a
 * bridge product of a token issuer, or a product line of a brand whose token the
 * snapshot records on a sibling record. Everything else is a pre-token protocol the
 * list simply left out, and the rules call the watchlist a floor, never a ceiling.
 * The verdicts and their reasons stay in the code so the call for each name is auditable.
 */
export const BLIND_SPOT_REVIEW: { slug: string; verdict: 'include' | 'exclude'; reason: string }[] = [
  { slug: 'sentora-curator', verdict: 'include', reason: 'No other record carries the Sentora brand and nothing in the snapshot ties it to a tokenised parent; a curator platform in its own right.' },
  { slug: 'polymarket-international', verdict: 'include', reason: 'The brand\u2019s only record in the snapshot and no Polymarket record carries a token; a prediction market is a protocol in its own right, not a wrapped or staked form of one.' },
  { slug: 'cian-yield-layer', verdict: 'include', reason: 'The only CIAN record; the brand records no token anywhere in the snapshot and the protocol is a standalone aggregator.' },
  { slug: 'defi-saver-asset-management', verdict: 'include', reason: 'DeFi Saver\u2019s only record and the brand records no token; an automation layer over CDP positions, not a wrapped or staked product of a tokenised protocol.' },
  { slug: 'mellow-core', verdict: 'include', reason: 'Mellow\u2019s other record (mellow-restaking) records no token either; Core is the brand\u2019s main vault system, not a product of a tokenised parent.' },
  { slug: 'bitfi-basis', verdict: 'include', reason: 'BitFi\u2019s only record; basis trading is the protocol\u2019s own product and the brand records no token.' },
  { slug: 'figure-markets-prime', verdict: 'include', reason: 'Figure Markets records no token in the snapshot; Prime is its lending market, not a wrapped or staked product.' },
  { slug: 'figure-markets-exchange', verdict: 'include', reason: 'Figure Markets records no token in the snapshot; the exchange is a spot venue in its own right, not a wrapped or staked product.' },
  { slug: 'extended-perps', verdict: 'include', reason: 'A standalone perpetuals venue; the brand\u2019s only record and it records no token.' },
  { slug: 'stellar-defi-hub', verdict: 'include', reason: 'A standalone hub on Stellar; the brand\u2019s only record and it records no token.' },
  { slug: 'loopscale-lending', verdict: 'include', reason: 'A standalone lending protocol; the brand\u2019s only record and it records no token.' },
  { slug: 'ipor-fusion', verdict: 'include', reason: 'No record in the snapshot carries an IPOR token (symbol and gecko_id checked across all 758 protocols); Fusion is the brand\u2019s allocator and records no token itself.' },
  { slug: 'arcus-perps', verdict: 'include', reason: 'A standalone perpetuals venue; the brand\u2019s only record and it records no token.' },
  { slug: 'azverse-perps', verdict: 'include', reason: 'A standalone perpetuals venue; the brand\u2019s only record and it records no token.' },
  { slug: 'nado-spot', verdict: 'include', reason: 'Nado\u2019s only record; the brand records no token and the spot book is the exchange itself, not a wrapped or staked form.' },
  { slug: 'theo-network-thusd', verdict: 'exclude', reason: 'The record is itself a minted token product: its name is the token (thUSD, a tokenised dollar; its sibling thBill follows the same pattern). No launch is pending for a token that is the product.' },
  { slug: 'avant-avusd', verdict: 'exclude', reason: 'The record is itself the minted avUSD stablecoin (its sibling avETH follows the same pattern): the token is the product, not a launch still to come.' },
  { slug: 'usdcx', verdict: 'exclude', reason: 'Its category is Stablecoin Wrapper: a wrapped form of USDC, a token that already trades.' },
  { slug: 'solv-strategies', verdict: 'exclude', reason: 'Sibling records of the same brand (SolvBTC, Solv Basis Trading, Solv RWA) carry the SOLV symbol in the snapshot: the parent brand\u2019s token already trades and Strategies is its product line.' },
  { slug: 'circle-gateway', verdict: 'exclude', reason: 'A Cross Chain Bridge product of Circle, the USDC issuer: transfer plumbing for a token that already trades, in the bridge family the hygiene treats as bridged products, not an independent pre-token protocol.' },
];

/** Confidence tier label for a 0..1 confidence score, recalibrated with the v3 formula:
 * High marks rows with strong local evidence, Low the rows resting on the global model
 * alone. */
function confidenceTier(confidence: number): 'High' | 'Medium' | 'Low' {
  if (confidence >= 0.58) return 'High';
  if (confidence >= 0.47) return 'Medium';
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
  // Confidence: how much evidence backs this row's estimate, recalibrated in v3 so the
  // score measures support rather than size. Peer support counts the category's
  // tokenised peers on a log scale, with a small constant credit for the global evidence
  // the shrinkage lends every category, so a one-peer category is thin but not
  // evidenceless. Fit quality is the R2 of the curve that priced the row (the category
  // fit when there is one, else the global fit). The distance term asks whether the
  // row's size sits inside the range the pricing model was fitted on: for categories
  // with at least 8 tokenised peers that is the distance from the category's own median
  // log TVL; for thinner categories the pricing itself falls back on the global model,
  // so the support range is the global peers' [p05, p95] log-TVL range, widened by half
  // a log. The v2 calibration anchored distance on the category median even for a
  // one-peer category, which made the board's largest protocols — by construction its
  // top ranks — carry the lowest confidence on the board.
  const stats = fit.categoryPeerStats.get(key);
  const peerCount = stats === undefined ? 0 : stats.n;
  const peerScore = clamp(Math.log(1 + peerCount + 2) / Math.log(27), 0.1, 1);
  const fitScore = clamp(catFit === undefined ? fit.r2 : catFit.r2, 0, 1);
  let distanceScore: number;
  if (stats !== undefined && stats.n >= 8) {
    distanceScore = clamp(1 - Math.abs(logTvl - stats.medianLogTvl) / 2, 0, 1);
  } else {
    const lo = fit.peerP05LogTvl - 0.5;
    const hi = fit.peerP95LogTvl + 0.5;
    const excess = logTvl < lo ? lo - logTvl : logTvl > hi ? logTvl - hi : 0;
    distanceScore = clamp(1 - excess / 0.75, 0, 1);
  }
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
  // Above-floor protocols the watchlist left out, admitted one by one by the blind-spot
  // review above: each is re-checked against the snapshot here (it must record no token
  // and sit at or above the floor) before it is scored like any other candidate.
  for (const entry of BLIND_SPOT_REVIEW) {
    if (entry.verdict !== 'include') continue;
    const p = bySlugMap.get(entry.slug);
    if (p === undefined || watchlistSet.has(p.slug)) continue;
    if (p.gecko_id !== null || p.symbol !== null || p.tvl_usd < snapshot.floor_usd) continue;
    chosen.push(score(p, snapshot, fit, false));
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
  Derivatives:
    'Leverage risk: a perpetual position can be liquidated if the mark price moves against it and margin runs thin, and funding payments can turn a quiet position into a slow bleed.',
  'Yield Aggregator':
    'Routing risk: an aggregator moves deposits between underlying strategies, so the wallet inherits the risk of venues it never chose directly; a failed underlying strategy hits every vault routed into it.',
  'Prediction Market':
    'Resolution risk: prediction shares settle on an outcome call that can be disputed or delayed, and a losing market pays out nothing at all.',
  'Leveraged Farming':
    'Leverage risk: the borrowed leg means a sharp move in the farmed pair can liquidate the whole position, equity included; the headline APY assumes the borrow stays cheap.',
  'CDP Manager':
    'Automation risk: a manager acts on the position without asking first; a mis-set trigger can sell collateral at the worst moment, and the underlying vault can still be liquidated if the ratio falls faster than the automation reacts.',
  'OTC Marketplace':
    'Counterparty risk: an OTC trade settles against another party, not a pool; until the escrow releases, the funds depend on the counterparty and the marketplace\u2019s process.',
  Insurance:
    'Cover risk: an insurance position pays only if the claim is accepted under its wording; discretionary cover can be declined, and the premium is spent either way.',
  'Uncollateralized Lending':
    'Credit risk: uncollateralised loans can simply not be repaid; there is no collateral to liquidate, so a default is a direct loss to the pool\u2019s lenders.',
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
    second: (f, name) => `Add a second tranche to ${name}, about a quarter of the first, after the first funding cycle settles, so the wallet shows it stayed for the yield rather than the snapshot. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  CDP: {
    core: (f, name) => `Open a collateralised position in ${name} on ${f.chain}: deposit at least ${usd(f.capital)} of collateral, mint a conservative amount of its stablecoin against it (keep the collateral ratio above 200%), and hold both. Two transactions at about ${f.gasText} of gas each, about 20 minutes in all.`,
    second: (f, name) => `Use a small part of the minted stablecoin inside ${name}'s own ecosystem, for example its stability pool, so the wallet shows the full mint-and-use loop. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  Restaking: {
    core: (f, name) => `Restake at least ${usd(f.capital)} worth of ETH or an ETH liquid staking token through ${name} on ${f.chain} and hold the restaked position; do not withdraw inside the first month. One deposit at about ${f.gasText} of gas, done in about 15 minutes.`,
    second: (f, name) => `Delegate or allocate a second, smaller restake, about a quarter of the first, to a different operator or strategy in ${name} if it offers one. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  Derivatives: {
    core: (f, name) => `Open a small perpetual position in ${name} on ${f.chain}: post at least ${usd(f.capital)} of margin, take a modest long or short at low leverage (2x or less) and close it after a few days, so the wallet shows real trading rather than a single deposit. Opening and closing cost about ${f.gasText} of gas each; the opening takes about 20 minutes.`,
    second: (f, name) => `Trade a second contract on ${name} a few days later at about a quarter of the first position's margin, ideally on the other side of the book, so the wallet reads as an active trader rather than a one-off visitor. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Yield Aggregator': {
    core: (f, name) => `Deposit at least ${usd(f.capital)} into ${name}'s main aggregation vault on ${f.chain} and hold the shares; before depositing, note from its own dashboard which underlying strategies the vault routes into. One deposit at about ${f.gasText} of gas, done in about 10 minutes.`,
    second: (f, name) => `Open a second deposit in a different ${name} vault, about a quarter of the first, whose underlying strategies differ from the first vault's, so the wallet is not exposed to a single route. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  Chain: {
    core: (f, name) => `Become a genuine user of ${name}: bridge at least ${usd(f.capital)} onto the chain and use its native applications — a swap, a lending market, a name service if it has one — from the same wallet over several days. Bridge and transaction costs run about ${f.gasText} each; the first session takes about 20 minutes.`,
    second: (f, name) => `Return to ${name} a week later and repeat one of the same actions at about a quarter of the size, so the wallet shows continuing activity on the chain rather than a single bridge-in. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Staking Pool': {
    core: (f, name) => `Stake at least ${usd(f.capital)} with ${name} on ${f.chain} through its pool and hold the staking receipt in the same wallet; note the pool's commission and unbonding period before staking. One transaction at about ${f.gasText} of gas, done in about 10 minutes.`,
    second: (f, name) => `Add a second, smaller stake with ${name}, about a quarter of the first, after the first rewards cycle lands, so the wallet's staking history spans more than one epoch. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Liquidity Manager': {
    core: (f, name) => `Deposit at least ${usd(f.capital)} into a managed liquidity position in ${name} on ${f.chain}, choosing the pair you understand best, and leave the manager's range settings at their defaults for the first cycle. One deposit at about ${f.gasText} of gas, done in about 15 minutes.`,
    second: (f, name) => `Open a second managed position with ${name} in a different pair, about a quarter of the first, so the wallet is not riding on a single pool's volume. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Prediction Market': {
    core: (f, name) => `Trade on ${name} on ${f.chain}: buy at least ${usd(f.capital)} of shares across two or three markets you can actually follow, and hold at least one position to resolution. Each trade costs about ${f.gasText} of gas; the first session takes about 20 minutes.`,
    second: (f, name) => `Take the other side of one of your earlier ${name} markets, or a position in a different category of market, at about a quarter of the size, so the wallet shows judgement rather than a single bet. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  CeDeFi: {
    core: (f, name) => `Deposit at least ${usd(f.capital)} into ${name}'s main earn product on ${f.chain} and hold it for the full first term it offers; read its custody and withdrawal terms before depositing, since the yield is managed off-chain. One deposit at about ${f.gasText} of gas, done in about 10 minutes.`,
    second: (f, name) => `Add a second, smaller deposit, about a quarter of the first, in a different term or product ${name} offers, so the wallet is not locked into a single maturity. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  Farm: {
    core: (f, name) => `Farm ${name} on ${f.chain} the way its own interface directs: deposit at least ${usd(f.capital)} into its main farm or hub pool and keep the position staked rather than harvesting daily. One or two transactions at about ${f.gasText} of gas each, about 15 minutes in all.`,
    second: (f, name) => `Stake a second, smaller amount, about a quarter of the first, into another ${name} pool a few days later, so the wallet is spread across more than one farm. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Leveraged Farming': {
    core: (f, name) => `Open a leveraged farm in ${name} on ${f.chain} at the lowest leverage it offers (2x or less): supply at least ${usd(f.capital)} as the equity leg and let the protocol borrow the rest into its farm pair. Two transactions at about ${f.gasText} of gas each, about 20 minutes in all.`,
    second: (f, name) => `Open a second, smaller leveraged position in ${name}, about a quarter of the first, in a different pair after the first has run a full week, so the wallet shows it managed the first position before adding risk. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Anchor BTC': {
    core: (f, name) => `Supply at least ${usd(f.capital)} of BTC-backed collateral through ${name} on ${f.chain} and use its anchor product the way a holder would — borrow or mint against it conservatively, or hold the anchored position — rather than passing through once. Two transactions at about ${f.gasText} of gas each, about 20 minutes in all.`,
    second: (f, name) => `Repeat the ${name} action at about a quarter of the size after the first position has settled through one full cycle, so the wallet shows it stayed. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Decentralized BTC': {
    core: (f, name) => `Bring at least ${usd(f.capital)} of bitcoin exposure on-chain through ${name} on ${f.chain} and hold or deploy the decentralised BTC it issues; keep the mint or wrap receipt in the same wallet. One or two transactions at about ${f.gasText} of gas each, about 15 minutes in all.`,
    second: (f, name) => `Use a small part of the BTC issued through ${name} in a second venue it names — a lending market or a pool — at about a quarter of the first amount, so the wallet shows the asset in use, not just minted. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Dual-Token Stablecoin': {
    core: (f, name) => `Use ${name}'s two-token system on ${f.chain} directly: mint or buy at least ${usd(f.capital)} of its stablecoin against its collateral token, and hold both sides of the pair in the same wallet so the wallet shows the full mechanism. Two transactions at about ${f.gasText} of gas each, about 15 minutes in all.`,
    second: (f, name) => `Provide a small amount of liquidity, about a quarter of the first position, to the stablecoin's main pool in ${name}'s ecosystem, so the wallet also earns from the system it holds. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Collateral Markets': {
    core: (f, name) => `Post at least ${usd(f.capital)} of collateral into ${name} on ${f.chain} and take the position its market is built around — a small mint or borrow against the collateral — keeping the ratio conservative. Two transactions at about ${f.gasText} of gas each, about 20 minutes in all.`,
    second: (f, name) => `Adjust the ${name} position once — a small top-up or a partial repay — a week later, so the wallet shows active collateral management rather than a set-and-forget deposit. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'CDP Manager': {
    core: (f, name) => `Manage a real position through ${name} on ${f.chain}: open or take over a collateralised debt position with at least ${usd(f.capital)} of collateral, set its automation (stop-loss or auto-repay) the way the product intends, and keep the ratio above 200%. Setup takes about 25 minutes; transactions cost about ${f.gasText} of gas each.`,
    second: (f, name) => `Let ${name}'s automation act at least once — a rebalance, a boost or a protection trigger — before adjusting anything by hand, then review what it did and log it. Budget about ${f.gasText} of gas and 10 minutes for the review.`,
  },
  Payments: {
    core: (f, name) => `Use ${name} as a payment rail on ${f.chain}: send at least ${usd(f.capital)} in total through it in a few real payments over two weeks — to your own second wallet or a merchant it lists — rather than one round trip. Each payment costs about ${f.gasText} of gas and a few minutes.`,
    second: (f, name) => `Receive a payment back through ${name}, or pay a different counterparty, at about a quarter of the first amount, so the wallet shows two-way use of the rail. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Stablecoin Wrapper': {
    core: (f, name) => `Wrap at least ${usd(f.capital)} of the underlying stablecoin through ${name} on ${f.chain} and hold the wrapped form; then use a small part of it where ${name} says it is accepted, so the wallet shows the wrapper in use. Two transactions at about ${f.gasText} of gas each, about 10 minutes in all.`,
    second: (f, name) => `Unwrap a small part of the ${name} position, about a quarter, after two weeks and re-wrap it, so the wallet's history shows the full round trip a real holder makes. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'OTC Marketplace': {
    core: (f, name) => `Trade through ${name}'s marketplace on ${f.chain}: complete at least ${usd(f.capital)} of volume in one or two genuine orders, using its escrow or settlement flow exactly as offered rather than a side channel. The first trade, including any onboarding, takes about 25 minutes; settlement costs about ${f.gasText} of gas.`,
    second: (f, name) => `Complete a second, smaller trade, about a quarter of the first, on the other side of the market if ${name} allows it, so the wallet shows both buying and selling. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Governance Incentives': {
    core: (f, name) => `Take part in ${name}'s incentive programme on ${f.chain} with at least ${usd(f.capital)} in the position it rewards, and vote or claim through its governance flow at least once rather than only holding the position. Two transactions at about ${f.gasText} of gas each, about 15 minutes in all.`,
    second: (f, name) => `Claim the first incentive the ${name} position earns and restake or reuse it inside the same programme, at whatever size it lands, so the wallet shows the full earn-and-claim loop. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  Insurance: {
    core: (f, name) => `Buy cover through ${name} on ${f.chain} for a position you actually hold elsewhere: at least ${usd(f.capital)} of cover value for one full term, chosen against a named protocol risk. The purchase costs about ${f.gasText} of gas and takes about 15 minutes including reading the cover wording.`,
    second: (f, name) => `Renew or extend the ${name} cover once, or cover a second smaller position at about a quarter of the first cover's value, so the wallet shows continuing rather than one-off protection. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Crypto Card Issuer': {
    core: (f, name) => `Use ${name}'s card product the way a holder would: complete its onboarding, load at least ${usd(f.capital)} onto the card balance through ${f.chain}, and make several ordinary purchases over two weeks rather than one test transaction. Onboarding takes about 20 minutes; loads cost about ${f.gasText} of gas.`,
    second: (f, name) => `Top the ${name} card up a second time, about a quarter of the first load, after the first balance is spent down, so the wallet shows a reload cycle. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Uncollateralized Lending': {
    core: (f, name) => `Lend at least ${usd(f.capital)} into ${name}'s credit pool on ${f.chain} for one full loan cycle, after reading which borrowers the pool serves and what its repayment record shows. One deposit at about ${f.gasText} of gas, done in about 15 minutes including the reading.`,
    second: (f, name) => `Roll the first cycle's proceeds into a second ${name} pool or a second cycle at about a quarter of the size, so the wallet shows it stayed after seeing a full repayment round. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  Indexes: {
    core: (f, name) => `Buy at least ${usd(f.capital)} of ${name}'s index product on ${f.chain} and hold it through at least one rebalance, noting the basket's constituents before buying. One purchase at about ${f.gasText} of gas, done in about 10 minutes.`,
    second: (f, name) => `Add a second purchase of ${name}, about a quarter of the first, after the first rebalance you observe, so the wallet's timing follows the index's own schedule. Budget about ${f.gasText} of gas and 10 minutes.`,
  },
  'Interest Rate Derivatives': {
    core: (f, name) => `Take a small position in ${name}'s rate market on ${f.chain}: fix or float at least ${usd(f.capital)} of notional at the longest tenor you can follow, and hold it for at least two weeks. The opening costs about ${f.gasText} of gas and takes about 20 minutes including reading the market's terms.`,
    second: (f, name) => `Open the opposite side in ${name}, or a shorter tenor, at about a quarter of the first notional after the first position has run a week, so the wallet shows it is managing rate exposure rather than guessing once. Budget about ${f.gasText} of gas and 10 minutes.`,
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
  Derivatives: 'check the margin ratio and funding payments, and top up margin before it drifts toward the liquidation band',
  'Yield Aggregator': 'check which strategies the vault is routed into and whether any underlying venue changed',
  Chain: 'check bridged balances and whether any native application changed its fees or closed deposits',
  'Staking Pool': 'check validator or pool performance and any change to commission or unbonding terms',
  'Liquidity Manager': 'check whether the manager rebalanced the range and what fees the position actually earned',
  'Prediction Market': 'check open positions for early resolution, market closure or disputed outcomes',
  CeDeFi: 'check withdrawal windows and any change to the product\u2019s stated terms or custody arrangement',
  Farm: 'check the farm\u2019s reward rate and whether the pool is being wound down or replaced',
  'Leveraged Farming': 'check the position\u2019s health and debt ratio, and deleverage before it nears the liquidation threshold',
  'Anchor BTC': 'check the backing reports and any change to mint and redemption fees',
  'Decentralized BTC': 'check the peg and reserve reports and any change to mint and redemption fees',
  'Dual-Token Stablecoin': 'check the stablecoin\u2019s peg and the collateral token\u2019s price trend, since the pair moves together',
  'Collateral Markets': 'check the collateral ratio and any change to the market\u2019s accepted collateral list',
  'CDP Manager': 'check the managed position\u2019s ratio and whether its automation triggers fired or were changed',
  Payments: 'check settlement times and any change to the rail\u2019s fees or supported assets',
  'Stablecoin Wrapper': 'check that the wrapped form still redeems one-for-one and whether its accepted venues changed',
  'OTC Marketplace': 'check open orders and escrow balances, and any change to the marketplace\u2019s settlement terms',
  'Governance Incentives': 'check the programme\u2019s remaining budget and whether its rewarded actions changed',
  Insurance: 'check the cover\u2019s remaining term and whether its exclusions or claims process changed',
  'Crypto Card Issuer': 'check card fees, load limits and any change to the issuer\u2019s terms',
  'Uncollateralized Lending': 'check the pool\u2019s repayment news and any late or defaulted loans in it',
  Indexes: 'check the basket after each rebalance for constituents added or dropped',
  'Interest Rate Derivatives': 'check the position\u2019s mark against the current rate curve and its margin headroom',
};

/** Which watch brief a category gets in step 5: what an early user of that kind of
 * protocol actually watches for. Categories not listed get the general brief. */
const WATCH_GROUPS: Record<string, 'markets' | 'curators' | 'vaults' | 'credit'> = {
  Derivatives: 'markets',
  Dexs: 'markets',
  'Interest Rate Derivatives': 'markets',
  'Prediction Market': 'markets',
  'Risk Curators': 'curators',
  'Onchain Capital Allocator': 'curators',
  Yield: 'vaults',
  'Yield Aggregator': 'vaults',
  'Staking Pool': 'vaults',
  'Liquidity Manager': 'vaults',
  'Leveraged Farming': 'vaults',
  CeDeFi: 'vaults',
  'Dual-Token Stablecoin': 'vaults',
  Indexes: 'vaults',
  Lending: 'credit',
  CDP: 'credit',
  'CDP Manager': 'credit',
  'Uncollateralized Lending': 'credit',
  'Collateral Markets': 'credit',
  'Basis Trading': 'credit',
};

/** Step 5 of the plan: the watch brief, worded for the kind of protocol this row is,
 * followed by the 7-day move sentence and the log-keeping sentence. */
function watchStep(p: Protocol, move: string): string {
  const group = (p.category !== null ? WATCH_GROUPS[p.category] : undefined) ?? 'general';
  const log = 'Keep the dated transaction log current; it is the evidence of genuine early use if a snapshot or claim is ever announced.';
  switch (group) {
    case 'markets':
      return `Watch ${p.name}'s markets for the remaining weeks: track its volume, open interest and any new market listings or season announcements each week. ${move} Log every trade with its date and transaction hashes; a dated trading history is the evidence of genuine early use if a snapshot or claim is ever announced.`;
    case 'curators':
      return `Watch how ${p.name} allocates for the remaining weeks: read each rebalance or vault update it publishes and re-check its allocations on this radar weekly. ${move} ${log}`;
    case 'vaults':
      return `Watch ${p.name}'s vaults for the remaining weeks: follow its strategy and share-price reporting and re-check the position on this radar weekly. ${move} ${log}`;
    case 'credit':
      return `Watch ${p.name}'s credit conditions for the remaining weeks: follow its governance and parameter changes (caps, rates, collateral lists) and re-check the position on this radar weekly. ${move} ${log}`;
    default:
      return `Watch ${p.name} for the remaining weeks: follow its official announcements and re-check it on this radar weekly. ${move} ${log}`;
  }
}

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
    watchStep(p, move),
    `Close out the ${p.name} position ready: over the ${f.weeks}-week horizon the plan costs about ${usd(f.totalCost)} in gas and fees (setup ${usd(f.costs[0]!.usd)}, upkeep ${usd(f.costs[1]!.usd)}), on top of the ${usd(f.capital)} of working capital that stays in the position. Main risk — ${(f.risks[1] ?? f.risks[0]!).replace(/\.$/, '')}. Be ready to claim and stake any token it issues, and unwind in an orderly way if it announces there will be none.`,
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
