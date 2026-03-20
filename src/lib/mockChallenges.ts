export type Challenge = {
  id: string;
  user: string;
  symbol: string;
  chain: "SOL" | "ETH" | "BASE";
  timeframe: string;
  expiresIn: string;
  openedAt: number; // seconds ago
  entryPrice: number;
  shortPool: number;
  longPool: number;
  tagline: string;
  status?: "open" | "resolved" | "cancelled";
  exitPrice?: number | null;
  winnerSide?: "long" | "short" | null;
};

export const MOCK_CHALLENGES: Challenge[] = [
  { id: "1",  user: "0x7f…3a2", symbol: "WOJAK",   chain: "SOL",  timeframe: "1h",  expiresIn: "58m",     openedAt: 120,  entryPrice: 0.000842,   shortPool: 630,  longPool: 200,  tagline: "this thing is cooked" },
  { id: "2",  user: "degen.sol", symbol: "PEPE",    chain: "ETH",  timeframe: "5m",  expiresIn: "3m 12s",  openedAt: 310,  entryPrice: 0.00000912, shortPool: 80,   longPool: 310,  tagline: "fade me if you dare" },
  { id: "3",  user: "ape_lord",  symbol: "WIF",     chain: "SOL",  timeframe: "24h", expiresIn: "22h 55m", openedAt: 780,  entryPrice: 0.00891,    shortPool: 250,  longPool: 250,  tagline: "hat goes down. trust." },
  { id: "4",  user: "0xc1…9f4", symbol: "FWOG",    chain: "SOL",  timeframe: "12h", expiresIn: "11h 03m", openedAt: 1200, entryPrice: 0.0000089,  shortPool: 50,   longPool: 20,   tagline: "frog szn is over" },
  { id: "5",  user: "moon_bro",  symbol: "GIGA",    chain: "BASE", timeframe: "4h",  expiresIn: "3h 22m",  openedAt: 1800, entryPrice: 0.00000041, shortPool: 90,   longPool: 390,  tagline: "gigachad never dies" },
  { id: "6",  user: "0xb9…12c", symbol: "BONK",    chain: "SOL",  timeframe: "15m", expiresIn: "12m 30s", openedAt: 2400, entryPrice: 0.0000234,  shortPool: 75,   longPool: 75,   tagline: "take the other side" },
  { id: "7",  user: "sol_maxi",  symbol: "MOODENG", chain: "SOL",  timeframe: "1h",  expiresIn: "51h 48m", openedAt: 3000, entryPrice: 0.000156,   shortPool: 120,  longPool: 600,  tagline: "hippo to the moon 🌕" },
  { id: "8",  user: "0xf3…77a", symbol: "PNUT",    chain: "SOL",  timeframe: "24h", expiresIn: "22h 10m", openedAt: 3600, entryPrice: 0.00423,    shortPool: 1200, longPool: 340,  tagline: "squirrel is cooked. $1200 says so." },
  { id: "9",  user: "bear_gang", symbol: "CHAD",    chain: "SOL",  timeframe: "12h", expiresIn: "10h 15m", openedAt: 4200, entryPrice: 0.00312,    shortPool: 150,  longPool: 90,   tagline: "not so chad anymore" },
  { id: "10", user: "0x2d…88f", symbol: "GOAT",    chain: "BASE", timeframe: "4h",  expiresIn: "2h 01m",  openedAt: 5400, entryPrice: 0.00734,    shortPool: 200,  longPool: 820,  tagline: "greatest of all time. obviously." },
  { id: "11", user: "flip_god",  symbol: "PEPE",    chain: "ETH",  timeframe: "5m",  expiresIn: "4m 05s",  openedAt: 60,   entryPrice: 0.00000915, shortPool: 200,  longPool: 50,   tagline: "5m scalp. easy money." },
  { id: "12", user: "0xa8…f12", symbol: "BONK",    chain: "SOL",  timeframe: "15m", expiresIn: "11m 20s", openedAt: 480,  entryPrice: 0.0000231,  shortPool: 180,  longPool: 420,  tagline: "bonk szn is real" },
  { id: "13", user: "paperhand", symbol: "WIF",     chain: "SOL",  timeframe: "1h",  expiresIn: "44m",     openedAt: 900,  entryPrice: 0.00888,    shortPool: 300,  longPool: 100,  tagline: "hat off." },
];

export function formatAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function formatPrice(price: number): string {
  if (price < 0.000001) return price.toExponential(3);
  if (price < 0.001) return price.toFixed(7);
  if (price < 1) return price.toFixed(5);
  return price.toFixed(2);
}
