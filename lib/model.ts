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
//   3. the base log-value is the plain average of the two estimates;
//   4. momentum (7-day TVL change) and track record (age since first tracked) adjust it.
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

/** The fitted peer model: size curve, global multiple and per-category multiples. */
export interface Fit {
  peers: number;
  a: number;
  b: number;
  r2: number;
  globalMultiple: number;
  categoryMultiples: Map<string, { n: number; multiple: number }>;
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
  farm_steps: string[];
}

/** The cost/time summary of one row's farm plan, shown in the detail view. */
export interface FarmSummary {
  total_cost_usd: number;
  setup_time: string;
  weekly_upkeep: string;
  horizon: string;
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

/** Fit the peer model: the log-log size curve and the shrunk category multiples. */
export function fitPeers(snapshot: Snapshot): Fit {
  const peers = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const xs = peers.map((p) => Math.log10(p.tvl_usd));
  const ys = peers.map((p) => Math.log10(p.mcap_usd!));
  const n = peers.length;
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
  const globalMultiple = median(peers.map((p) => p.mcap_usd! / p.tvl_usd));
  const byCategory = new Map<string, number[]>();
  for (const p of peers) {
    const key = p.category ?? '';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, list);
  }
  const categoryMultiples = new Map<string, { n: number; multiple: number }>();
  for (const [key, ratios] of byCategory) {
    const catMedian = median(ratios);
    const multiple = (ratios.length * catMedian + 6 * globalMultiple) / (ratios.length + 6);
    categoryMultiples.set(key, { n: ratios.length, multiple });
  }
  return { peers: n, a, b, r2, globalMultiple, categoryMultiples };
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

/** Score one pre-token protocol under the fitted model. */
function score(p: Protocol, snapshot: Snapshot, fit: Fit, watchlist: boolean): Scored {
  const logTvl = Math.log10(Math.max(1, p.tvl_usd));
  const sizeLog = fit.a + fit.b * logTvl;
  const cat = fit.categoryMultiples.get(p.category ?? '');
  const categoryMultiple = cat === undefined ? fit.globalMultiple : cat.multiple;
  const catLog = logTvl + Math.log10(categoryMultiple);
  const baseLog = 0.5 * sizeLog + 0.5 * catLog;
  const momentumFactor = p.change_7d === null ? 1 : 1 + 0.01 * clamp(p.change_7d, -25, 25);
  const days = ageInDays(snapshot.as_of, p.listed_at);
  const ageYears = days === null ? null : days / 365.25;
  let ageFactor = 1;
  if (ageYears !== null) ageFactor = ageYears < 0.25 ? 0.9 : 1 + 0.06 * Math.min(ageYears, 4);
  const implied = Math.max(1, Math.round(10 ** baseLog * momentumFactor * ageFactor));
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
    },
    categoryMultiples,
    rows,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- farm plans
// A first, generic-but-concrete plan generator: every step names the protocol, its cheapest
// chain, a dollar cost and a time. The per-category action library replaces the middle steps
// in the next pass of this file.

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
  chain: string;
  gasText: string;
  gasMid: number;
  capital: number;
  totalCost: number;
}

/** Derive a row's plan figures: cheapest chain, capital tier, and the horizon's gas total. */
function planFigures(row: Scored): PlanFigures {
  const { chain, gas } = cheapestChain(row.p);
  const capital = capitalFor(row.p.tvl_usd);
  // 4 setup transactions, then 2 upkeep transactions a week over a 6-week horizon, plus fees.
  const totalCost = Math.round(4 * gas[2] + 6 * 2 * gas[2] + 10);
  return { chain, gasText: `$${gas[0]}-$${gas[1]}`, gasMid: gas[2], capital, totalCost };
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

/** Five concrete steps for one row: setup, core action, second action, upkeep, exit. */
function farmSteps(row: Scored): string[] {
  const p = row.p;
  const f = planFigures(row);
  const actions = (p.category !== null ? CATEGORY_ACTIONS[p.category] : undefined) ?? GENERIC_ACTIONS;
  return [
    `Set up a dedicated wallet for ${p.name} and fund it on ${f.chain}, its cheapest chain: gas there runs about ${f.gasText} per transaction, so keep a small buffer of the chain's gas token plus ${usd(f.capital)} of working capital ready. Setup takes about 20 minutes.`,
    actions.core(f, p.name),
    actions.second(f, p.name),
    `Maintain the ${p.name} position weekly: check it once a week on ${f.chain}, rebalance or top up if the balance drifts by more than a fifth, and record each visit in a dated log. Upkeep costs about ${f.gasText} in gas and 10 minutes per week.`,
    `Track ${p.name} through its official announcements and this radar for a 4-8 week horizon, keep the transaction log, and be ready to claim and stake any token it issues. Total estimated cost over the horizon is about ${usd(f.totalCost)} in gas and fees, on top of the ${usd(f.capital)} of working capital, most of which stays in the position.`,
  ];
}

/** The summary figures the detail view shows beside the plan. */
function farmSummary(row: Scored): FarmSummary {
  const f = planFigures(row);
  return {
    total_cost_usd: f.totalCost,
    setup_time: 'about 35 minutes',
    weekly_upkeep: `about 10 minutes and ~$${(2 * f.gasMid).toFixed(2)} of gas`,
    horizon: '6 weeks (4-8)',
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
