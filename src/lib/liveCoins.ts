// Curated meme coin list with static fallback data.
// Call fetchLiveCoins() to get real prices/mcaps from DexScreener.

import type { Coin } from "./mockData";
import { searchByCA } from "./chartData";

// Static config — exact contract address for precise DexScreener pair lookup
const COINS_CONFIG: { symbol: string; name: string; chain: Coin["chain"]; id: string; ca: string }[] = [
  { id: "pepe",    symbol: "PEPE",   name: "Pepe",           chain: "ETH", ca: "0x6982508145454ce325ddbe47a25d4ec3d2311933" },
  { id: "trump",   symbol: "TRUMP",  name: "Official Trump",  chain: "SOL", ca: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN" },
  { id: "bonk",    symbol: "BONK",   name: "Bonk",           chain: "SOL", ca: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { id: "pengu",   symbol: "PENGU",  name: "Pudgy Penguins",  chain: "SOL", ca: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv" },
  { id: "wif",     symbol: "WIF",    name: "dogwifhat",      chain: "SOL", ca: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { id: "fartcoin",symbol: "FARTCOIN",name: "Fartcoin",      chain: "SOL", ca: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump" },
];

// Fallback static data in case DexScreener is unavailable
export const STATIC_COINS: Coin[] = [
  { id: "pepe",    symbol: "PEPE",    name: "Pepe",           price: 0.00000912, change24h: 0, marketCap: 3_800_000_000, volume24h: 450_000_000, liquidity: 92_000_000, age: "3y", migrated: true, chain: "ETH" },
  { id: "trump",   symbol: "TRUMP",   name: "Official Trump",  price: 9.50,       change24h: 0, marketCap: 1_900_000_000, volume24h: 300_000_000, liquidity: 80_000_000, age: "3m", migrated: true, chain: "SOL" },
  { id: "bonk",    symbol: "BONK",    name: "Bonk",           price: 0.0000234,  change24h: 0, marketCap: 1_500_000_000, volume24h: 210_000_000, liquidity: 55_000_000, age: "2y", migrated: true, chain: "SOL" },
  { id: "pengu",   symbol: "PENGU",   name: "Pudgy Penguins",  price: 0.012,      change24h: 0, marketCap: 700_000_000,   volume24h: 90_000_000,  liquidity: 25_000_000, age: "1y", migrated: true, chain: "SOL" },
  { id: "wif",     symbol: "WIF",     name: "dogwifhat",      price: 0.80,       change24h: 0, marketCap: 800_000_000,   volume24h: 120_000_000, liquidity: 45_000_000, age: "1y", migrated: true, chain: "SOL" },
  { id: "fartcoin",symbol: "FARTCOIN",name: "Fartcoin",       price: 0.55,       change24h: 0, marketCap: 550_000_000,   volume24h: 75_000_000,  liquidity: 20_000_000, age: "4m", migrated: true, chain: "SOL" },
];

// Fetch live data from DexScreener using exact contract addresses
export async function fetchLiveCoins(
  onUpdate: (coins: Coin[]) => void
): Promise<void> {
  const results: Coin[] = [...STATIC_COINS]; // start with fallback

  for (let i = 0; i < COINS_CONFIG.length; i++) {
    const cfg = COINS_CONFIG[i];
    try {
      const info = await searchByCA(cfg.ca);
      if (info) {
        const idx = results.findIndex((c) => c.id === cfg.id);
        const coin: Coin = {
          id:        cfg.id,
          symbol:    cfg.symbol,
          name:      cfg.name,
          chain:     cfg.chain,
          price:     info.price,
          change24h: info.change24h,
          marketCap: info.marketCap,
          volume24h: info.volume24h,
          liquidity: info.liquidity,
          age:       STATIC_COINS.find((c) => c.id === cfg.id)?.age ?? "—",
          migrated:  true,
        };
        if (idx >= 0) results[idx] = coin;
        else results.push(coin);
        onUpdate([...results]); // progressive update as each coin loads
      }
    } catch {}
    // 400ms between each CA lookup to stay within DexScreener rate limits
    if (i < COINS_CONFIG.length - 1) await new Promise((r) => setTimeout(r, 400));
  }
}
