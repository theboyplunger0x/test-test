// Chart data utilities — DexScreener (token/pair lookup) + GeckoTerminal (OHLCV)
import type { UTCTimestamp } from "lightweight-charts";

export type Candle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TokenInfo = {
  symbol: string;
  name: string;
  address: string;
  chainId: string;       // dexscreener chainId (e.g. "solana", "base")
  chainLabel: string;    // our label (e.g. "SOL", "BASE")
  price: number;
  change24h: number;
  liquidity: number;
  volume24h: number;
  marketCap: number;
  pairAddress: string;
};

const CHAIN_LABEL: Record<string, string> = {
  solana:   "SOL",
  base:     "BASE",
  ethereum: "ETH",
  bsc:      "BSC",
};

const GECKO_NET: Record<string, string> = {
  SOL:      "solana",
  BASE:     "base",
  ETH:      "eth",
  BSC:      "bsc",
  solana:   "solana",
  base:     "base",
  ethereum: "eth",
  bsc:      "bsc",
};

const DS_CHAIN: Record<string, string> = {
  SOL: "solana", BASE: "base", ETH: "ethereum", BSC: "bsc",
};

// ─── DexScreener ──────────────────────────────────────────────────────────────

const USD_QUOTES = ["USDC", "USDT", "USD", "BUSD", "DAI"];

export function pairsToTokenInfo(pairs: any[]): TokenInfo | null {
  const withPrice = pairs.filter((p) => p.priceUsd && parseFloat(p.priceUsd) > 0);
  // Prefer USD-quoted pairs (most accurate for USD price tracking)
  const usdPairs = withPrice.filter((p) => USD_QUOTES.includes(p.quoteToken?.symbol?.toUpperCase()));
  const pool = usdPairs.length > 0 ? usdPairs : withPrice;
  const valid = pool.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  if (valid.length === 0) return null;
  const p = valid[0];
  return {
    symbol:      p.baseToken.symbol.toUpperCase(),
    name:        p.baseToken.name,
    address:     p.baseToken.address,
    chainId:     p.chainId,
    chainLabel:  CHAIN_LABEL[p.chainId] ?? p.chainId.toUpperCase(),
    price:       parseFloat(p.priceUsd),
    change24h:   p.priceChange?.h24 ?? 0,
    liquidity:   p.liquidity?.usd ?? 0,
    volume24h:   p.volume?.h24 ?? 0,
    marketCap:   p.marketCap ?? p.fdv ?? 0,
    pairAddress: p.pairAddress,
  };
}

/** Look up a token by contract address */
export async function searchByCA(address: string): Promise<TokenInfo | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address.trim()}`);
    if (!res.ok) return null;
    const data = await res.json();
    const allPairs: any[] = data.pairs ?? [];
    // Prefer pairs where baseToken.address exactly matches — this pins the result
    // to the correct chain (e.g. Solana address won't resolve to a Base bridged version)
    const addr = address.trim().toLowerCase();
    const matchingPairs = allPairs.filter((p) =>
      p.baseToken?.address?.toLowerCase() === addr
    );
    return pairsToTokenInfo(matchingPairs.length > 0 ? matchingPairs : allPairs);
  } catch {
    return null;
  }
}

/** Search tokens by query — returns up to 8 distinct tokens (best pair per address) */
export async function searchTokens(query: string): Promise<TokenInfo[]> {
  try {
    const q = query.trim();
    const isCA = q.length > 20 && !q.includes(" ");
    const url = isCA
      ? `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(q)}`
      : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const pairs: any[] = data.pairs ?? [];
    // One best result per unique base token address
    const seen = new Map<string, TokenInfo>();
    for (const p of pairs) {
      if (!p.priceUsd || parseFloat(p.priceUsd) === 0) continue;
      const addr = p.baseToken?.address?.toLowerCase();
      if (!addr) continue;
      const info = pairsToTokenInfo([p]);
      if (!info) continue;
      if (!seen.has(addr) || info.liquidity > (seen.get(addr)?.liquidity ?? 0)) {
        seen.set(addr, info);
      }
    }
    return Array.from(seen.values())
      .sort((a, b) => b.liquidity - a.liquidity)
      .slice(0, 8);
  } catch {
    return [];
  }
}

/** Look up a token by symbol + chain (best liquidity pair) */
export async function searchBySymbol(symbol: string, chain: string): Promise<TokenInfo | null> {
  try {
    const chainId = DS_CHAIN[chain.toUpperCase()] ?? "solana";
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const pairs: any[] = data.pairs ?? [];
    const onChain = pairs.filter((p) => p.chainId === chainId);
    // Prefer USD-quoted pairs on chain; fall back to any on chain; last resort any chain
    const onChainUsd = onChain.filter((p) => USD_QUOTES.includes(p.quoteToken?.symbol?.toUpperCase()));
    const pool = onChainUsd.length > 0 ? onChainUsd : onChain.length > 0 ? onChain : pairs;
    return pairsToTokenInfo(pool);
  } catch {
    return null;
  }
}

/** Get current price for a token by symbol + chain */
export async function getLivePrice(symbol: string, chain: string): Promise<number | null> {
  const info = await searchBySymbol(symbol, chain);
  return info ? info.price : null;
}

/** Get live price directly by pair address — faster + works for new pairs not yet indexed by symbol */
export async function getPriceByPair(chainId: string, pairAddress: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chainId}/${pairAddress}`);
    if (!res.ok) return null;
    const data = await res.json();
    const pairs: any[] = data.pairs ?? [];
    if (pairs.length === 0) return null;
    const p = pairs[0];
    return p.priceUsd ? parseFloat(p.priceUsd) : null;
  } catch {
    return null;
  }
}

// ─── GeckoTerminal OHLCV ─────────────────────────────────────────────────────

export type OHLCVResolution = "minute" | "hour" | "day";

export async function getOHLCV(
  pairAddress: string,
  chain: string,
  resolution: OHLCVResolution = "hour",
  limit = 200,
): Promise<Candle[]> {
  try {
    const network = GECKO_NET[chain] ?? "solana";
    const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pairAddress}/ohlcv/${resolution}?limit=${limit}&currency=usd`;
    const res = await fetch(url, { headers: { Accept: "application/json;version=20230302" } });
    if (!res.ok) return [];
    const data = await res.json();
    const list: number[][] = data.data?.attributes?.ohlcv_list ?? [];
    // GeckoTerminal returns newest-first — reverse for lightweight-charts
    return list
      .map(([time, open, high, low, close]) => ({
        time: time as UTCTimestamp,
        open, high, low, close,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number))
      .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time);
  } catch {
    return [];
  }
}

// ─── DexScreener Trending (token boosts) ─────────────────────────────────────

/** Fetch top trending tokens from DexScreener boost rankings */
export async function fetchTrending(limit = 20): Promise<TokenInfo[]> {
  try {
    const boostRes = await fetch("https://api.dexscreener.com/token-boosts/top/v1");
    if (!boostRes.ok) return [];
    const boosts: Array<{ chainId: string; tokenAddress: string; totalAmount: number }> = await boostRes.json();
    const top = boosts.slice(0, limit);
    if (top.length === 0) return [];

    // Batch fetch pair data for all addresses in one call
    const addresses = top.map(b => b.tokenAddress).join(",");
    const pairsRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addresses}`);
    if (!pairsRes.ok) return [];
    const pairsData = await pairsRes.json();
    const allPairs: any[] = pairsData.pairs ?? [];

    const results: TokenInfo[] = [];
    for (const boost of top) {
      const addr = boost.tokenAddress.toLowerCase();
      const tokenPairs = allPairs.filter(p => p.baseToken?.address?.toLowerCase() === addr);
      const info = pairsToTokenInfo(tokenPairs);
      if (info) results.push(info);
    }
    return results;
  } catch {
    return [];
  }
}

/** Pick sensible resolution + limit for a given chart timeframe */
export function resolutionForTf(tf: string): { resolution: OHLCVResolution; limit: number } {
  switch (tf) {
    case "1m":  return { resolution: "minute", limit: 60  };  // 60 1m candles = 1h
    case "5m":  return { resolution: "minute", limit: 120 };  // 2h of 1m candles
    case "15m": return { resolution: "minute", limit: 200 };  // 3.3h
    case "1h":  return { resolution: "hour",   limit: 96  };  // 4 days
    case "4h":  return { resolution: "hour",   limit: 168 };  // 7 days
    case "12h": return { resolution: "hour",   limit: 200 };  // ~8 days
    case "24h": return { resolution: "day",    limit: 90  };  // 90 days
    default:    return { resolution: "hour",   limit: 168 };
  }
}
