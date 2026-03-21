const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("token") : null;
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export type User = {
  id: string;
  username: string;
  balance_usd: string;
  paper_balance_usd: string;
  created_at?: string;
  tier?: "" | "normal" | "top";
};

export type ReferralStats = {
  code: string;
  link: string;
  tier: "normal" | "top";
  referral_rate: number;
  cashback_rate: number;
  referred_count: number;
  total_referral_usd: string;
  total_cashback_usd: string;
  claimable_usd: string;
  recent_rewards: { reward_usd: string; created_at: string; referred_username: string }[];
};

export type AuthResponse = { token: string; user: User };

export type Position = {
  id: string;
  user_id: string;
  market_id: string;
  side: "long" | "short";
  amount_usd: string;
  placed_at: string;
  is_paper: boolean;
  // joined from markets
  symbol: string;
  timeframe: string;
  market_status: "open" | "live" | "resolved" | "cancelled";
  winner_side: "long" | "short" | null;
  entry_price: string;
  exit_price: string | null;
  closes_at: string;
  long_pool: string;
  short_pool: string;
  opener_id: string;
};

export type PortfolioResponse = {
  balance: string;
  positions: Position[];
};

export type WithdrawResponse = {
  withdrawal: object;
  new_balance: string;
  note: string;
};

export type LeaderboardEntry = {
  username: string;
  total_bets: number;
  wins: number;
  pnl: string;
  volume: string;
};

export type Market = {
  id: string;
  symbol: string;
  chain: string;
  timeframe: string;
  entry_price: string;
  tagline: string;
  long_pool: string;
  short_pool: string;
  status: "open" | "resolved" | "cancelled";
  closes_at: string;
  opener_id: string;
  created_at: string;
  exit_price?: string | null;
  winner_side?: "long" | "short" | null;
  is_paper: boolean;
};

export const api = {
  register: (username: string, password: string, email?: string) =>
    req<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, email: email || undefined }),
    }),

  login: (username: string, password: string) =>
    req<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  me: () => req<User>("/auth/me"),

  paperCredit: (amount: number) =>
    req<{ paper_balance_usd: string }>("/auth/paper-credit", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  depositAddress: () =>
    req<{ evm: { address: string; chain: string; token: string; note: string }; sol: { address: string; chain: string; token: string; note: string } }>("/deposit/address"),

  confirmDeposit: (tx_hash: string, chain: "base" | "sol") =>
    req<{ deposit: object; new_balance: string }>("/deposit/confirm", {
      method: "POST",
      body: JSON.stringify({ tx_hash, chain }),
    }),

  requestNonce: (address: string, chain: "base" | "sol") =>
    req<{ nonce: string; message: string }>("/deposit/nonce", {
      method: "POST",
      body: JSON.stringify({ address, chain }),
    }),

  initiateDeposit: (from_address: string, chain: "base" | "sol", signature: string) =>
    req<{ intent_id: string; treasury: string; from_address: string; chain: string; expires_at: string; note: string }>("/deposit/initiate", {
      method: "POST",
      body: JSON.stringify({ from_address, chain, signature }),
    }),

  depositStatus: (intent_id: string) =>
    req<{ status: "pending" | "fulfilled" | "expired"; credited_amount?: string; new_balance?: string; expires_at?: string }>(`/deposit/status/${intent_id}`),

  depositHistory: () =>
    req<object[]>("/deposit/history"),

  portfolio: () =>
    req<PortfolioResponse>("/portfolio"),

  withdraw: (amount: number, chain: string, to_address: string) =>
    req<WithdrawResponse>("/withdraw", {
      method: "POST",
      body: JSON.stringify({ amount, chain, to_address }),
    }),

  getReferral: () => req<ReferralStats>("/referral"),
  claimRewards: () => req<{ claimed_usd: string; new_balance: string }>("/referral/claim", { method: "POST", body: "{}" }),

  getMarkets: (timeframe?: string) =>
    req<Market[]>(`/markets${timeframe ? `?timeframe=${timeframe}` : ""}`),

  createMarket: (symbol: string, chain: string, timeframe: string, tagline: string, paper = false, ca?: string) =>
    req<Market>("/markets", {
      method: "POST",
      body: JSON.stringify({ symbol, chain, timeframe, tagline, paper, ca }),
    }),

  placeBet: (marketId: string, side: "long" | "short", amount: number, paper = false) =>
    req<{ position: object; new_balance: string; new_paper_balance: string }>(`/markets/${marketId}/bet`, {
      method: "POST",
      body: JSON.stringify({ side, amount, paper }),
    }),

  forgotPassword: (email?: string, username?: string) =>
    req<{ ok: true }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email, username }),
    }),

  resetPassword: (token: string, password: string) =>
    req<{ ok: true }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  leaderboard: (period: "week" | "month" | "all" = "week") =>
    req<LeaderboardEntry[]>(`/leaderboard?period=${period}`),

  linkTelegram: (token: string) =>
    req<{ ok: true }>("/auth/link-telegram", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  tgInitLink: () =>
    req<{ token: string }>("/auth/tg-init-link", { method: "POST", body: "{}" }),
};
