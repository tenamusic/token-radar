// Token Radar's model (radar-2): one sealed snapshot in, one ranked board out.
//
// THE BOARD
// The board ranks protocols whose token does not exist yet. It covers every slug in the snapshot's
// watchlist (the floor, never a ceiling), then adds the largest further pre-token protocols that pass
// the watchlist's own independence tests at any size: no token recorded, not an exchange, not a
// wrapped/staked/bridged product of a protocol whose token already trades, and not a versioned pool
// of another protocol. Protocols that already have a token are never ranked; the largest of them are
// carried separately as the "live" set, valued by the market itself, so the page can show the two
// worlds apart.
//
// THE VALUE MODEL
// A launch's implied value is what the protocol's record would support if it issued a token today:
//
//   implied = TVL x category_multiple x growth_factor x vintage_factor x reach_factor
//
//   category_multiple  The median market-cap / TVL ratio of the snapshot's OWN tokenised protocols
//                      in the same category (at least 2 peers, else the all-category median),
//                      clamped to [0.20, 2.50]. A lending market is priced the way lending markets
//                      with tokens are priced, not by one flat multiple for everything.
//   growth_factor      1 + clamp(change_7d, -50, +100) / 100 x 0.60, so a protocol whose TVL grew
//                      50% in a week is marked up 30% and one that halved is marked down 30%.
//                      An unreported change counts as 0.
//   vintage_factor     0.80 + 0.45 x min(age_days, 1460) / 1460: a protocol that has run for years
//                      at scale with no token has more accrued value to launch into than a new one.
//                      An unknown listing date counts as one year.
//   reach_factor       1 + 0.03 x min(chains - 1, 10): distribution across chains supports a higher
//                      launch value, up to +30% for the widest protocols.
//
// Every factor is computed from the snapshot's own fields by the same function for every row; no
// protocol name is ever special-cased. Each board row carries its four factors, so any reader can
// recompute its implied value from the row itself.

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

/** The model's version label: the dashboard names it and the board rows carry it. */
export const MODEL_VERSION = 'radar-2';

/** How many early (below-the-floor) protocols the board adds beyond the watchlist. */
export const EARLY_ROWS = 180;

/** How many live-token protocols the dashboard's live set carries, by market cap. */
export const LIVE_ROWS = 20;

/** The model's constants, stated in the dashboard exactly as used here. */
export const MODEL = {
  multiple_floor: 0.2,
  multiple_cap: 2.5,
  multiple_min_peers: 2,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  growth_weight: 0.6,
  vintage_base: 0.8,
  vintage_range: 0.45,
  vintage_days: 1460,
  unknown_age_days: 365,
  reach_per_chain: 0.03,
  reach_max_extra_chains: 10,
} as const;

/** The four factors behind one row's implied value. */
export interface Factors {
  category_multiple: number;
  growth_factor: number;
  vintage_factor: number;
  reach_factor: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  factors: Factors;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so it is shown at the market's value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  mcap_tvl: number | null;
  change_7d: number | null;
}

/** One category's peer multiple, as the dashboard's model table states it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  peers: number;
  fallback: boolean;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  multiples: CategoryMultiple[];
  rows: BoardRow[];
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

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when the date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule treats as products of another protocol, not launches of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a product may begin with (the watchlist rule's list). */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a pre-token protocol is an independent launch candidate: the watchlist's own tests,
 * applied at any size. A wrapped BTC, an exchange's staking product or a canonical bridge is a
 * product of a token that already trades, not a token that does not exist yet.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Each category's launch multiple: the median market-cap / TVL of the snapshot's tokenised
 * protocols in that category, clamped; categories with too few tokenised peers fall back to the
 * all-category median. Derived from the snapshot at run time, never a typed-in list of values.
 */
export function categoryMultiples(snapshot: Snapshot): Map<string, CategoryMultiple> {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRatios.push(ratio);
    const key = p.category ?? '(uncategorised)';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const globalMultiple = clamp(median(allRatios), MODEL.multiple_floor, MODEL.multiple_cap);
  const out = new Map<string, CategoryMultiple>();
  const categories = new Set<string>();
  for (const p of snapshot.protocols) categories.add(p.category ?? '(uncategorised)');
  for (const category of categories) {
    const peers = ratiosByCategory.get(category) ?? [];
    if (peers.length >= MODEL.multiple_min_peers) {
      out.set(category, {
        category,
        multiple: round4(clamp(median(peers), MODEL.multiple_floor, MODEL.multiple_cap)),
        peers: peers.length,
        fallback: false,
      });
    } else {
      out.set(category, { category, multiple: round4(globalMultiple), peers: peers.length, fallback: true });
    }
  }
  return out;
}

/** One protocol's four factors and implied value under the model. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, CategoryMultiple>,
): { implied: number; age: number | null; factors: Factors } {
  const age = ageDays(asOf, p.listed_at);
  const multiple = multiples.get(p.category ?? '(uncategorised)')?.multiple ?? 1;
  const growthPct = clamp(p.change_7d ?? 0, MODEL.growth_floor_pct, MODEL.growth_cap_pct);
  const growthFactor = 1 + (growthPct / 100) * MODEL.growth_weight;
  const ageForModel = age ?? MODEL.unknown_age_days;
  const vintageFactor = MODEL.vintage_base + (Math.min(ageForModel, MODEL.vintage_days) / MODEL.vintage_days) * MODEL.vintage_range;
  const reachFactor = 1 + MODEL.reach_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.reach_max_extra_chains);
  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * multiple * growthFactor * vintageFactor * reachFactor),
  );
  return {
    implied,
    age,
    factors: {
      category_multiple: multiple,
      growth_factor: round4(growthFactor),
      vintage_factor: round4(vintageFactor),
      reach_factor: round4(reachFactor),
    },
  };
}

const bySlugAsc = (a: SnapshotProtocol, b: SnapshotProtocol): number =>
  a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;

/** The protocols the board ranks: the whole watchlist, then the largest further launch candidates. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isLaunchCandidate(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugAsc(a, b))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const multiples = categoryMultiples(snapshot);
  const scored = [...chosen.values()].map((p) => {
    const { implied, age, factors } = impliedValue(p, snapshot.as_of, multiples);
    return { p, implied, age, factors };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || bySlugAsc(a.p, b.p));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    watchlist: watchlist.has(s.p.slug),
    implied_value_usd: s.implied,
    factors: s.factors,
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The live set: the largest tokenised protocols, at the market's own values, kept off the board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlugAsc(a, b))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const multiples = [...categoryMultiples(snapshot).values()].sort((a, b) =>
    a.category < b.category ? -1 : a.category > b.category ? 1 : 0,
  );
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    multiples,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The dashboard's data file: the radar as a script the static page reads. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/**
 * Why this board would fail the gate, or null when it passes: the same checks main.ts can make
 * before writing anything (shape, ordering, coverage, step lengths).
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allEqual = board.length > 1;
  for (const [i, row] of board.entries()) {
    if (row.rank !== i + 1) return `row ${row.slug} has rank ${row.rank}, expected ${i + 1}`;
    if (slugs.has(row.slug)) return `slug ${row.slug} appears twice`;
    slugs.add(row.slug);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 100_000_000_000_000)
      return `row ${row.slug} has implied value ${row.implied_value_usd}`;
    if (row.implied_value_usd > previous) return `implied value rises at rank ${row.rank}`;
    if (row.implied_value_usd !== board[0]!.implied_value_usd) allEqual = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12)
      return `row ${row.slug} has ${row.farm_steps.length} farm steps, outside 3..12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug} has a farm step of ${len} characters, outside 20..600`;
    }
  }
  if (allEqual) return 'every implied value is the same: not a ranking';
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

// ------------------------------------------------------------------ farm plans
//
// A protocol's farm plan is generated from its own record: the category picks the core action, the
// main chain picks the gas estimate, the TVL picks a sensible position size, the age picks the
// holding window, and the 7-day change adds a momentum note. Six steps each, every step carrying
// its action, its cost and its time, so a reader can follow the plan without leaving the page.

/** A deterministic per-protocol variant picker (FNV-1a over the slug), so plans vary by protocol. */
function variant(slug: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % n;
}

/** The chain the plan works on: the protocol's first-listed chain. */
function mainChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

/** A sensible size for one farm position, from the protocol's own scale. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** Rough per-action network cost on the protocol's main chain. */
function gasFor(chain: string): { label: string; usd: number } {
  if (chain === 'Ethereum') return { label: 'mainnet gas', usd: 12 };
  if (chain === 'Solana' || chain === 'Bitcoin') return { label: 'network fees', usd: 1 };
  if (chain === 'Binance' || chain === 'Tron') return { label: 'network fees', usd: 2 };
  return { label: 'gas', usd: 3 };
}

/** How long a position should season, from the protocol's age: younger protocols season longer. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 21;
}

/** The core farming action for a category, in words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('uncollateralized')) return `Lend $${capital} of USDC into one of ${n}'s credit vaults on ${chain}, choosing the vault whose borrower pool you can actually diligence.`;
  if (c.includes('lend') || c.includes('cdp')) return `Supply $${capital} of USDC as collateral in ${n} on ${chain}, then borrow a small amount against it so both sides of the market see your wallet.`;
  if (c.includes('dex')) return `Add $${capital} of two-sided liquidity to ${n}'s busiest pool on ${chain} and leave the LP position untouched between weekly check-ins.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Deposit $${capital} of USDC margin on ${n} and run one small hedged position (long spot, short perp) so your volume is real but directional risk stays near zero.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${n} curated vault on ${chain}; curator vaults are where points programs for this category usually attach.`;
  if (c.includes('basis')) return `Fund ${n} with $${capital} on ${chain} and open the basis position it is built for, keeping the hedge leg exactly matched.`;
  if (c.includes('leveraged farm')) return `Open a conservative 2x leveraged farm on ${n} with $${capital} on ${chain}, well inside its liquidation buffer.`;
  if (c.includes('yield')) return `Deposit $${capital} into ${n}'s main yield vault on ${chain} and keep the vault shares in the farming wallet.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s real-world-asset yield token on ${chain} and hold it; RWA issuers reward duration, not churn.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the base asset through ${n} on ${chain} and hold the staking receipt in the farming wallet.`;
  if (c.includes('bridge')) return `Route $${capital} of USDC across ${n} to ${chain} and put the bridged funds to work in one app on the far side.`;
  if (c.includes('prediction')) return `Fund ${n} with $${capital} and hold one position in a liquid market until it settles.`;
  if (c.includes('stablecoin') || c.includes('stable')) return `Mint or deposit $${capital} of the stable asset ${n} issues on ${chain} and hold it in the farming wallet.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${n}'s chain and use two or three of its native apps so the wallet builds a real footprint there.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover through ${n} on ${chain} and keep the policy active for a full term.`;
  if (c.includes('index')) return `Buy $${capital} of ${n}'s index product on ${chain} and hold it rather than trading in and out.`;
  if (c.includes('card')) return `Order ${n}'s card, fund it with $${capital} and route one month of ordinary spending through it.`;
  if (c.includes('otc') || c.includes('marketplace')) return `Complete one $${capital} trade through ${n}'s marketplace on ${chain} as a genuine counterparty.`;
  if (c.includes('privacy')) return `Make one shielded deposit of $${capital} into ${n} on ${chain} and let it season before any withdrawal.`;
  if (c.includes('farm')) return `Stake $${capital} in ${n}'s main farm on ${chain} and compound the rewards back into the same position weekly.`;
  if (c.includes('liquidity')) return `Place $${capital} with ${n}'s liquidity program on ${chain}, inside its suggested range, and rebalance only on the weekly check-in.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open and untouched between check-ins.`;
}

/** The follow-up interaction that makes a wallet look like a user, not a passer-by. */
function secondAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Repay part of the borrow and draw it again once, so the wallet shows a full borrow-repay cycle in ${n}.`;
  if (c.includes('dex')) return `Make two small swaps through ${n}'s own interface on ${chain} on different days, rather than routing through an aggregator.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Close the hedge and reopen it once at a smaller size, so the account shows completed trades, not just an open ticket.`;
  if (c.includes('bridge')) return `Bridge a smaller amount back the other way a week later, so the wallet has flow in both directions through ${n}.`;
  if (c.includes('staking') || c.includes('restak') || c.includes('yield')) return `Claim rewards once and restake or redeposit them inside ${n}, so the wallet shows a compounding cycle.`;
  return `Use one second feature of ${n} on ${chain} (a vote, a boost, a referral-free second deposit) so the wallet is not a single-transaction address.`;
}

/** A momentum note from the protocol's own 7-day change, or a neutral cadence note. */
function momentumNote(p: SnapshotProtocol): string {
  const g = p.change_7d;
  if (g !== null && g >= 25) return `TVL is up ${g.toFixed(1)}% in seven days: momentum this strong often precedes a points season, so start the position before the crowd reprices it.`;
  if (g !== null && g <= -25) return `TVL is down ${Math.abs(g).toFixed(1)}% in seven days: size the position at the low end and check the protocol's own channels before adding more.`;
  if (g !== null && g >= 5) return `TVL is growing steadily (${g.toFixed(1)}% in seven days): a normal weekly cadence is enough to stay visible without over-trading.`;
  if (g !== null && g <= -5) return `TVL is drifting down (${g.toFixed(1)}% in seven days): keep the position small and let the holding window, not new deposits, do the work.`;
  return `TVL is broadly flat over seven days: the holding window matters more than trade count for this one.`;
}

/** One protocol's farm plan: six steps, each with its action, cost and time. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = mainChain(p);
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const v = variant(p.slug, 3);
  const openers = [
    `Start with a fresh wallet funded only with the $${capital} you mean to farm ${p.name} with, and store its seed phrase offline.`,
    `Create a dedicated wallet for ${p.name} holding only the farming funds (about $${capital}), and keep its seed phrase offline.`,
    `Set up one clean wallet per protocol: fund it with roughly $${capital} for ${p.name} and keep the seed phrase offline.`,
  ];
  const steps = [
    `${openers[v]!} Cost: about $${gas.usd} of ${gas.label} to fund and approve. Time: 10 minutes.`,
    `${coreAction(p, capital, chain)} Cost: $${capital} of capital plus about $${gas.usd * 2} of ${gas.label}. Time: 20 minutes to set up.`,
    `${secondAction(p, chain)} Cost: about $${gas.usd} of ${gas.label}. Time: 10 minutes.`,
    `${momentumNote(p)} Cost: about $${gas.usd} of ${gas.label} per weekly action. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so it appears in several weekly snapshots, and check ${p.name}'s own points or rewards page once a week, claiming only from links the protocol itself publishes. Cost: the $${capital} stays committed; never pay anyone to "unlock" a claim. Time: ${hold} days, minutes a week.`,
    `Keep a farm log (wallet, dates, transaction hashes, amounts) and unwind in the reverse order you entered once the season ends or the token launches. Cost: nothing but the exit ${gas.label}, about $${gas.usd * 2}. Time: 15 minutes to log, 20 minutes to exit.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
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
  if (typeof o.as_of !== 'string' || typeof o.floor_usd !== 'number' || !Array.isArray(o.protocols) || !Array.isArray(o.watchlist))
    throw new SnapshotError('snapshot.json is missing as_of, floor_usd, protocols or watchlist');
  const protocols: SnapshotProtocol[] = o.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) throw new SnapshotError(`protocols[${i}] is not an object`);
    const p = entry as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      !(typeof p.category === 'string' || p.category === null) ||
      !Array.isArray(p.chains) ||
      typeof p.tvl_usd !== 'number' ||
      !(typeof p.change_7d === 'number' || p.change_7d === null) ||
      !(typeof p.mcap_usd === 'number' || p.mcap_usd === null) ||
      !(typeof p.listed_at === 'string' || p.listed_at === null) ||
      !(typeof p.gecko_id === 'string' || p.gecko_id === null) ||
      !(typeof p.symbol === 'string' || p.symbol === null)
    )
      throw new SnapshotError(`protocols[${i}] does not carry the ten snapshot fields`);
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains.filter((c): c is string => typeof c === 'string'),
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
    };
  });
  return {
    as_of: o.as_of,
    source: typeof o.source === 'string' ? o.source : '',
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist.filter((s): s is string => typeof s === 'string'),
  };
}
