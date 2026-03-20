export type Coin = {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
  liquidity: number;
  age: string; // "2h", "14h", "3d"
  migrated: boolean;
  chain: "SOL" | "ETH" | "BASE" | "BSC";
  ca?: string; // contract address — set for CA-searched tokens, used for backend screening
};

export function formatPrice(price: number): string {
  if (price < 0.000001) return price.toExponential(3);
  if (price < 0.001) return price.toFixed(7);
  if (price < 1) return price.toFixed(5);
  return price.toFixed(2);
}

export function formatMarketCap(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}
