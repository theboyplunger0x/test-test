export type MarketOption = {
  label: string;
  pct: number;
};

export type PMMarket = {
  id: string;
  question: string;
  category: string;
  type: "binary" | "multi";
  volume: number;        // USD
  closesAt: string;      // "Apr 30" etc
  options: MarketOption[];
  sparkline?: number[];  // yes% over time (binary only)
  featured?: boolean;
};

// Sparkline: last 10 data points of Yes% trend
function sp(...pts: number[]) { return pts; }

export const MOCK_MARKETS: PMMarket[] = [
  // ── HERO ──────────────────────────────────────────────────────────────────
  {
    id: "hero-1",
    question: "Will BTC reach $100k before June?",
    category: "BTC",
    type: "binary",
    volume: 4_200_000,
    closesAt: "Jun 1",
    featured: true,
    options: [{ label: "Yes", pct: 62 }, { label: "No", pct: 38 }],
    sparkline: sp(38, 41, 44, 49, 52, 55, 57, 59, 61, 62),
  },

  // ── BINARY ────────────────────────────────────────────────────────────────
  {
    id: "b-1",
    question: "Will ETH break $4k in Q2 2025?",
    category: "ETH",
    type: "binary",
    volume: 1_840_000,
    closesAt: "Jun 30",
    options: [{ label: "Yes", pct: 41 }, { label: "No", pct: 59 }],
    sparkline: sp(55, 52, 49, 50, 46, 44, 43, 42, 41, 41),
  },
  {
    id: "b-2",
    question: "Will Solana flip Ethereum market cap by EOY?",
    category: "SOL",
    type: "binary",
    volume: 920_000,
    closesAt: "Dec 31",
    options: [{ label: "Yes", pct: 18 }, { label: "No", pct: 82 }],
    sparkline: sp(22, 21, 20, 19, 18, 19, 18, 17, 18, 18),
  },
  {
    id: "b-3",
    question: "Will the SEC approve a spot SOL ETF in 2025?",
    category: "Regulation",
    type: "binary",
    volume: 2_100_000,
    closesAt: "Dec 31",
    options: [{ label: "Yes", pct: 73 }, { label: "No", pct: 27 }],
    sparkline: sp(55, 58, 62, 65, 67, 69, 71, 72, 73, 73),
  },
  {
    id: "b-4",
    question: "Will DOGE reach $1 before 2026?",
    category: "Memes",
    type: "binary",
    volume: 680_000,
    closesAt: "Dec 31",
    options: [{ label: "Yes", pct: 29 }, { label: "No", pct: 71 }],
    sparkline: sp(24, 25, 27, 28, 29, 30, 28, 29, 29, 29),
  },
  {
    id: "b-5",
    question: "Will Ethereum switch to a deflationary supply in Q2?",
    category: "ETH",
    type: "binary",
    volume: 430_000,
    closesAt: "Jun 30",
    options: [{ label: "Yes", pct: 54 }, { label: "No", pct: 46 }],
    sparkline: sp(48, 49, 51, 52, 53, 54, 53, 54, 54, 54),
  },
  {
    id: "b-6",
    question: "Will XRP hit $5 before May?",
    category: "XRP",
    type: "binary",
    volume: 760_000,
    closesAt: "May 1",
    options: [{ label: "Yes", pct: 35 }, { label: "No", pct: 65 }],
    sparkline: sp(42, 40, 38, 37, 36, 35, 35, 35, 35, 35),
  },
  {
    id: "b-7",
    question: "Will BTC dominance stay above 50% through Q2?",
    category: "BTC",
    type: "binary",
    volume: 1_100_000,
    closesAt: "Jun 30",
    options: [{ label: "Yes", pct: 67 }, { label: "No", pct: 33 }],
    sparkline: sp(60, 61, 63, 64, 65, 66, 67, 67, 67, 67),
  },
  {
    id: "b-8",
    question: "Will a crypto company join the S&P 500 in 2025?",
    category: "Macro",
    type: "binary",
    volume: 540_000,
    closesAt: "Dec 31",
    options: [{ label: "Yes", pct: 48 }, { label: "No", pct: 52 }],
    sparkline: sp(42, 43, 45, 46, 47, 48, 47, 48, 48, 48),
  },
  {
    id: "b-9",
    question: "Will Lightning Network surpass 10k BTC capacity?",
    category: "BTC",
    type: "binary",
    volume: 210_000,
    closesAt: "Dec 31",
    options: [{ label: "Yes", pct: 81 }, { label: "No", pct: 19 }],
    sparkline: sp(72, 74, 76, 78, 79, 80, 81, 81, 81, 81),
  },

  // ── MULTI-OUTCOME ─────────────────────────────────────────────────────────
  {
    id: "m-1",
    question: "Which L1 will have the highest TVL at end of Q2?",
    category: "DeFi",
    type: "multi",
    volume: 1_380_000,
    closesAt: "Jun 30",
    options: [
      { label: "Ethereum", pct: 51 },
      { label: "Solana",   pct: 28 },
      { label: "BNB Chain",pct: 13 },
      { label: "Other",    pct: 8 },
    ],
  },
  {
    id: "m-2",
    question: "Which DEX has most volume in April?",
    category: "DeFi",
    type: "multi",
    volume: 870_000,
    closesAt: "Apr 30",
    options: [
      { label: "Uniswap", pct: 44 },
      { label: "dYdX",    pct: 25 },
      { label: "Jupiter", pct: 21 },
      { label: "Curve",   pct: 10 },
    ],
  },
  {
    id: "m-3",
    question: "Which token pumps most in April?",
    category: "Memes",
    type: "multi",
    volume: 650_000,
    closesAt: "Apr 30",
    options: [
      { label: "PEPE",  pct: 38 },
      { label: "WIF",   pct: 27 },
      { label: "BONK",  pct: 22 },
      { label: "DOGE",  pct: 13 },
    ],
  },
  {
    id: "m-4",
    question: "Which L2 leads TVL at end of Q2?",
    category: "L2s",
    type: "multi",
    volume: 490_000,
    closesAt: "Jun 30",
    options: [
      { label: "Arbitrum", pct: 42 },
      { label: "Base",     pct: 35 },
      { label: "Optimism", pct: 15 },
      { label: "zkSync",   pct: 8 },
    ],
  },
  {
    id: "m-5",
    question: "Which chain has most new wallets in Q2?",
    category: "SOL",
    type: "multi",
    volume: 320_000,
    closesAt: "Jun 30",
    options: [
      { label: "Solana",   pct: 46 },
      { label: "Base",     pct: 30 },
      { label: "Ethereum", pct: 15 },
      { label: "Ton",      pct: 9 },
    ],
  },
];

export const CATEGORIES = ["All", "BTC", "ETH", "SOL", "DeFi", "L2s", "Memes", "XRP", "Regulation", "Macro"] as const;

export function formatVol(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}
