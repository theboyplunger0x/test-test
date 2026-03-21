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

function pairsToTokenInfo(pairs: any[]): TokenInfo | null {
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

/** Pick sensible resolution + limit for a given chart timeframe */
export function resolutionForTf(tf: string): { resolution: OHLCVResolution; limit: number } {
  switch (tf) {
    case "5m":  return { resolution: "minute", limit: 120 };  // 2h of 1m candles
    case "15m": return { resolution: "minute", limit: 200 };  // 3.3h
    case "1h":  return { resolution: "hour",   limit: 96  };  // 4 days
    case "4h":  return { resolution: "hour",   limit: 168 };  // 7 days
    case "12h": return { resolution: "hour",   limit: 200 };  // ~8 days
    case "24h": return { resolution: "day",    limit: 90  };  // 90 days
    default:    return { resolution: "hour",   limit: 168 };
  }
}
