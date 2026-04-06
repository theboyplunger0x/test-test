const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("token") : null;
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const isEscrow = path.includes("/escrow");
  const timeout = setTimeout(() => controller.abort(), isEscrow ? 120_000 : 15_000);
  try {
    const headers: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> ?? {}),
    };
    // Only set Content-Type for requests with a body
    if (options.method !== "DELETE" || options.body) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers,
    });
    const data = await res.json();
    if (res.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("token");
    }
    if (!res.ok) throw new Error(data.error ?? "Request failed");
    return data as T;
  } catch (e: any) {
    if (e.name === "AbortError") throw new Error("Request timed out");
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export type User = {
  id: string;
  username: string;
  balance_usd: string;
  paper_balance_usd: string;
  testnet_balance_gen?: string;
  wallet_address?: string;
  created_at?: string;
  tier?: "" | "basic" | "pro" | "top" | "elite";
  x_username?: string;
  telegram_username?: string;
  avatar_url?: string;
  bio?: string;
};

export type ReferralStats = {
  code: string;
  link: string;
  tier: "" | "basic" | "pro" | "top" | "elite";
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
  message: string | null;
  sweep_id: string | null;
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
  avatar_url?: string | null;
  bio?: string | null;
  tier?: string;
  total_bets: number;
  wins: number;
  pnl: string;
  volume: string;
};

export type FollowStatus = {
  following: boolean;
  notify_trades: boolean;
};

export type AppNotification = {
  id: string;
  type: "market_resolved" | "new_follower" | "followed_big_trade" | "followed_trade" | "order_filled" | "order_expired";
  payload: Record<string, any>;
  read: boolean;
  created_at: string;
};

export type UserProfile = {
  username: string;
  avatar_url?: string;
  bio?: string;
  tier?: string;
  x_username?: string;
  telegram_username?: string;
  created_at: string;
  total_bets: number;
  wins: number;
  pnl: string;
  volume: string;
  follower_count?: number;
  following_count?: number;
  recent_trades: {
    side: "long" | "short";
    amount: string;
    placed_at: string;
    symbol: string;
    timeframe: string;
    status: string;
    winner_side: "long" | "short" | null;
    chain: string;
    is_paper: boolean;
    message?: string | null;
  }[];
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
  is_testnet?: boolean;
  sweep_id?: string | null;
  opener_username?: string;
  opener_avatar?: string;
  opener_tier?: string;
  last_bet_at?: string;
};

// ── Order Book types ──────────────────────────────────────────────────────────

export type Order = {
  id:               string;
  user_id:          string;
  symbol:           string;
  chain:            string;
  ca:               string | null;
  timeframe:        string;
  side:             "long" | "short";
  amount:           string;
  remaining_amount: string;
  reserved_amount:  string;
  status:           "pending" | "partially_filled" | "filled" | "cancelled" | "expired";
  is_paper:         boolean;
  auto_reopen:      boolean;
  expires_at:       string | null;
  tagline:          string;
  created_at:       string;
};

export type OrderBookSide = {
  total:  number;
  orders: {
    id:               string;
    username:         string;
    avatar_url:       string | null;
    tier:             string;
    remaining_amount: number;
    auto_reopen:      boolean;
    created_at:       string;
  }[];
};

export type OrderBookTimeframe = {
  timeframe:        string;
  short:            OrderBookSide;
  long:             OrderBookSide;
  long_multiplier:  number;   // multiplier if you GO LONG against existing short pool
  short_multiplier: number;   // multiplier if you GO SHORT against existing long pool
};

export type OrderBook = {
  symbol:     string;
  chain:      string | null;
  timeframes: Record<string, OrderBookTimeframe>;
};

export type SweepResult = {
  sweep_id:          string;
  market_id:         string;
  symbol:            string;
  timeframe:         string;
  closes_at:         string;
  requested_amount:  number;
  filled_amount:     number;
  unfilled_amount:   number;
  fills_count:       number;
  maker_pool:        number;
  taker_pool:        number;
  taker_multiplier:  number;
  maker_multiplier:  number;
  new_balance:       string;
  new_paper_balance: string;
  new_testnet_balance?: string;
};

export type CreateOrdersResult = {
  orders:            Order[];
  new_balance:       string;
  new_paper_balance: string;
  new_testnet_balance?: string;
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

  getXAuthUrl: () => req<{ url: string }>("/auth/x-auth-url"),

  disconnectX: () =>
    req<{ ok: boolean }>("/auth/disconnect-x", { method: "POST", body: "{}" }),

  disconnectTelegram: () =>
    req<{ ok: boolean }>("/auth/disconnect-telegram", { method: "POST", body: "{}" }),

  paperCredit: (amount: number) =>
    req<{ paper_balance_usd: string }>("/auth/paper-credit", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  testnetCredit: (amount: number) =>
    req<{ testnet_balance_gen: string }>("/auth/testnet-credit", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  linkWallet: (wallet_address: string) =>
    req<{ wallet_address: string }>("/auth/link-wallet", {
      method: "POST",
      body: JSON.stringify({ wallet_address }),
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

  getDebates: (paper = false) =>
    req<{ market: Market; shortCaller: { username: string; avatar_url: string | null; side: "short"; amount: string; message: string }; longCaller: { username: string; avatar_url: string | null; side: "long"; amount: string; message: string }; totalPool: number; ratio: number }[]>(`/markets/debates?paper=${paper}`),

  createMarket: (symbol: string, chain: string, timeframe: string, tagline: string, paper = false, ca?: string, testnet = false) =>
    req<Market>("/markets", {
      method: "POST",
      body: JSON.stringify({ symbol, chain, timeframe, tagline, paper, testnet, ca }),
    }),

  placeBet: (marketId: string, side: "long" | "short", amount: number, paper = false, message?: string, faded_position_id?: string) =>
    req<{ position: object; new_balance: string; new_paper_balance: string; new_testnet_balance?: string }>(`/markets/${marketId}/bet`, {
      method: "POST",
      body: JSON.stringify({ side, amount, paper, message, faded_position_id: faded_position_id || undefined }),
    }),

  getTokenFeed: (symbol: string) =>
    req<{ markets: any[]; positions: any[] }>(`/tokens/${symbol}/feed`),

  getMarketPositions: (marketId: string) =>
    req<any[]>(`/markets/${marketId}/positions`),

  getRecentPositions: (paper = false) =>
    req<{ id: string; side: "long" | "short"; amount: string; message: string | null; placed_at: string; is_paper: boolean; username: string; avatar_url: string | null; tier: string; market_id: string; symbol: string; chain: string; timeframe: string; status: string; winner_side: "long" | "short" | null; closes_at: string; is_opener: boolean }[]>(`/positions/recent?paper=${paper}`),

  getSymbolPositions: (symbol: string, paper = false) =>
    req<{ id: string; side: "long" | "short"; amount: string; message: string | null; placed_at: string; is_paper: boolean; username: string; avatar_url: string | null; tier: string; market_id: string; timeframe: string; status: string; winner_side: "long" | "short" | null; closes_at: string; is_opener: boolean }[]>(
      `/positions/symbol/${encodeURIComponent(symbol)}?paper=${paper}`
    ),

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

  leaderboard: (period: "week" | "month" | "all" = "week", paper = false) =>
    req<LeaderboardEntry[]>(`/leaderboard?period=${period}&paper=${paper}`),

  linkTelegram: (token: string) =>
    req<{ ok: true }>("/auth/link-telegram", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  tgInitLink: () =>
    req<{ token: string }>("/auth/tg-init-link", { method: "POST", body: "{}" }),

  getUserProfile: (username: string) =>
    req<UserProfile>(`/users/${encodeURIComponent(username)}`),

  updateProfile: (avatar_url: string, bio: string) =>
    req<User>("/auth/update-profile", {
      method: "POST",
      body: JSON.stringify({ avatar_url, bio }),
    }),

  // User search
  searchUsers: (q: string) =>
    req<{ username: string; avatar_url?: string; tier?: string }[]>(`/users/search?q=${encodeURIComponent(q)}`),

  // Follow system
  followUser: (username: string) =>
    req<FollowStatus>(`/users/${encodeURIComponent(username)}/follow`, { method: "POST", body: "{}" }),

  unfollowUser: (username: string) =>
    req<{ following: boolean }>(`/users/${encodeURIComponent(username)}/follow`, { method: "DELETE" }),

  setNotifyTrades: (username: string, notify_trades: boolean) =>
    req<{ notify_trades: boolean }>(`/users/${encodeURIComponent(username)}/follow`, {
      method: "PATCH",
      body: JSON.stringify({ notify_trades }),
    }),

  getFollowingList: () =>
    req<string[]>("/users/following/list"),

  getUserFollowers: (username: string) =>
    req<{ username: string; avatar_url?: string | null; tier?: string }[]>(`/users/${encodeURIComponent(username)}/followers`),

  getUserFollowing: (username: string) =>
    req<{ username: string; avatar_url?: string | null; tier?: string }[]>(`/users/${encodeURIComponent(username)}/following`),

  getFollowStatus: (username: string) =>
    req<FollowStatus>(`/users/${encodeURIComponent(username)}/follow-status`),

  // Notifications
  getNotifications: () => req<AppNotification[]>("/notifications"),
  getUnreadCount: () => req<{ unread: number }>("/notifications/count"),
  markAllRead: () => req<{ ok: boolean }>("/notifications/read-all", { method: "POST", body: "{}" }),
  markNotificationsRead: (ids: string[]) =>
    req<{ ok: boolean }>("/notifications/read", { method: "POST", body: JSON.stringify({ ids }) }),

  // ── Order Book ──────────────────────────────────────────────────────────────

  getOrderBook: (symbol: string, chain?: string, paper = false) =>
    req<OrderBook>(`/orders/book?symbol=${encodeURIComponent(symbol)}${chain ? `&chain=${encodeURIComponent(chain)}` : ""}&paper=${paper}`),

  getMyOrders: (history = false) =>
    req<Order[]>(`/orders/mine${history ? "?history=1" : ""}`),

  createOrders: (orders: {
    symbol: string; chain: string; ca?: string; timeframe: string;
    side: "long" | "short"; amount: number; is_paper?: boolean; is_testnet?: boolean;
    auto_reopen?: boolean; expires_at?: string; tagline?: string;
  }[]) =>
    req<CreateOrdersResult>("/orders", {
      method: "POST",
      body: JSON.stringify(orders.length === 1 ? orders[0] : orders),
    }),

  cancelOrder: (id: string) =>
    req<{ ok: boolean; refunded: string; new_balance: string; new_paper_balance: string }>(
      `/orders/${id}`, { method: "DELETE" }
    ),

  setOrderAutoReopen: (id: string, auto_reopen: boolean) =>
    req<{ ok: boolean; auto_reopen: boolean }>(`/orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ auto_reopen }),
    }),

  sweep: (params: {
    symbol: string; chain: string; timeframe: string;
    side: "long" | "short"; amount: number; is_paper?: boolean; is_testnet?: boolean;
  }) =>
    req<SweepResult>("/orders/sweep", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // ── On-chain Escrow (testnet) ──────────────────────────────────────────────

  getEscrowBets: () =>
    req<EscrowBet[]>("/escrow"),

  getEscrowState: (address: string) =>
    req<Record<string, unknown>>(`/escrow/${address}`),

  createEscrowBet: (params: {
    symbol: string; chain: string; timeframe: string;
    side: "long" | "short"; amount: number; ca: string; tagline?: string;
  }) =>
    req<{ contract_address: string; deploy_hash: string; entry_price: string; symbol: string; timeframe: string; side: string; deposit_a: number }>(
      "/escrow/create", { method: "POST", body: JSON.stringify(params) }
    ),

  takeEscrowBet: (address: string, amount: number) =>
    req<{ tx_hash: string; status: string }>(
      `/escrow/${address}/take`, { method: "POST", body: JSON.stringify({ amount }) }
    ),

  resolveEscrowBet: (address: string) =>
    req<{ exitPrice: string; winner: string; winnerSide: string; status: string }>(
      `/escrow/${address}/resolve`, { method: "POST" }
    ),

  cancelEscrowBet: (address: string) =>
    req<{ tx_hash: string; status: string }>(
      `/escrow/${address}/cancel`, { method: "POST" }
    ),
};

export type EscrowBet = {
  id: string;
  contract_address: string;
  deploy_hash: string;
  symbol: string;
  chain: string;
  ca: string;
  timeframe: string;
  entry_price: string;
  exit_price?: string;
  side_a: "long" | "short";
  party_a_id: string;
  party_a_wallet: string;
  party_a_username?: string;
  party_b_id?: string;
  party_b_wallet?: string;
  party_b_username?: string;
  deposit_a: string;
  deposit_b?: string;
  winner_wallet?: string;
  winner_side?: string;
  tagline: string;
  status: "waiting" | "active" | "resolved" | "cancelled";
  created_at: string;
};
