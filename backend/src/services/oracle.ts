// Price oracle — GenLayer (primary) + DexScreener (fallback)
//
// GenLayer: validators reach independent consensus on the price.
//   Nobody — not even us — can manipulate the result.
// DexScreener: direct API call (centralized fallback if GenLayer is not configured).
//
// Docs: https://docs.dexscreener.com/api/reference

import { getPriceFromGenLayer, isGenLayerConfigured } from "./genLayerOracle.js";

// ─── Simple in-memory cache for DexScreener responses (60s TTL) ───────────────
const _cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 60_000; // 1 minute

async function dexFetch(url: string): Promise<any> {
  const cached = _cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const res = await fetch(url, { headers: { "User-Agent": "FUDMarkets/1.0" } });
  if (res.status === 429) throw new Error(`DexScreener rate limit hit — try again in a moment`);
  if (!res.ok) throw new Error(`DexScreener fetch failed: ${res.status}`);

  const data = await res.json();
  _cache.set(url, { data, ts: Date.now() });
  return data;
}

const CHAIN_MAP: Record<string, string> = {
  SOL:  "solana",
  BASE: "base",
  ETH:  "ethereum",
  BSC:  "bsc",
};

const DEXSCREENER = "https://api.dexscreener.com/latest/dex/search";

export async function getPrice(symbol: string, chain = "SOL"): Promise<number> {
  // Always use DexScreener for fast price lookups (market creation, entry price)
  // GenLayer is used only for settlement resolution (see resolveWithGenLayer below)
  console.log(`[oracle] DexScreener for ${symbol}/${chain}`);
  const chainId = CHAIN_MAP[chain.toUpperCase()] ?? "solana";

  const data = await dexFetch(`${DEXSCREENER}?q=${encodeURIComponent(symbol)}`) as any;
  const pairs: any[] = data.pairs ?? [];

  if (pairs.length === 0) throw new Error(`No pairs found for ${symbol}`);

  // Prefer pairs on the correct chain, USD-quoted, sorted by liquidity desc
  const USD_QUOTES = ["USDC", "USDT", "USD", "BUSD", "DAI"];
  const isUsdQuote = (p: any) => USD_QUOTES.includes(p.quoteToken?.symbol?.toUpperCase());

  const onChain    = pairs.filter((p) => p.chainId === chainId && p.priceUsd && parseFloat(p.priceUsd) > 0);
  const usdPairs   = onChain.filter(isUsdQuote);
  // Prefer USD-quoted; fall back to any pair on chain; last resort: any chain
  const pool = usdPairs.length > 0 ? usdPairs
             : onChain.length > 0  ? onChain
             : pairs.filter((p) => p.priceUsd && parseFloat(p.priceUsd) > 0);

  const sorted = pool.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  if (sorted.length === 0) throw new Error(`No valid price for ${symbol} on ${chainId}`);

  return parseFloat(sorted[0].priceUsd);
}

/**
 * Get price for market resolution — tries GenLayer first (decentralized consensus),
 * falls back to DexScreener if GenLayer fails or is not configured.
 */
export async function getPriceForResolution(symbol: string, chain = "SOL"): Promise<number> {
  if (isGenLayerConfigured()) {
    try {
      return await getPriceFromGenLayer(symbol, chain);
    } catch (err) {
      console.warn(`[oracle] GenLayer failed for ${symbol}, falling back to DexScreener:`, err);
    }
  }
  return getPrice(symbol, chain);
}

// Entry screening thresholds — applied only to tokens not yet in the system
const SCREEN = {
  MIN_TXS_24H:   5,
  MIN_VOL_24H:   100,     // USD
  MIN_FEES_24H:  5,       // USD  (estimated as volume × 0.3%)
  MIN_MCAP:      10_000,  // USD
  FEE_RATE:      0.003,   // 0.3% — typical AMM fee
};

export type ScreenResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Fetch metrics for a token by contract address and check entry thresholds. */
export async function screenToken(ca: string): Promise<ScreenResult> {
  let pairs: any[];
  try {
    const data = await dexFetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(ca.trim())}`
    ) as any;
    pairs = data.pairs ?? [];
  } catch {
    return { ok: false, reason: "Token verification request failed." };
  }

  if (pairs.length === 0) return { ok: false, reason: "Token not found on DexScreener." };

  // Pick the most liquid pair for metrics
  const best = pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

  const txns24h  = (best.txns?.h24?.buys ?? 0) + (best.txns?.h24?.sells ?? 0);
  const vol24h   = best.volume?.h24 ?? 0;
  const fees24h  = vol24h * SCREEN.FEE_RATE;
  const mcap     = best.marketCap ?? best.fdv ?? 0;

  if (txns24h < SCREEN.MIN_TXS_24H)
    return { ok: false, reason: `Not enough activity — ${txns24h} txs in 24h (min ${SCREEN.MIN_TXS_24H}).` };

  if (vol24h < SCREEN.MIN_VOL_24H)
    return { ok: false, reason: `Volume too low — $${Math.round(vol24h).toLocaleString()} in 24h (min $${SCREEN.MIN_VOL_24H.toLocaleString()}).` };

  if (fees24h < SCREEN.MIN_FEES_24H)
    return { ok: false, reason: `Fee revenue too low — ~$${fees24h.toFixed(2)} in 24h (min $${SCREEN.MIN_FEES_24H}).` };

  if (mcap < SCREEN.MIN_MCAP)
    return { ok: false, reason: `Market cap too low — $${Math.round(mcap).toLocaleString()} (min $${SCREEN.MIN_MCAP.toLocaleString()}).` };

  return { ok: true };
}
