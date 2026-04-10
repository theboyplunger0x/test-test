"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Challenge, formatAgo, formatPrice } from "@/lib/mockChallenges";
import { Coin, formatMarketCap } from "@/lib/mockData";
import { STATIC_COINS, fetchLiveCoins } from "@/lib/liveCoins";
import LiveTicker from "./LiveTicker";
import OrdersView from "./OrdersView";
import CoinDetail from "./CoinDetail";
import AuthModal from "./AuthModal";
import DepositModal from "./DepositModal";
import TradeModal from "@/trading/TradeModal";
import SearchModal from "./SearchModal";
import ReferralModal from "./ReferralModal";
import LeaderboardView from "./LeaderboardView";
import ProfileModal from "./ProfileModal";
import ProfilePage from "./ProfilePage";
import NotificationsPanel from "./NotificationsPanel";
import TokenProfilePage from "./TokenProfilePage";
import ChartModal from "./ChartModal";
import SpotView from "./SpotView";
import CallCard, { type Call } from "./CallCard";
import DebateCard, { type Debate } from "./DebateCard";
import { api, User, AuthResponse, Market } from "@/lib/api";
import { useTradingMode } from "@/hooks/useTradingMode";
import { usePrivyWallet } from "@/hooks/usePrivyWallet";
import { useAppTheme } from "@/hooks/useAppTheme";
import BottomNav from "@/shell/BottomNav";
import TradingModeToggle from "@/shell/TradingModeToggle";
import BalanceSummary from "@/shell/BalanceSummary";
import FundingCTA from "@/shell/FundingCTA";
import HeaderSearch from "@/shell/HeaderSearch";
import AccountDrawer from "@/account/AccountDrawer";
import ConnectWalletModal, { type ConnectWalletMode } from "@/account/ConnectWalletModal";
import FollowingScreen from "@/screens/FollowingScreen";
import DiscoverScreen from "@/screens/DiscoverScreen";
import MarketsScreen from "@/screens/MarketsScreen";
import type { TokenInfo } from "@/lib/chartData";
import { fetchTrending } from "@/lib/chartData";

import type { MainTab } from "@/lib/navTypes";
type Filter = "all" | "hot" | "juicy";
type Theme = "dark" | "light";

const QUICK_AMOUNTS = [10, 25, 50, 100];
const FEE = 0.05;
const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "24h"];
const TF_ICONS: Record<string, string> = {
  "1m":  "·",
  "5m":  "≡",
  "15m": "◌",
  "1h":  "◔",
  "4h":  "◑",
  "24h": "↗",
};

function multiplier(myPool: number, otherPool: number): number {
  if (myPool === 0) return 0;
  return 1 + (otherPool * (1 - FEE)) / myPool;
}

function formatMsLeft(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (ms < 60_000)          return `${s}s`;
  if (ms < 60 * 60_000)     return `${m}m`;
  if (d > 0)                return `${d}d`;
  return `${h}h`;
}

function marketToChallenge(m: Market): Challenge {
  const closesAtMs = new Date(m.closes_at).getTime();
  const msLeft = Math.max(0, closesAtMs - Date.now());
  const openedSecsAgo = Math.floor((Date.now() - new Date(m.created_at).getTime()) / 1000);
  return {
    id: m.id,
    closesAt:  closesAtMs,
    lastBetAt: m.last_bet_at ? new Date(m.last_bet_at).getTime() : undefined,
    user: m.opener_username ?? m.opener_id.slice(0, 8) + "…",
    openerUsername: m.opener_username,
    openerAvatar: m.opener_avatar,
    openerTier: m.opener_tier,
    symbol: m.symbol,
    chain: m.chain.toUpperCase() as "SOL" | "ETH" | "BASE",
    timeframe: m.timeframe,
    expiresIn: formatMsLeft(msLeft),
    openedAt: openedSecsAgo,
    entryPrice: parseFloat(m.entry_price),
    shortPool: parseFloat(m.short_pool),
    longPool: parseFloat(m.long_pool),
    tagline: m.tagline,
    status: m.status,
    exitPrice: m.exit_price ? parseFloat(m.exit_price) : null,
    winnerSide: m.winner_side ?? null,
  };
}

function tierBadge(tier?: string, telegramUsername?: string) {
  const S = "M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.266.14-1.897-.131-.63-.437-1.208-.882-1.671-.445-.464-1.011-.79-1.638-.944-.627-.155-1.284-.127-1.895.082-.274-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.61-.209-1.265-.237-1.892-.082-.627.155-1.193.48-1.639.944-.445.463-.749 1.04-.878 1.671-.13.63-.083 1.29.141 1.897-.587.274-1.086.706-1.44 1.246-.354.54-.551 1.17-.569 1.816.018.647.215 1.276.57 1.817.354.54.852.972 1.438 1.245-.224.607-.27 1.266-.14 1.897.13.63.436 1.208.882 1.671.445.464 1.011.79 1.638.944.627.155 1.284.127 1.895-.082.274.587.704 1.086 1.245 1.44.54.354 1.17.551 1.816.569.647-.016 1.275-.213 1.815-.567s.969-.854 1.24-1.44c.61.21 1.266.238 1.893.083.626-.155 1.192-.48 1.637-.944.445-.463.749-1.041.879-1.672.13-.63.083-1.29-.141-1.896.587-.274 1.086-.706 1.44-1.246.354-.54.551-1.17.569-1.816z";
  const C = "M9.611 12.851L7.29 10.53l-.927.948 3.248 3.2 6.912-6.83-.95-.943-5.962 5.946z";
  const tip = (label: string) => (
    <span className="pointer-events-none absolute left-full ml-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/90 px-2 py-1 text-[10px] font-bold text-white opacity-0 group-hover/badge:opacity-100 transition-opacity duration-150 z-50">
      {label}
    </span>
  );
  if (tier === "elite") return (
    <span className="relative group/badge inline-flex items-center shrink-0">
      <svg width="17" height="17" viewBox="0 0 22 22" fill="none" className="inline-block align-middle"><path d={S} fill="#27272A"/><path d={C} fill="white"/></svg>
      {tip("Not for everyone.")}
    </span>
  );
  if (tier === "top") return (
    <span className="relative group/badge inline-flex items-center shrink-0">
      <svg width="17" height="17" viewBox="0 0 22 22" fill="none" className="inline-block align-middle"><path d={S} fill="#F4C43B"/><path d={C} fill="white"/></svg>
      {tip("Top · 20% fee rebate")}
    </span>
  );
  if (tier === "pro" || tier === "normal") return (
    <span className="relative group/badge inline-flex items-center shrink-0">
      <svg width="17" height="17" viewBox="0 0 22 22" fill="none" className="inline-block align-middle"><path d={S} fill="#1D9BF0"/><path d={C} fill="white"/></svg>
      {tip("Pro · 10% fee rebate")}
    </span>
  );
  if ((tier === "basic" || tier === "") && telegramUsername) return (
    <span className="relative group/badge inline-flex items-center shrink-0">
      <svg width="17" height="17" viewBox="0 0 22 22" fill="none" className="inline-block align-middle"><path d={S} fill="#6B7280"/><path d={C} fill="white"/></svg>
      {tip("Basic · Telegram connected")}
    </span>
  );
  return null;
}

export default function FeedPage() {
  const wallet = usePrivyWallet({ autoDetect: true });
  const { walletAddr, setWalletAddr, genBalance, privyAuthenticated } = wallet;
  const [markets, setMarkets]           = useState<Market[]>([]);
  const [shakingIds, setShakingIds]     = useState<Set<string>>(new Set());
  const prevLastBetAt                   = useRef<Record<string, number>>({});
  const [filter, setFilter]             = useState<Filter>("all");
  const [statusFilter, setStatusFilter] = useState<"open" | "closed">("open");
  const [mainTab, setMainTab]           = useState<MainTab>(() => {
    if (typeof window === "undefined") return "calls";
    const saved = localStorage.getItem("fud_tab") as MainTab;
    return saved === "chart" ? "markets" : saved || "markets";
  });
  useEffect(() => { localStorage.setItem("fud_tab", mainTab); }, [mainTab]);
  const [calls, setCalls]               = useState<Call[]>([]);
  const [callsLoading, setCallsLoading] = useState(false);
  const [debates, setDebates]           = useState<Debate[]>([]);
  const [callsFilter, setCallsFilter]   = useState<"fresh" | "debates">("fresh");
  const [ordersOpen, setOrdersOpen]     = useState(false);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol]   = useState<string | null>(null);
  const [selectedTf, setSelectedTf]     = useState<string>("1h");
  const { theme, setTheme, dk } = useAppTheme();
  const [tapeOpen, setTapeOpen]         = useState(false);
  const [user, setUser]                 = useState<User | null>(null);
  const [authOpen, setAuthOpen]         = useState(false);
  const [depositOpen, setDepositOpen]   = useState(false);
  const [openMarketCoin, setOpenMarketCoin] = useState<Coin | null>(null);
  const [caSearchOpen, setCASearchOpen]     = useState(false);
  const [referralOpen, setReferralOpen]     = useState(false);
  const [tradePresets, setTradePresets]     = useState([5, 25, 100, 500]);
  const [selectedTokenInfo, setSelectedTokenInfo] = useState<TokenInfo | null>(null);
  const [tokenProfileToken, setTokenProfileToken] = useState<TokenInfo | null>(null);
  const [marketCapMax, setMarketCapMax]     = useState<number | null>(null);
  const [minPool, setMinPool]               = useState<number | null>(null);
  const [poolSortDir, setPoolSortDir]       = useState<"asc" | "desc" | null>(null);
  const [trendingTokens, setTrendingTokens] = useState<TokenInfo[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [trendingChain, setTrendingChain] = useState<string | null>(null);
  const [trendingSort, setTrendingSort]   = useState<"mcap-desc" | "mcap-asc" | "vol-desc" | "vol-asc" | null>(null);
  const [livePrices, setLivePrices]         = useState<Record<string, number>>({});
  const { tradingMode, setTradingMode, paperMode, isTestnet, isReal } = useTradingMode();
  const setPaperMode = (v: boolean) => setTradingMode(v ? "paper" : "real");
  const [followingList, setFollowingList]   = useState<string[]>([]);

  // Wallet state & effects managed inside usePrivyWallet hook.
  const [liveCoins, setLiveCoins]           = useState<Coin[]>(STATIC_COINS);
  const [paperCreditOpen, setPaperCreditOpen] = useState(false);
  const [paperCreditAmt, setPaperCreditAmt]   = useState("100");
  const [paperCreditLoading, setPaperCreditLoading] = useState(false);
  const [connectWalletOpen, setConnectWalletOpen]   = useState(false);
  // Mode for ConnectWalletModal: "reconnect" if user has linked a wallet before
  // (server-side flag), "add" otherwise. Drives the modal copy and primary CTA.
  const connectWalletMode: ConnectWalletMode = user?.has_connected_wallet ? "reconnect" : "add";
  // When the user picks an option in the ConnectWalletModal, we want to chain
  // straight into the fund flow once the wallet shows up. This flag bridges
  // the two async steps (connect → walletAddr arrives → fund).
  const [pendingFundAfterConnect, setPendingFundAfterConnect] = useState(false);
  // Tracks whether the inline onboarding banner for Real/Testnet has been
  // dismissed. Persisted across sessions via localStorage. Initial state must
  // be `true` (hidden) on both server and client to avoid SSR hydration
  // mismatches; the real value is hydrated in the effect below.
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(true);
  useEffect(() => {
    if (localStorage.getItem("fud_seen_real_onboarding") !== "1") {
      setOnboardingDismissed(false);
    }
  }, []);
  const [settingsOpen, setSettingsOpen]             = useState(false);
  const [profileUser, setProfileUser]               = useState<string | null>(null);
  const [tokenModalInfo, setTokenModalInfo]         = useState<TokenInfo | null>(null);
  const [chartModalInfo, setChartModalInfo]         = useState<TokenInfo | null>(null);
  const [profilePageUser, setProfilePageUser]       = useState<string | null>(null);
  const [notifPanelOpen, setNotifPanelOpen]         = useState(false);
  const [unreadCount, setUnreadCount]               = useState(0);
  const [xInput, setXInput]                         = useState("");
  const [xSaving, setXSaving]                       = useState(false);
  const [xMsg, setXMsg]                             = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("notificationsEnabled") === "true";
  });

  async function toggleNotifications() {
    if (!notificationsEnabled) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return;
      setNotificationsEnabled(true);
      localStorage.setItem("notificationsEnabled", "true");
    } else {
      setNotificationsEnabled(false);
      localStorage.setItem("notificationsEnabled", "false");
    }
  }

  // Restore session + listen for Google OAuth callback setting token in same tab
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      api.me().then(setUser).catch(() => localStorage.removeItem("token"));
      api.getFollowingList().then(setFollowingList).catch(() => {});
    }

    function onStorage(e: StorageEvent) {
      if (e.key === "token" && e.newValue) {
        api.me().then(setUser).catch(() => {});
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Handle ?tg_link= param: link Telegram account after login
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tgToken = params.get("tg_link");
    if (!tgToken) return;
    // Clean URL immediately
    window.history.replaceState({}, "", window.location.pathname);
    const jwt = localStorage.getItem("token");
    if (jwt) {
      api.linkTelegram(tgToken)
        .then(() => alert("✅ Telegram vinculado a tu cuenta!"))
        .catch((e: any) => alert("❌ " + (e.message ?? "Error al vincular Telegram")));
    } else {
      localStorage.setItem("pending_tg_link", tgToken);
      setAuthOpen(true);
    }
  }, []);

  // After login, complete pending Telegram link
  useEffect(() => {
    if (!user) return;
    const tgToken = localStorage.getItem("pending_tg_link");
    if (!tgToken) return;
    localStorage.removeItem("pending_tg_link");
    api.linkTelegram(tgToken)
      .then(() => alert("✅ Telegram vinculado a tu cuenta!"))
      .catch((e: any) => alert("❌ " + (e.message ?? "Error al vincular Telegram")));
  }, [user]);

  // After return from X OAuth — pick up connected username
  useEffect(() => {
    if (!user) return;
    const xUsername = localStorage.getItem("x_username_connected");
    if (!xUsername) return;
    localStorage.removeItem("x_username_connected");
    setUser(u => u ? { ...u, x_username: xUsername } : null);
  }, [user]);

  // Mirror the server-side `has_connected_wallet` flag locally as soon as a
  // wallet is linked in this session, so the ConnectWalletModal flips from
  // "Add a wallet" to "Reconnect" without needing a /auth/me refetch.
  // Deps narrowed to the only field that matters — avoids re-runs on every
  // unrelated `user` mutation (balance updates, x_username, etc.).
  useEffect(() => {
    if (walletAddr && user && !user.has_connected_wallet) {
      setUser(u => u ? { ...u, has_connected_wallet: true } : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddr, user?.has_connected_wallet]);

  // Post-action chaining: once the wallet appears after a connect triggered
  // from ConnectWalletModal, automatically open the fund flow so the user
  // doesn't have to click Deposit a second time.
  // Gated on `!paperMode` so that switching modes mid-flow can't accidentally
  // pop a real fund modal once the wallet shows up.
  useEffect(() => {
    if (pendingFundAfterConnect && walletAddr && !paperMode) {
      setPendingFundAfterConnect(false);
      wallet.fund();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFundAfterConnect, walletAddr, paperMode]);

  // Safety net: if the user abandons the connect flow (closes Privy modal,
  // rejects MetaMask, etc.), clear the pending flag after 5 min so a later
  // unrelated connect doesn't accidentally trigger a fund.
  useEffect(() => {
    if (!pendingFundAfterConnect) return;
    const t = setTimeout(() => setPendingFundAfterConnect(false), 5 * 60 * 1000);
    return () => clearTimeout(t);
  }, [pendingFundAfterConnect]);

  // Clear stale pending intent whenever the trading mode changes — switching
  // modes invalidates the original intent ("I clicked Deposit in Real").
  useEffect(() => {
    setPendingFundAfterConnect(false);
  }, [tradingMode]);

  // Poll unread notification count every 60s
  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    const fetch = () => api.getUnreadCount().then(r => setUnreadCount(r.unread)).catch(() => {});
    fetch();
    const iv = setInterval(fetch, 60_000);
    return () => clearInterval(iv);
  }, [user]);

  // Fetch markets + poll every 30s; also refresh user balance to capture payouts
  useEffect(() => {
    async function fetchMarketsAndBalance() {
      try {
        const fresh = (await api.getMarkets()).filter(m => m && m.symbol && m.chain);
        // Detect which markets got a new bet since last fetch
        const newShaking = new Set<string>();
        for (const m of fresh) {
          if (!m.last_bet_at) continue;
          const ts = new Date(m.last_bet_at).getTime();
          if (prevLastBetAt.current[m.id] && ts > prevLastBetAt.current[m.id]) {
            newShaking.add(m.id);
          }
          prevLastBetAt.current[m.id] = ts;
        }
        if (newShaking.size > 0) {
          setShakingIds(newShaking);
          setTimeout(() => setShakingIds(new Set()), 700);
        }
        setMarkets(fresh);
      } catch {}
      // Refresh balance so settled-market payouts show up immediately
      if (typeof window !== "undefined" && localStorage.getItem("token")) {
        try { const fresh = await api.me(); setUser(fresh); } catch {}
      }
    }
    fetchMarketsAndBalance();
    const i = setInterval(fetchMarketsAndBalance, 30_000);
    return () => clearInterval(i);
  }, []);

  // Fetch recent calls + debates — refresh every 30s
  useEffect(() => {
    if (mainTab !== "calls" && mainTab !== "markets" && mainTab !== "following") return;
    let cancelled = false;
    async function load(initial = false) {
      if (initial) setCallsLoading(true);
      try {
        const [callsData, debatesData] = await Promise.all([
          api.getRecentPositions(paperMode),
          api.getDebates(paperMode).catch(() => []),
        ]);
        if (!cancelled) {
          setCalls(callsData as unknown as Call[]);
          setDebates(debatesData as Debate[]);
        }
      } catch {}
      if (initial && !cancelled) setCallsLoading(false);
    }
    load(true);
    const iv = setInterval(() => load(false), 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [mainTab, paperMode]);

  // Fetch live coin data from DexScreener (price, mcap, 24h change) — refresh every 5 min
  useEffect(() => {
    fetchLiveCoins(setLiveCoins);
    const i = setInterval(() => fetchLiveCoins(setLiveCoins), 5 * 60_000);
    return () => clearInterval(i);
  }, []);

  // Fetch trending tokens when Trending tab is active
  useEffect(() => {
    if (mainTab !== "trending") return;
    let cancelled = false;
    async function load(initial = false) {
      if (initial) setTrendingLoading(true);
      try {
        const tokens = await fetchTrending();
        if (!cancelled) setTrendingTokens(tokens);
      } finally {
        if (initial && !cancelled) setTrendingLoading(false);
      }
    }
    load(true);
    const i = setInterval(() => load(false), 60_000);
    return () => { cancelled = true; clearInterval(i); };
  }, [mainTab]);

  // Live price SSE stream — connects to backend /prices/live, updates every ~1.5s
  useEffect(() => {
    const openMarkets = markets.filter(m => m.status === "open" && new Date(m.closes_at).getTime() > Date.now());
    if (openMarkets.length === 0) return;

    // Deduplicate by symbol:chain
    const symbolSet = new Set(openMarkets.map(m => `${m.symbol.toUpperCase()}:${m.chain.toUpperCase()}`));
    const symbolsParam = Array.from(symbolSet).join(",");
    const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    const url  = `${BASE}/prices/live?symbols=${encodeURIComponent(symbolsParam)}`;

    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource(url);

      es.onmessage = (e) => {
        try {
          const data: Record<string, number> = JSON.parse(e.data);
          // data keys are "SYMBOL:CHAIN" — map to our "SYMBOL_CHAIN" key format
          setLivePrices(prev => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(data)) {
              const [sym, chain] = k.split(":");
              next[`${sym}_${chain}`] = v;
            }
            return next;
          });
        } catch {}
      };

      es.onerror = () => {
        es?.close();
        es = null;
        // Reconnect after 3s on error
        retryTimeout = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [markets.filter(m => m.status === "open").map(m => `${m.symbol}:${m.chain}`).sort().join(",")]); // re-connect when open market set changes

  function handleAuthSuccess(data: AuthResponse) {
    localStorage.setItem("token", data.token);
    setUser(data.user);
    setAuthOpen(false);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    setUser(null);
    wallet.logoutPrivy();
  }

  function handleDeposited(newBalance: string) {
    if (user) setUser({ ...user, balance_usd: newBalance });
  }

  function handleMarketCreated(market: Market) {
    setMarkets(prev => [market, ...prev]);
    setOpenMarketCoin(null);
    setMainTab("feed");
    setSelectedTf(market.timeframe);
  }

  function handleOpenMarket(coin: Coin) {
    if (!user) { setAuthOpen(true); return; }
    if (!paperMode && Number(user.balance_usd) <= 0) {
      setDepositOpen(true);
      return;
    }
    setOpenMarketCoin(coin);
  }

  async function handleAdd(id: string, side: "short" | "long", amount: number, message?: string, faded_position_id?: string): Promise<string | null> {
    if (!user) { setAuthOpen(true); return null; }
    // Mock challenges have simple numeric IDs; real markets have UUIDs
    const isRealMarket = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isRealMarket) return "Demo data — open a real market on any coin to trade.";
    try {
      const result = await api.placeBet(id, side, amount, paperMode, message, faded_position_id);
      setMarkets(prev => prev.map(m =>
        m.id === id ? {
          ...m,
          long_pool:  side === "long"  ? String(parseFloat(m.long_pool)  + amount) : m.long_pool,
          short_pool: side === "short" ? String(parseFloat(m.short_pool) + amount) : m.short_pool,
        } : m
      ));
      setUser(u => u ? {
        ...u,
        balance_usd:       result.new_balance,
        paper_balance_usd: result.new_paper_balance,
        ...(result.new_testnet_balance ? { testnet_balance_gen: result.new_testnet_balance } : {}),
      } : null);
      return null;
    } catch (err: any) {
      return err.message ?? "Bet failed";
    }
  }

  // Filter markets by mode
  const modeMarkets   = markets.filter(m => isTestnet ? !!m.is_testnet : !!m.is_paper === paperMode);
  const allChallenges = modeMarkets
    .map(marketToChallenge)
    .sort((a, b) => (b.lastBetAt ?? 0) - (a.lastBetAt ?? 0));

  // Open + non-expired markets for the current mode, sorted by recent bet activity.
  // Used by both the markets and sweep tabs (via MarketsScreen).
  const liveMarketsForView = markets
    .filter(m => m.status === "open" && !!m.is_paper === paperMode && new Date(m.closes_at).getTime() > Date.now())
    .sort((a, b) => new Date(b.last_bet_at ?? b.created_at).getTime() - new Date(a.last_bet_at ?? a.created_at).getTime());
  const tfFiltered    = allChallenges
    .filter(c => c.timeframe === selectedTf)
    .filter(c => statusFilter === "open" ? c.status === "open" : c.status !== "open");
  let filtered = tfFiltered.filter(c => {
    const total = c.shortPool + c.longPool;
    const ratio = Math.max(c.shortPool, c.longPool) / Math.min(c.shortPool || 1, c.longPool || 1);
    if (filter === "hot"   && total < 400) return false;
    if (filter === "juicy" && ratio < 3)   return false;
    if (minPool !== null   && total < minPool) return false;
    if (marketCapMax !== null) {
      const coin = liveCoins.find(co => co.symbol === c.symbol);
      if (coin && coin.marketCap > marketCapMax) return false;
    }
    return true;
  });
  if (poolSortDir === "asc")  filtered = [...filtered].sort((a, b) => (a.shortPool + a.longPool) - (b.shortPool + b.longPool));
  if (poolSortDir === "desc") filtered = [...filtered].sort((a, b) => (b.shortPool + b.longPool) - (a.shortPool + a.longPool));
  const trending = [...allChallenges].sort((a, b) => (b.longPool + b.shortPool) - (a.longPool + a.shortPool));

  const buildTokenInfo = (symbol: string, chain?: string): TokenInfo => {
    const rich = trendingTokens.find(tk => tk.symbol.toUpperCase() === symbol.toUpperCase());
    const coin = liveCoins.find(c => c.symbol.toUpperCase() === symbol.toUpperCase());
    return rich ?? {
      symbol: symbol.toUpperCase(),
      name: coin?.name ?? symbol,
      address: coin?.ca ?? "",
      chainId: (chain ?? coin?.chain ?? "SOL").toLowerCase(),
      chainLabel: chain ?? coin?.chain ?? "SOL",
      price: coin?.price ?? 0,
      change24h: coin?.change24h ?? 0,
      liquidity: coin?.liquidity ?? 0,
      volume24h: coin?.volume24h ?? 0,
      marketCap: coin?.marketCap ?? 0,
      pairAddress: "",
    };
  };

  const handleCoinClick = (symbol: string, chain?: string) => {
    // Open token modal popup instead of navigating away
    setTokenModalInfo(buildTokenInfo(symbol, chain));
  };

  function tokenInfoToCoin(t: TokenInfo): Coin {
    return {
      id: t.address, symbol: t.symbol, name: t.name, price: t.price,
      change24h: t.change24h, marketCap: t.marketCap, volume24h: t.volume24h,
      liquidity: t.liquidity, age: "—", migrated: true,
      chain: t.chainLabel as Coin["chain"], ca: t.address,
    };
  }

  function openMarketForToken(t: TokenInfo) {
    const coin = liveCoins.find(c => c.symbol === t.symbol);
    handleOpenMarket(coin ?? tokenInfoToCoin(t));
  }

  function handleCATradeResult(token: TokenInfo) {
    setSelectedTokenInfo(token);
    setTokenModalInfo(token);
    setSelectedCoin(null);
  }

  async function handleCAQuickTrade(token: TokenInfo, side: "long" | "short", timeframe: string, amount: number, message?: string): Promise<string | null> {
    if (!user) { setAuthOpen(true); return "Please log in first."; }
    if (!paperMode && !isTestnet && Number(user.balance_usd) < amount) return "Insufficient balance.";
    setSelectedTokenInfo(token);
    setSelectedCoin(token.symbol);
    const autoTagline = message?.trim() || `Will ${token.symbol} go ${side === "long" ? "UP" : "DOWN"} in ${timeframe}?`;
    let market = markets.find(m =>
      m.symbol.toUpperCase() === token.symbol.toUpperCase() &&
      m.timeframe === timeframe && m.status === "open" &&
      (m.is_paper === true) === paperMode &&
      new Date(m.closes_at).getTime() > Date.now()
    );
    if (!market) {
      try {
        const created = await api.createMarket(token.symbol, token.chainLabel, timeframe, autoTagline, paperMode && !isTestnet, token.address, isTestnet);
        if (!created) return "Failed to create market";
        market = created;
        setMarkets(prev => [created, ...prev]);
      } catch (err) {
        return err instanceof Error ? err.message : "Failed to create market";
      }
    }
    return handleAdd(market.id, side, amount);
  }

  const totalAtStake = allChallenges.reduce((s, c) => s + c.shortPool + c.longPool, 0);

  // Derive chain for selected coin (from CA search, open market, or mock data)
  const selectedChain: string =
    selectedTokenInfo?.chainLabel ??
    markets.find(m => m.symbol === selectedCoin)?.chain?.toUpperCase() ??
    liveCoins.find(c => c.symbol === selectedCoin)?.chain ??
    "SOL";

  const marketFilters: { key: Filter; label: string }[] = [
    { key: "all",   label: "All" },
    { key: "hot",   label: "🔥 Hot" },
    { key: "juicy", label: "🍋 Juicy" },
  ];
  const coinObj = selectedCoin ? liveCoins.find(c => c.symbol === selectedCoin) ?? null : null;

  // ── Theme tokens ──────────────────────────────
  const T = {
    root:           dk ? "bg-[#0c0c0c] text-white"             : "bg-gray-50 text-gray-900",
    topBorder:      dk ? "border-white/8"                       : "border-gray-100",
    badge:          dk ? "text-white/30 bg-white/6"             : "text-gray-500 bg-gray-100",
    statMuted:      dk ? "text-white/30"                        : "text-gray-600",
    statNormal:     dk ? "text-white/60"                        : "text-gray-800",
    portfolioBtn:   dk ? "bg-white/6 hover:bg-white/10 border-white/8 text-white/60 hover:text-white"
                       : "bg-gray-100 hover:bg-gray-200 border-gray-200 text-gray-600 hover:text-gray-900",
    navBorder:      dk ? "border-white/6"                       : "border-gray-100",
    tabGroup:       dk ? "bg-white/5"                           : "bg-gray-100",
    tabActive:      dk ? "bg-white text-black"                  : "bg-white text-gray-900 shadow-sm",
    tabInactive:    dk ? "text-white/40 hover:text-white/70"    : "text-gray-500 hover:text-gray-800",
    filterActive:   dk ? "bg-white/12 text-white"               : "bg-gray-200 text-gray-900",
    filterInactive: dk ? "text-white/30 hover:text-white/60"    : "text-gray-400 hover:text-gray-700",
    backBtn:        dk ? "text-white/40 hover:text-white"       : "text-gray-400 hover:text-gray-700",
    tapeColLabel:   dk ? "text-white/20"                        : "text-gray-300",
    tapeBorder:     dk ? "border-white/5"                       : "border-gray-100",
    sidebarBorder:  dk ? "border-white/5"                       : "border-gray-100",
    sidebarLabel:   dk ? "text-white/25"                        : "text-gray-600",
    sidebarActive:  dk ? "bg-white text-black"                  : "bg-gray-900 text-white",
    sidebarInactive:dk ? "text-white/40 hover:bg-white/6 hover:text-white/80"
                       : "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
    sidebarCount:   (active: boolean) => active
      ? dk ? "bg-black/20 text-black/60" : "bg-white/20 text-white/70"
      : dk ? "text-white/25" : "text-gray-400",
    emptyIcon:      dk ? "text-white/20"                        : "text-gray-300",
    drawerBg:       dk ? "bg-[#111] border-white/8"             : "bg-white border-gray-100",
    drawerHeader:   dk ? "border-white/8"                       : "border-gray-100",
    drawerClose:    dk ? "text-white/30 hover:text-white"       : "text-gray-400 hover:text-gray-900",
    mainTabActive:  dk ? "text-white font-black"                : "text-gray-900 font-black",
    mainTabInactive:dk ? "text-white/30 hover:text-white/60"    : "text-gray-400 hover:text-gray-700",
    mainTabIndicator: dk ? "bg-white" : "bg-gray-900",
  };

  async function handleAutoTrade(
    side: "long" | "short",
    amount: number,
    timeframe: string,
    taglineInput?: string,
  ): Promise<string | null> {
    if (!user) { setAuthOpen(true); return "Please log in first."; }
    if (!paperMode && !isTestnet && Number(user.balance_usd) < amount) return "Insufficient balance.";
    const sym = selectedCoin ?? chartSymbol ?? tokenProfileToken?.symbol ?? chartModalInfo?.symbol ?? tokenModalInfo?.symbol;
    if (!sym) return "No coin selected.";

    const ch = selectedTokenInfo?.chainLabel ?? chartModalInfo?.chainLabel ?? tokenModalInfo?.chainLabel ??
      markets.find(m => m.symbol.toUpperCase() === sym.toUpperCase())?.chain?.toUpperCase() ??
      liveCoins.find(c => c.symbol.toUpperCase() === sym.toUpperCase())?.chain ??
      "SOL";

    const autoTagline = taglineInput || `Will $${sym} go ${side === "long" ? "UP" : "DOWN"} in ${timeframe}?`;

    async function createFreshMarket() {
      const ca = selectedTokenInfo?.address ?? chartModalInfo?.address ?? tokenModalInfo?.address;
      const created = await api.createMarket(sym!, ch, timeframe, autoTagline, paperMode && !isTestnet, ca, isTestnet);
      if (!created) throw new Error("Failed to create market");
      setMarkets(prev => [created, ...prev]);
      return created;
    }

    let market = markets.find(m =>
      m.symbol.toUpperCase() === sym.toUpperCase() &&
      m.timeframe === timeframe &&
      m.status === "open" &&
      (m.is_paper === true) === paperMode &&
      new Date(m.closes_at).getTime() > Date.now()
    );

    if (!market) {
      try { market = await createFreshMarket(); }
      catch (err) { return err instanceof Error ? err.message : "Failed to create market"; }
    }

    let err = await handleAdd(market.id, side, amount);

    // If market expired in the DB (race condition — common for short timeframes like 1m),
    // mark it resolved locally and create a fresh one
    if (err && (err.toLowerCase().includes("expired") || err.toLowerCase().includes("closed") || err.toLowerCase().includes("not found"))) {
      setMarkets(prev => prev.map(m => m.id === market!.id ? { ...m, status: "resolved" as const } : m));
      try {
        const fresh = await createFreshMarket();
        err = await handleAdd(fresh.id, side, amount);
      } catch (retryErr) {
        return retryErr instanceof Error ? retryErr.message : "Failed to create market";
      }
    }

    return err;
  }

  async function handlePlaceOrder(
    side: "long" | "short",
    amount: number,
    timeframe: string,
    autoReopen: boolean,
    symbol?: string,
    chain?: string,
    ca?: string,
  ): Promise<string | null> {
    if (!user) { setAuthOpen(true); return "Please log in first."; }
    const sym = symbol ?? selectedCoin ?? chartSymbol ?? tokenProfileToken?.symbol;
    const ch  = chain ?? selectedChain;
    const addr = ca ?? selectedTokenInfo?.address;
    if (!sym) return "No coin selected.";
    if (!paperMode && !isTestnet && Number(user.balance_usd) < amount) return "Insufficient balance.";
    try {
      const result = await api.createOrders([{
        symbol: sym,
        chain: ch,
        ca: addr,
        timeframe,
        side,
        amount,
        is_paper: paperMode && !isTestnet,
        is_testnet: isTestnet,
        auto_reopen: autoReopen,
      }]);
      setUser(prev => prev ? { ...prev, balance_usd: result.new_balance, paper_balance_usd: result.new_paper_balance, testnet_balance_gen: result.new_testnet_balance } : prev);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Failed to place order";
    }
  }

  async function handleSweep(
    side: "long" | "short",
    amount: number,
    timeframe: string,
    symbol?: string,
    chain?: string,
  ): Promise<string | null> {
    if (!user) { setAuthOpen(true); return "Please log in first."; }
    const sym = symbol ?? selectedCoin ?? chartSymbol ?? tokenProfileToken?.symbol;
    const ch  = chain ?? selectedChain;
    if (!sym) return "No coin selected.";
    if (!paperMode && !isTestnet && Number(user.balance_usd) < amount) return "Insufficient balance.";
    try {
      const result = await api.sweep({
        symbol: sym,
        chain: ch,
        timeframe,
        side,
        amount,
        is_paper: paperMode && !isTestnet,
        is_testnet: isTestnet,
      });
      setUser(prev => prev ? { ...prev, balance_usd: result.new_balance, paper_balance_usd: result.new_paper_balance, testnet_balance_gen: result.new_testnet_balance } : prev);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Sweep failed";
    }
  }

  const FEED_GROUP: { key: MainTab; label: string }[] = [
    { key: "markets",  label: "Feed" },
    { key: "calls",    label: "Calls" },
    { key: "feed",     label: "P2P" },
    { key: "sweep",    label: "Hot X's" },
  ];
  const OTHER_TABS: { key: MainTab; label: string }[] = [
    { key: "trending", label: "Discover" },
    { key: "following", label: "Following" },
    { key: "ranks",    label: "Leaderboard" },
  ];
  const isFeedGroup = FEED_GROUP.some(t => t.key === mainTab);


  return (
    <div className={`flex flex-col h-[100dvh] ${T.root} pb-[60px] md:pb-0`}>

      {/* Top bar */}
      <div className={`relative flex items-center px-4 md:px-5 py-2.5 border-b-2 ${T.topBorder} shrink-0`}>
        {/* Logo */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[16px] md:text-[17px] font-black tracking-tight">FUD.</span>
          <span className="text-[10px] font-medium tracking-widest uppercase opacity-35 mt-0.5">Markets</span>
          {paperMode && (
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black ${dk ? "bg-yellow-400/10 text-yellow-400/70" : "bg-yellow-100 text-yellow-700"}`}>
              🤖 bots live
            </span>
          )}
        </div>

        {/* Search bar */}
        <HeaderSearch dk={dk} onOpen={() => setCASearchOpen(true)} />

        {/* Right side */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Trading mode toggle — visible for everyone, even not logged in */}
          <TradingModeToggle dk={dk} tradingMode={tradingMode} onChange={setTradingMode} />

          {user ? (
            <>
              {/* Balance / Wallet */}
              <BalanceSummary
                dk={dk}
                tradingMode={tradingMode}
                paperBalance={Number(user.paper_balance_usd ?? 0)}
                realBalance={Number(user.balance_usd)}
                walletAddr={walletAddr}
                genBalance={genBalance}
              />

              {/* Action button — routing lives here, button stays dumb. */}
              {/* User is guaranteed truthy here (parent {user ? ...} branch). */}
              <FundingCTA
                onClick={() => {
                  if (paperMode) {
                    setPaperCreditOpen(true);
                  } else if (!walletAddr) {
                    // Logged in but no wallet → focused modal with embedded/external choice.
                    // Reset any stale chain intent from a prior abandoned attempt.
                    setPendingFundAfterConnect(false);
                    setConnectWalletOpen(true);
                  } else {
                    // Has wallet → Privy fund flow.
                    wallet.fund();
                  }
                }}
              />

              {/* Referral */}
              <motion.button whileTap={{ scale: 0.94 }} onClick={() => setReferralOpen(true)}
                title="Referrals & Cashback"
                className={`hidden md:flex items-center justify-center w-9 h-9 transition-all ${dk ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-600"}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  {/* Box body */}
                  <rect x="3" y="12" width="18" height="9" rx="1.5" stroke="currentColor" strokeWidth="2"/>
                  {/* Lid */}
                  <rect x="2" y="9" width="20" height="4" rx="1.5" stroke="currentColor" strokeWidth="2"/>
                  {/* Vertical ribbon */}
                  <line x1="12" y1="9" x2="12" y2="21" stroke="currentColor" strokeWidth="2"/>
                  {/* Bow — left loop */}
                  <path d="M12 9 C12 6 6 5 7 8 C7.5 9.5 12 9 12 9Z" stroke="currentColor" strokeWidth="1.8"/>
                  {/* Bow — right loop */}
                  <path d="M12 9 C12 6 18 5 17 8 C16.5 9.5 12 9 12 9Z" stroke="currentColor" strokeWidth="1.8"/>
                </svg>
              </motion.button>

              {/* Notifications */}
              <motion.button whileTap={{ scale: 0.94 }}
                onClick={() => { setNotifPanelOpen(true); setUnreadCount(0); }}
                title="Notifications"
                className={`relative flex items-center justify-center w-9 h-9 transition-all ${dk ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-600"}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[14px] h-3.5 rounded-full bg-blue-500 text-white text-[8px] font-black flex items-center justify-center px-1">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </motion.button>

              {/* User avatar + username (portfolio button) */}
              <motion.button whileTap={{ scale: 0.94 }} onClick={() => setOrdersOpen(true)}
                className={`hidden md:flex items-center gap-1.5 border px-2 py-1.5 rounded-xl transition-all ${T.portfolioBtn}`}>
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                ) : (
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${dk ? "bg-white/15 text-white/70" : "bg-gray-200 text-gray-600"}`}>
                    {user.username.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className={`text-[12px] font-black hidden sm:inline ${dk ? "text-white/80" : "text-gray-700"}`}>{user.username}</span>
                {tierBadge(user.tier, user.telegram_username) && <span className="shrink-0">{tierBadge(user.tier, user.telegram_username)}</span>}
              </motion.button>
            </>
          ) : (
            <motion.button whileTap={{ scale: 0.94 }} onClick={() => setAuthOpen(true)}
              className="flex items-center gap-2 border text-[12px] font-black px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-white border-transparent transition-all">
              Sign In
            </motion.button>
          )}

          {/* Settings (desktop only — mobile uses bottom nav Account tab) */}
          <motion.button whileTap={{ scale: 0.94 }}
            onClick={() => setSettingsOpen(true)}
            className={`hidden md:flex items-center justify-center w-9 h-9 transition-all ${dk ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-600"}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </motion.button>
        </div>
      </div>

      {/* Onboarding banner — first time the user enters Real/Testnet without a wallet.
          Non-blocking: educates and offers a Set up wallet shortcut without forcing it. */}
      {user && !paperMode && !walletAddr && !onboardingDismissed && (
        <div className={`px-5 py-3 border-b flex items-center gap-3 ${dk ? "bg-blue-500/10 border-blue-500/20" : "bg-blue-50 border-blue-100"}`}>
          <span className="text-[18px] shrink-0">⚡</span>
          <div className="flex-1 min-w-0">
            <p className={`text-[12px] font-black ${dk ? "text-white" : "text-gray-900"}`}>
              You'll need a wallet to trade in {isTestnet ? "Testnet" : "Real"} mode
            </p>
            <p className={`text-[11px] font-bold mt-0.5 ${dk ? "text-white/50" : "text-gray-500"}`}>
              Set one up now or do it later when you're ready to deposit.
            </p>
          </div>
          <button
            onClick={() => {
              setPendingFundAfterConnect(false);
              setConnectWalletOpen(true);
            }}
            className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-blue-500 hover:bg-blue-400 text-white transition-all shrink-0">
            Set up wallet
          </button>
          <button
            onClick={() => {
              localStorage.setItem("fud_seen_real_onboarding", "1");
              setOnboardingDismissed(true);
            }}
            className={`text-[11px] font-bold transition-colors shrink-0 ${dk ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-700"}`}>
            Maybe later
          </button>
        </div>
      )}

      {/* Ticker */}
      <LiveTicker challenges={allChallenges} dk={dk} onViewToken={(symbol) => {
        const rich = trendingTokens.find(tk => tk.symbol.toUpperCase() === symbol.toUpperCase());
        if (rich) { handleCATradeResult(rich); return; }
        const coin = liveCoins.find(c => c.symbol.toUpperCase() === symbol.toUpperCase());
        handleCATradeResult({ address: coin?.ca ?? symbol, symbol, name: coin?.name ?? symbol, price: coin?.price ?? 0, change24h: coin?.change24h ?? 0, marketCap: coin?.marketCap ?? 0, volume24h: coin?.volume24h ?? 0, liquidity: coin?.liquidity ?? 0, chainLabel: coin?.chain ?? "SOL", pairAddress: "", chainId: "" });
      }} />

      {/* Nav bar — hidden on mobile (replaced by bottom nav) */}
      <div className={`hidden md:flex items-center justify-between px-6 py-2.5 border-b ${T.navBorder} shrink-0`}>
        <AnimatePresence mode="wait">
          {!tokenProfileToken ? (
            <motion.div key="tabs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1">
              {/* Feed group — expands when active */}
              {isFeedGroup ? (
                <div className={`flex items-center gap-0.5 px-1 py-0.5 rounded-xl border ${dk ? "border-white/15" : "border-gray-300"}`}>
                  {FEED_GROUP.map(t => (
                    <button key={t.key} onClick={() => setMainTab(t.key)}
                      className={`text-[12px] px-2.5 py-1 rounded-lg transition-all ${mainTab === t.key ? T.filterActive : T.filterInactive}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              ) : (
                <button onClick={() => setMainTab("markets")}
                  className={`text-[12px] px-3 py-1.5 rounded-xl transition-all ${T.filterInactive}`}>
                  Feed
                </button>
              )}
              {/* Divider between Feed group and other primary tabs */}
              <span className={`mx-2 h-4 w-px ${dk ? "bg-white/15" : "bg-gray-300"}`} />
              {/* Other primary tabs */}
              {OTHER_TABS.map(t => (
                <button key={t.key} onClick={() => setMainTab(t.key)}
                  className={`text-[12px] px-3 py-1.5 rounded-xl transition-all ${mainTab === t.key ? T.filterActive : T.filterInactive}`}>
                  {t.label}
                </button>
              ))}
            </motion.div>
          ) : (
            <motion.button key="back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setTokenProfileToken(null)}
              className={`text-[12px] font-bold transition-colors ${T.backBtn}`}>
              ← Back
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">

        {/* TOKEN PROFILE PAGE */}
        {tokenProfileToken && (
          <motion.div key={`token-profile-${tokenProfileToken.symbol}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex-1 overflow-hidden flex">
            <TokenProfilePage
              token={tokenProfileToken}
              dk={dk}
              onClose={() => setTokenProfileToken(null)}
              onViewChart={() => {
                setChartModalInfo(tokenProfileToken);
                setTokenProfileToken(null);
              }}
              onBet={handleAdd}
              onOpenMarket={() => openMarketForToken(tokenProfileToken)}
              onSweep={handleSweep}
              onPlaceOrder={handlePlaceOrder}
              loggedIn={!!user}
              onAuthRequired={() => setAuthOpen(true)}
              paperMode={paperMode}
              presets={tradePresets}
            />
          </motion.div>
        )}


        {/* CHART TAB */}
        {!tokenProfileToken && mainTab === "chart" && (
          <motion.div key="chart" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="flex-1 overflow-hidden flex flex-col">
            <SpotView
              dk={dk}
              liveCoins={liveCoins}
              markets={markets}
              onBet={handleAdd}
              onAutoTrade={handleAutoTrade}
              onSweep={handleSweep}
              onPlaceOrder={handlePlaceOrder}
              onOpenMarket={handleOpenMarket}
              onViewProfile={(u) => setProfileUser(u)}
              loggedIn={!!user}
              onAuthRequired={() => setAuthOpen(true)}
              presets={tradePresets}
              paperMode={paperMode}
              externalSymbol={chartSymbol ?? undefined}
              externalTokenInfo={selectedTokenInfo ?? undefined}
            />
          </motion.div>
        )}

        {/* CALLS TAB — social-first feed of recent calls */}
        {!tokenProfileToken && mainTab === "calls" && (
          <motion.div key="calls" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="flex-1 overflow-hidden flex flex-col">
            {/* Sub-filter: Fresh Calls | Hot Debates */}
            <div className={`flex gap-1.5 px-4 md:px-5 py-2 border-b shrink-0 ${T.navBorder}`}>
              {(["fresh", "debates"] as const).map(f => (
                <button key={f} onClick={() => setCallsFilter(f)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all ${callsFilter === f ? T.filterActive : T.filterInactive}`}>
                  {f === "fresh" ? "Fresh Calls" : `Hot Debates${debates.length > 0 ? ` (${debates.length})` : ""}`}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-4 md:px-5 py-4">
              {callsFilter === "fresh" ? (
                <>
                  {callsLoading && calls.length === 0 ? (
                    <div className={`flex items-center justify-center h-40 ${dk ? "text-white/30" : "text-gray-400"}`}>
                      <span className="text-[13px] font-bold">Loading calls…</span>
                    </div>
                  ) : calls.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {calls.map((c, i) => (
                        <CallCard
                          key={c.id}
                          call={c}
                          dk={dk}
                          index={i}
                          onViewProfile={(u) => setProfileUser(u)}
                          onViewToken={(symbol, chain) => {
                            const rich = trendingTokens.find(tk => tk.symbol.toUpperCase() === symbol.toUpperCase());
                            handleCATradeResult(rich ?? {
                              symbol, name: symbol, address: "",
                              chainId: chain.toLowerCase(), chainLabel: chain,
                              price: 0, change24h: 0, liquidity: 0,
                              volume24h: 0, marketCap: 0, pairAddress: "",
                            });
                          }}
                          onFade={async (call, side, amount) => {
                            if (!user) { setAuthOpen(true); return null; }
                            if (!call.market_id) return "Cannot fade — market not found.";
                            if (call.status !== "open") return "This market is already closed.";
                            return handleAdd(call.market_id, side, amount, undefined, call.id);
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className={`flex flex-col items-center justify-center h-full gap-4 px-6`}>
                      <span className="text-[40px]">📢</span>
                      <div className="text-center">
                        <p className={`text-[15px] font-black ${dk ? "text-white/70" : "text-gray-700"}`}>No calls yet</p>
                        <p className={`text-[12px] font-bold mt-1 ${dk ? "text-white/30" : "text-gray-400"}`}>
                          Be the first to make a call. Open a market and share your thesis.
                        </p>
                      </div>
                      <button onClick={() => setMainTab("trending")}
                        className={`px-5 py-2.5 rounded-xl text-[12px] font-black tracking-wide transition-all ${dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-gray-700"}`}>
                        Make a call →
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* HOT DEBATES */
                debates.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {debates.map((d, i) => (
                      <DebateCard
                        key={d.market.id}
                        debate={d}
                        dk={dk}
                        index={i}
                        onViewProfile={(u) => setProfileUser(u)}
                        onViewToken={(symbol, chain) => {
                          const rich = trendingTokens.find(tk => tk.symbol.toUpperCase() === symbol.toUpperCase());
                          handleCATradeResult(rich ?? {
                            symbol, name: symbol, address: "",
                            chainId: chain.toLowerCase(), chainLabel: chain,
                            price: 0, change24h: 0, liquidity: 0,
                            volume24h: 0, marketCap: 0, pairAddress: "",
                          });
                        }}
                        onFade={(marketId, side) => {
                          if (!user) { setAuthOpen(true); return; }
                          handleAdd(marketId, side, 25);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className={`flex flex-col items-center justify-center h-full gap-4 px-6`}>
                    <span className="text-[40px]">⚔️</span>
                    <div className="text-center">
                      <p className={`text-[15px] font-black ${dk ? "text-white/70" : "text-gray-700"}`}>No active debates</p>
                      <p className={`text-[12px] font-bold mt-1 ${dk ? "text-white/30" : "text-gray-400"}`}>
                        Debates appear when both sides of a market have callers with strong positions.
                      </p>
                    </div>
                  </div>
                )
              )}
            </div>
          </motion.div>
        )}

        {/* MARKETS TAB */}
        {!tokenProfileToken && mainTab === "markets" && (
          <MarketsScreen
            variant="markets"
            dk={dk}
            isTestnet={isTestnet}
            paperMode={paperMode}
            liveMarkets={liveMarketsForView}
            calls={calls}
            debates={debates}
            shakingIds={shakingIds}
            presets={tradePresets}
            loggedIn={!!user}
            onAuthRequired={() => setAuthOpen(true)}
            onSelectToken={(symbol, chain) => handleCoinClick(symbol, chain)}
            onViewProfile={(u) => setProfileUser(u)}
            onViewToken={(symbol, chain) => handleCoinClick(symbol, chain)}
            onBet={handleAdd}
            onFadeCall={async (call, side, amount) => {
              if (!user) { setAuthOpen(true); return null; }
              if (!call.market_id) return "Cannot fade — market not found.";
              if (call.status !== "open") return "This market is already closed.";
              return handleAdd(call.market_id, side, amount, undefined, call.id);
            }}
            onFadeDebate={(marketId, side) => {
              if (!user) { setAuthOpen(true); return; }
              handleAdd(marketId, side, 25);
            }}
            rightSlot={
              <TapeSidebar challenges={allChallenges} onViewCoin={handleCoinClick} onViewToken={(symbol) => {
                const rich = trendingTokens.find(tk => tk.symbol.toUpperCase() === symbol.toUpperCase());
                if (rich) { handleCATradeResult(rich); return; }
                const coin = liveCoins.find(c => c.symbol.toUpperCase() === symbol.toUpperCase());
                handleCATradeResult({ address: coin?.ca ?? symbol, symbol, name: coin?.name ?? symbol, price: coin?.price ?? 0, change24h: coin?.change24h ?? 0, marketCap: coin?.marketCap ?? 0, volume24h: coin?.volume24h ?? 0, liquidity: coin?.liquidity ?? 0, chainLabel: coin?.chain ?? "SOL", pairAddress: "", chainId: "" });
              }} dk={dk}
              tapeBorder={T.sidebarBorder} sidebarLabel={T.sidebarLabel} tapeColLabel={T.tapeColLabel}
              open={tapeOpen} onToggle={() => setTapeOpen(o => !o)}
              onViewProfile={(u) => setProfileUser(u)} paperMode={paperMode} />
            }
          />
        )}

        {/* HOT X's TAB */}
        {!tokenProfileToken && mainTab === "sweep" && (
          <MarketsScreen
            variant="sweep"
            dk={dk}
            isTestnet={isTestnet}
            paperMode={paperMode}
            liveMarkets={liveMarketsForView}
            calls={calls}
            debates={debates}
            shakingIds={shakingIds}
            presets={tradePresets}
            loggedIn={!!user}
            onAuthRequired={() => setAuthOpen(true)}
            onSelectToken={(symbol, chain) => handleCoinClick(symbol, chain)}
            onViewProfile={(u) => setProfileUser(u)}
            onViewToken={(symbol, chain) => handleCoinClick(symbol, chain)}
            onBet={handleAdd}
            onFadeCall={async (call, side, amount) => {
              if (!user) { setAuthOpen(true); return null; }
              if (!call.market_id) return "Cannot fade — market not found.";
              if (call.status !== "open") return "This market is already closed.";
              return handleAdd(call.market_id, side, amount, undefined, call.id);
            }}
            onFadeDebate={(marketId, side) => {
              if (!user) { setAuthOpen(true); return; }
              handleAdd(marketId, side, 25);
            }}
          />
        )}

        {/* FEED TAB */}
        {!tokenProfileToken && mainTab === "feed" && (
          <motion.div key="feed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="flex-1 flex overflow-hidden">
            {/* Timeframe sidebar — desktop only */}
            <div style={{ width: "220px", minWidth: "220px" }} className={`hidden md:flex border-r ${T.sidebarBorder} flex-col py-4 px-3 shrink-0 overflow-y-auto`}>
              <p className={`text-[9px] font-black tracking-widest uppercase px-2 mb-3 ${T.sidebarLabel}`}>Timeframe</p>
              {TIMEFRAMES.map(tf => {
                const count   = allChallenges.filter(c => c.timeframe === tf && c.status === "open").length;
                const isActive = selectedTf === tf;
                return (
                  <button key={tf} onClick={() => setSelectedTf(tf)}
                    className={`flex items-center justify-between px-3 py-3 rounded-xl text-left transition-all mb-1 ${isActive ? T.sidebarActive : T.sidebarInactive}`}>
                    <span className="flex items-center gap-3">
                      <span className={`text-[17px] leading-none ${isActive ? "" : (dk ? "text-white/35" : "text-gray-400")}`}>{TF_ICONS[tf]}</span>
                      <span className="text-[14px] font-black">{tf}</span>
                    </span>
                    <span className={`text-[11px] font-bold rounded-full px-2 ${T.sidebarCount(isActive)}`}>{count || "—"}</span>
                  </button>
                );
              })}
            </div>

            {/* Card grid + filter bar */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Timeframe pills — mobile only */}
              <div className={`flex md:hidden gap-1.5 overflow-x-auto px-4 py-2 border-b shrink-0 scrollbar-none ${T.navBorder}`}>
                {TIMEFRAMES.map(tf => {
                  const count = allChallenges.filter(c => c.timeframe === tf && c.status === "open").length;
                  const isActive = selectedTf === tf;
                  return (
                    <button key={tf} onClick={() => setSelectedTf(tf)}
                      className={`flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-black transition-all ${isActive ? T.filterActive : T.filterInactive}`}>
                      <span>{TF_ICONS[tf]}</span>
                      <span>{tf}</span>
                      {count > 0 && <span className={`text-[10px] font-bold ${isActive ? "opacity-70" : T.sidebarLabel}`}>{count}</span>}
                    </button>
                  );
                })}
              </div>

              <FilterBar
                dk={dk} navBorder={T.navBorder}
                filter={filter} setFilter={setFilter}
                marketCapMax={marketCapMax} setMarketCapMax={setMarketCapMax}
                minPool={minPool} setMinPool={setMinPool}
                poolSortDir={poolSortDir} setPoolSortDir={setPoolSortDir}
                statusFilter={statusFilter} setStatusFilter={setStatusFilter}
              />
              <div className="flex-1 overflow-y-auto px-4 md:px-5 py-5">
                {filtered.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filtered.map((c, i) => (
                      <ChallengeCard key={c.id} challenge={c} index={i} onAdd={handleAdd} shaking={shakingIds.has(c.id)} onViewCoin={() => {
                          const rich = trendingTokens.find(tk => tk.symbol.toUpperCase() === c.symbol.toUpperCase());
                          handleCATradeResult(rich ?? {
                            symbol: c.symbol, name: c.symbol, address: "",
                            chainId: c.chain.toLowerCase(), chainLabel: c.chain,
                            price: c.entryPrice, change24h: 0, liquidity: 0,
                            volume24h: 0, marketCap: 0, pairAddress: "",
                          });
                        }} onViewProfile={setProfileUser} dk={dk} livePrice={livePrices[`${c.symbol}_${c.chain}`]} paperMode={paperMode} />
                    ))}
                  </div>
                ) : (
                  <div className={`flex flex-col items-center justify-center h-full gap-4 px-6 ${T.emptyIcon}`}>
                    {modeMarkets.length === 0 ? (
                      <>
                        <span className="text-[40px]">{paperMode ? "🧪" : "🏁"}</span>
                        <div className="text-center">
                          <p className={`text-[15px] font-black ${dk ? "text-white/70" : "text-gray-700"}`}>
                            {paperMode ? "No paper markets yet" : "No markets yet"}
                          </p>
                          <p className={`text-[12px] font-bold mt-1 ${dk ? "text-white/30" : "text-gray-400"}`}>
                            {paperMode ? "Practice with simulated money. Open a paper market and test your strategy." : "Be the first. Open a market and set the tone."}
                          </p>
                        </div>
                        <button onClick={() => setMainTab("trending")}
                          className={`px-5 py-2.5 rounded-xl text-[12px] font-black tracking-wide transition-all ${paperMode ? "bg-yellow-400 text-black hover:bg-yellow-300" : dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-gray-700"}`}>
                          {paperMode ? "Open paper market →" : "Open first market →"}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-[32px]">—</span>
                        <p className="text-[13px] font-bold">No open {selectedTf} {paperMode ? "paper " : ""}markets</p>
                        <button onClick={() => setMainTab("trending")}
                          className={`text-[12px] font-black px-4 py-2 rounded-xl transition-all ${dk ? "bg-white/8 hover:bg-white/15 text-white/50 hover:text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-900"}`}>
                          Trending →
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Tape — desktop only */}
            <div className="hidden md:flex">
              <TapeSidebar challenges={allChallenges} onViewCoin={handleCoinClick} onViewToken={(symbol) => {
                  const rich = trendingTokens.find(tk => tk.symbol.toUpperCase() === symbol.toUpperCase());
                  if (rich) { handleCATradeResult(rich); return; }
                  const coin = liveCoins.find(c => c.symbol.toUpperCase() === symbol.toUpperCase());
                  handleCATradeResult({ address: coin?.ca ?? symbol, symbol, name: coin?.name ?? symbol, price: coin?.price ?? 0, change24h: coin?.change24h ?? 0, marketCap: coin?.marketCap ?? 0, volume24h: coin?.volume24h ?? 0, liquidity: coin?.liquidity ?? 0, chainLabel: coin?.chain ?? "SOL", pairAddress: "", chainId: "" });
                }} dk={dk}
                tapeBorder={T.sidebarBorder} sidebarLabel={T.sidebarLabel} tapeColLabel={T.tapeColLabel}
                open={tapeOpen} onToggle={() => setTapeOpen(o => !o)}
                onViewProfile={(u) => setProfileUser(u)} paperMode={paperMode} />
            </div>
          </motion.div>
        )}

        {/* TRENDING TAB */}
        {!tokenProfileToken && mainTab === "trending" && (
          <DiscoverScreen
            dk={dk}
            trendingTokens={trendingTokens}
            trendingLoading={trendingLoading}
            trendingChain={trendingChain}
            trendingSort={trendingSort}
            setTrendingChain={setTrendingChain}
            setTrendingSort={setTrendingSort}
            onOpenMarket={(token) => handleOpenMarket({ symbol: token.symbol, chain: token.chainLabel, marketCap: token.marketCap, ca: token.address, price: token.price } as Coin)}
            onViewToken={(token) => handleCATradeResult(token)}
          />
        )}

        {/* FOLLOWING TAB */}
        {!tokenProfileToken && mainTab === "following" && (
          <FollowingScreen
            dk={dk}
            calls={calls}
            followingList={followingList}
            loggedIn={!!user}
            onViewProfile={(u) => setProfileUser(u)}
            onViewToken={(symbol, chain) => handleCoinClick(symbol, chain)}
            onAuthRequired={() => setAuthOpen(true)}
            onFade={(marketId, side, amount, fadedPositionId) => handleAdd(marketId, side, amount, undefined, fadedPositionId)}
          />
        )}

        {/* RANKS TAB */}
        {!tokenProfileToken && mainTab === "ranks" && (
          <motion.div key="ranks" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="flex-1 flex flex-col overflow-hidden">
            <LeaderboardView dk={dk} onViewProfile={(u) => setProfilePageUser(u)} paperMode={paperMode} />
          </motion.div>
        )}

      </AnimatePresence>

      {/* Token Modal — popup over feed */}
      <AnimatePresence>
        {tokenModalInfo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTokenModalInfo(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 28, stiffness: 340 }}
              className={`relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border ${dk ? "bg-[#0a0a0a] border-white/10" : "bg-white border-gray-200"} shadow-2xl mx-4`}
              onClick={e => e.stopPropagation()}
            >
              <button onClick={() => setTokenModalInfo(null)}
                className={`absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center text-[14px] font-bold transition-colors ${dk ? "bg-white/10 text-white/50 hover:bg-white/20" : "bg-gray-100 text-gray-400 hover:bg-gray-200"}`}>
                ✕
              </button>
              <TokenProfilePage
                token={tokenModalInfo}
                dk={dk}
                onClose={() => setTokenModalInfo(null)}
                onAutoTrade={async (side, amount, timeframe, tagline) => {
                  if (!user) { setAuthOpen(true); return "Sign in to trade"; }
                  return handleAutoTrade(side, amount, timeframe, tagline);
                }}
                onBet={async (marketId, side, amount, message) => {
                  if (!user) { setAuthOpen(true); return "Sign in to trade"; }
                  return handleAdd(marketId, side, amount, message);
                }}
                onOpenMarket={() => { if (!user) { setAuthOpen(true); return; } openMarketForToken(tokenModalInfo); }}
                onSweep={async (side, amount, timeframe, symbol, chain) => {
                  if (!user) { setAuthOpen(true); return "Sign in to trade"; }
                  return handleSweep(side, amount, timeframe, symbol, chain);
                }}
                onPlaceOrder={async (side, amount, timeframe, autoReopen, symbol, chain, ca) => {
                  if (!user) { setAuthOpen(true); return "Sign in to trade"; }
                  return handlePlaceOrder(side, amount, timeframe, autoReopen, symbol, chain, ca);
                }}
                loggedIn={!!user}
                onAuthRequired={() => setAuthOpen(true)}
                paperMode={paperMode}
                presets={tradePresets}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Chart Modal */}
      <AnimatePresence>
        {chartModalInfo && (
          <ChartModal
            token={chartModalInfo}
            dk={dk}
            onClose={() => setChartModalInfo(null)}
            onBet={async (marketId, side, amount, message) => {
              if (!user) { setAuthOpen(true); return "Sign in to trade"; }
              return handleAdd(marketId, side, amount, message);
            }}
            onAutoTrade={async (side, amount, timeframe, tagline) => {
              if (!user) { setAuthOpen(true); return "Sign in to trade"; }
              return handleAutoTrade(side, amount, timeframe, tagline);
            }}
            onSweep={async (side, amount, timeframe, symbol, chain) => {
              if (!user) { setAuthOpen(true); return "Sign in to trade"; }
              return handleSweep(side, amount, timeframe, symbol, chain);
            }}
            onOpenMarket={() => { if (!user) { setAuthOpen(true); return; } openMarketForToken(chartModalInfo!); }}
            loggedIn={!!user}
            onAuthRequired={() => setAuthOpen(true)}
            paperMode={paperMode}
            presets={tradePresets}
            onViewProfile={() => {
              const t = chartModalInfo;
              setChartModalInfo(null);
              setTokenModalInfo(t);
            }}
            onViewFullChart={() => {
              setChartModalInfo(null);
              setChartSymbol(chartModalInfo!.symbol);
              setMainTab("chart" as MainTab);
            }}
          />
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {authOpen    && <AuthModal dk={dk} onSuccess={handleAuthSuccess} onClose={() => setAuthOpen(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {depositOpen && <DepositModal dk={dk} onClose={() => setDepositOpen(false)} onDeposited={handleDeposited} />}
      </AnimatePresence>

      {/* Paper Credit Modal */}
      <AnimatePresence>
        {paperCreditOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setPaperCreditOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }} transition={{ type: "spring", stiffness: 340, damping: 28 }}
              className={`relative w-[320px] rounded-2xl border p-6 shadow-2xl z-10 ${dk ? "bg-[#111] border-white/10" : "bg-white border-gray-200"}`}>
              <button onClick={() => setPaperCreditOpen(false)}
                className={`absolute top-4 right-4 text-[18px] font-bold transition-colors ${dk ? "text-white/20 hover:text-white/50" : "text-gray-300 hover:text-gray-600"}`}>✕</button>
              <div className="mb-5">
                <span className="text-[16px] font-black">Add Paper Money</span>
                <p className={`text-[11px] mt-0.5 ${dk ? "text-white/40" : "text-gray-500"}`}>
                  Simulated balance for testing. Max $10,000 total.
                </p>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-1.5">
                  {[100, 500, 1000, 5000].map(a => (
                    <button key={a} onClick={() => setPaperCreditAmt(String(a))}
                      className={`py-2 rounded-xl text-[11px] font-black transition-all ${
                        paperCreditAmt === String(a)
                          ? "bg-yellow-400 text-black"
                          : dk ? "bg-white/6 text-white/50 hover:bg-white/12" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}>${a >= 1000 ? `${a/1000}k` : a}</button>
                  ))}
                </div>
                <div className="relative">
                  <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>$</span>
                  <input type="number" value={paperCreditAmt} onChange={e => setPaperCreditAmt(e.target.value)} min={1} max={10000}
                    className={`w-full pl-6 pr-3 py-2.5 rounded-xl text-[13px] font-bold outline-none transition-all ${
                      dk ? "bg-white/6 border border-white/10 text-white placeholder:text-white/20 focus:border-white/30" : "bg-gray-50 border border-gray-200 text-gray-900 focus:border-gray-400"
                    }`} />
                </div>
                <button
                  disabled={paperCreditLoading || !paperCreditAmt || Number(paperCreditAmt) <= 0}
                  onClick={async () => {
                    setPaperCreditLoading(true);
                    try {
                      const res = await api.paperCredit(Number(paperCreditAmt));
                      setUser(u => u ? { ...u, paper_balance_usd: res.paper_balance_usd } : null);
                      setPaperCreditOpen(false);
                      setPaperCreditAmt("100");
                    } catch (err: any) { alert(err.message); }
                    finally { setPaperCreditLoading(false); }
                  }}
                  className="w-full py-3 rounded-xl bg-yellow-400 text-black text-[13px] font-black hover:bg-yellow-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                  {paperCreditLoading ? "Adding…" : `Add $${paperCreditAmt || "0"} paper`}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Connect Wallet Modal — used when user is logged in but has no wallet. */}
      <AnimatePresence>
        {connectWalletOpen && (
          <ConnectWalletModal
            onClose={() => setConnectWalletOpen(false)}
            dk={dk}
            mode={connectWalletMode}
            onUseEmbedded={() => {
              setConnectWalletOpen(false);
              setPendingFundAfterConnect(true);
              wallet.loginEmbedded();
            }}
            onConnectExternal={() => {
              setConnectWalletOpen(false);
              setPendingFundAfterConnect(true);
              wallet.connect().catch(() => setPendingFundAfterConnect(false));
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {openMarketCoin && (
          <TradeModal dk={dk} coin={openMarketCoin} onClose={() => setOpenMarketCoin(null)} onSuccess={handleMarketCreated} paperMode={paperMode} isTestnet={isTestnet} walletAddress={walletAddr ?? undefined}
            onViewToken={() => {
              const c = openMarketCoin;
              setOpenMarketCoin(null);
              const rich = trendingTokens.find(tk => tk.symbol.toUpperCase() === c.symbol.toUpperCase());
              handleCATradeResult(rich ?? {
                address: c.ca ?? c.symbol, symbol: c.symbol, name: c.name ?? c.symbol,
                price: c.price ?? 0, change24h: c.change24h ?? 0, marketCap: c.marketCap ?? 0,
                volume24h: c.volume24h ?? 0, liquidity: c.liquidity ?? 0,
                chainLabel: c.chain ?? "SOL", pairAddress: "", chainId: "",
              });
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {caSearchOpen && (
          <SearchModal
            dk={dk}
            onClose={() => setCASearchOpen(false)}
            onViewToken={handleCATradeResult}
            onViewChart={(token) => { setCASearchOpen(false); setSelectedTokenInfo(token); setSelectedCoin(token.symbol); setTokenProfileToken(null); }}
            onOpenMarket={(coin) => { setCASearchOpen(false); handleOpenMarket(coin); }}
            onViewProfile={(username) => { setCASearchOpen(false); setProfilePageUser(username); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {referralOpen && <ReferralModal dk={dk} isLoggedIn={!!user} onClose={() => setReferralOpen(false)} onSignIn={() => setAuthOpen(true)} />}
      </AnimatePresence>

      {/* Account drawer (with drill-down to Wallet) */}
      <AccountDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        dk={dk}
        user={user}
        wallet={wallet}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={toggleNotifications}
        onToggleDarkMode={() => setTheme(dk ? "light" : "dark")}
        onOpenReferrals={() => setReferralOpen(true)}
        onLogout={handleLogout}
      />

      {/* Portfolio drawer */}
      <AnimatePresence>
        {ordersOpen && (
          <>
            <motion.div key="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOrdersOpen(false)} className="fixed inset-0 bg-black/60 z-40" />
            <motion.div key="drawer" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className={`fixed right-0 top-0 h-full w-full md:w-[420px] border-l z-50 flex flex-col ${T.drawerBg}`}>
              <div className={`flex items-center justify-between px-5 py-4 border-b shrink-0 ${T.drawerHeader}`}>
                <span className="text-[15px] font-black">Your Profile</span>
                <button onClick={() => setOrdersOpen(false)} className={`text-[18px] font-bold transition-colors ${T.drawerClose}`}>✕</button>
              </div>
              <div className="flex-1 overflow-hidden flex flex-col">
                <OrdersView dk={dk} balance={user?.balance_usd} notificationsEnabled={notificationsEnabled} paperMode={paperMode}
                  onViewToken={(symbol) => {
                    setOrdersOpen(false);
                    const rich = trendingTokens.find(tk => tk.symbol.toUpperCase() === symbol.toUpperCase());
                    if (rich) { handleCATradeResult(rich); return; }
                    const coin = liveCoins.find(c => c.symbol.toUpperCase() === symbol.toUpperCase());
                    handleCATradeResult({
                      address: coin?.ca ?? symbol, symbol, name: coin?.name ?? symbol,
                      price: coin?.price ?? 0, change24h: coin?.change24h ?? 0, marketCap: coin?.marketCap ?? 0,
                      volume24h: coin?.volume24h ?? 0, liquidity: coin?.liquidity ?? 0,
                      chainLabel: coin?.chain ?? "SOL", pairAddress: "", chainId: "",
                    });
                  }}
                  xUsername={user?.x_username}
                  telegramUsername={user?.telegram_username}
                  onDisconnectX={async () => {
                    try { await api.disconnectX(); setUser(u => u ? { ...u, x_username: undefined } : null); }
                    catch (e: any) { alert(e.message ?? "Error disconnecting X"); }
                  }}
                  onDisconnectTelegram={async () => {
                    try { await api.disconnectTelegram(); setUser(u => u ? { ...u, telegram_username: undefined } : null); }
                    catch (e: any) { alert(e.message ?? "Error disconnecting Telegram"); }
                  }}
                  onTelegramConnect={() => {
                    // Poll /auth/me until telegram_username is populated (up to 60s)
                    let attempts = 0;
                    const poll = setInterval(async () => {
                      attempts++;
                      try {
                        const fresh = await api.me();
                        if (fresh.telegram_username) {
                          setUser(fresh);
                          clearInterval(poll);
                        }
                      } catch {}
                      if (attempts >= 20) clearInterval(poll);
                    }, 3000);
                  }}
                  onViewOwnProfile={() => { setOrdersOpen(false); setProfilePageUser(user?.username ?? null); }}
                  onUserUpdate={() => api.me().then(setUser).catch(() => {})}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Profile Modal */}
      <AnimatePresence>
        {profileUser && (
          <ProfileModal username={profileUser} dk={dk} onClose={() => setProfileUser(null)}
            onViewProfile={() => { setProfilePageUser(profileUser); setProfileUser(null); }}
            onNavigateToUser={(u) => { setProfileUser(u); }}
            currentUser={user?.username} />
        )}
        {profilePageUser && (
          <ProfilePage username={profilePageUser} dk={dk} onClose={() => setProfilePageUser(null)}
            currentUser={user?.username} currentUserObj={user ?? undefined}
            onUserUpdate={(u) => setUser(u)} paperMode={paperMode}
            onViewProfile={(u) => setProfilePageUser(u)} />
        )}
      </AnimatePresence>

      {/* Notifications Panel */}
      <AnimatePresence>
        {notifPanelOpen && (
          <NotificationsPanel dk={dk} onClose={() => setNotifPanelOpen(false)}
            onViewProfile={(u) => { setNotifPanelOpen(false); setProfilePageUser(u); }} />
        )}
      </AnimatePresence>

      {/* Mobile bottom nav */}
      <BottomNav
        dk={dk}
        mainTab={mainTab}
        settingsOpen={settingsOpen}
        onNavigate={(tab) => {
          setSettingsOpen(false);
          setMainTab(tab);
          setTokenProfileToken(null);
        }}
        onOpenAccount={() => setSettingsOpen(true)}
      />
    </div>
  );
}

// ─── ChallengeCard ────────────────────────────────────────────────────────────

function ChallengeCard({ challenge: c, index, onAdd, onViewCoin, onViewProfile, dk, livePrice, paperMode, shaking }: {
  challenge: Challenge;
  index: number;
  onAdd: (id: string, side: "short" | "long", amount: number) => Promise<string | null>;
  onViewCoin: () => void;
  onViewProfile: (username: string) => void;
  dk: boolean;
  livePrice?: number;
  paperMode?: boolean;
  shaking?: boolean;
}) {
  const [activeSide, setActiveSide] = useState<"short" | "long" | null>(null);
  const [customAmt, setCustomAmt]   = useState("");
  const [betLoading, setBetLoading] = useState(false);
  const [betError, setBetError]     = useState("");

  // Rotating messages
  type CardMsg = { text: string; user: string; avatar?: string; isOpener: boolean };
  const [msgs, setMsgs]     = useState<CardMsg[]>(() =>
    c.tagline ? [{ text: c.tagline, user: c.openerUsername ?? c.user, avatar: c.openerAvatar, isOpener: true }] : []
  );
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    function load() {
      api.getMarketPositions(c.id).then((positions: any[]) => {
        const betMsgs: CardMsg[] = positions
          .filter(p => p.message)
          .map(p => ({ text: p.message, user: p.username ?? "", avatar: p.avatar_url ?? undefined, isOpener: p.is_opener ?? false }));
        const openerMsg: CardMsg[] = c.tagline
          ? [{ text: c.tagline, user: c.openerUsername ?? c.user, avatar: c.openerAvatar, isOpener: true }]
          : [];
        const seen = new Set<string>();
        const all = [...openerMsg, ...betMsgs].filter(m => { if (seen.has(m.text)) return false; seen.add(m.text); return true; });
        setMsgs(all);
      }).catch(() => {});
    }
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [c.id]);

  useEffect(() => {
    if (msgs.length <= 1) return;
    const iv = setInterval(() => setMsgIdx(i => (i + 1) % msgs.length), 3000);
    return () => clearInterval(iv);
  }, [msgs.length]);

  const currentMsg = msgs[msgIdx] ?? null;
  const [timeLeft, setTimeLeft]     = useState(() =>
    c.closesAt ? formatMsLeft(Math.max(0, c.closesAt - Date.now())) : c.expiresIn
  );

  useEffect(() => {
    if (!c.closesAt) return;
    let iv: ReturnType<typeof setInterval>;
    function tick() {
      const ms = Math.max(0, c.closesAt! - Date.now());
      setTimeLeft(formatMsLeft(ms));
      clearInterval(iv);
      const next = ms < 60_000 ? 1_000 : 60_000;
      iv = setInterval(tick, next);
    }
    tick();
    return () => clearInterval(iv);
  }, [c.closesAt]);

  const total      = c.shortPool + c.longPool;
  const shortPct   = total > 0 ? (c.shortPool / total) * 100 : 50;
  const longPct    = 100 - shortPct;
  const shortMult  = multiplier(c.shortPool, c.longPool);
  const longMult   = multiplier(c.longPool, c.shortPool);
  const shortIsJuicy = c.longPool > c.shortPool * 2;
  const longIsJuicy  = c.shortPool > c.longPool * 2;

  const handleQuick = async (amount: number) => {
    if (!activeSide) return;
    setCustomAmt("");
    setBetLoading(true);
    setBetError("");
    const err = await onAdd(c.id, activeSide, amount);
    setBetLoading(false);
    if (err) { setBetError(err); }
    else { setActiveSide(null); setCustomAmt(""); }
  };

  const handleCustom = async () => {
    const amt = parseFloat(customAmt);
    if (!activeSide || !amt || amt <= 0) return;
    setBetLoading(true);
    setBetError("");
    const err = await onAdd(c.id, activeSide, amt);
    setBetLoading(false);
    if (err) { setBetError(err); }
    else { setActiveSide(null); setCustomAmt(""); }
  };

  const card      = dk ? "border-white/8 bg-white/[0.03] hover:border-white/14"   : "border-gray-200 bg-white hover:border-gray-300 shadow-sm";
  const symBtn    = dk ? "text-white hover:text-white/60"                          : "text-gray-900 hover:text-gray-500";
  const chainPill = (chain: string) => {
    if (chain === "SOL")  return dk ? "text-purple-300 bg-purple-500/20" : "text-purple-700 bg-purple-100";
    if (chain === "BASE") return dk ? "text-blue-300 bg-blue-500/20"     : "text-blue-700 bg-blue-100";
    if (chain === "BSC")  return dk ? "text-yellow-300 bg-yellow-500/20" : "text-yellow-700 bg-yellow-100";
    return dk ? "text-orange-300 bg-orange-500/20" : "text-orange-700 bg-orange-100";
  };
  const priceTxt   = dk ? "text-white/30"  : "text-gray-400";
  const tfTxt      = dk ? "text-white/50"  : "text-gray-500";
  const expTxt     = dk ? "text-white/25"  : "text-gray-400";
  const tagline    = dk ? "text-white/40"  : "text-gray-500";
  const poolBox    = dk ? "bg-white/4"     : "bg-gray-50";
  const multTxt    = dk ? "text-white/35"  : "text-gray-400";
  const metaTxt    = dk ? "text-white/25"  : "text-gray-400";
  const cancelBtn  = dk ? "text-white/25 hover:text-white/50" : "text-gray-400 hover:text-gray-600";
  const amtIdle    = dk ? "bg-white/6 text-white/50 hover:bg-white/12 hover:text-white" : "bg-blue-50 text-blue-600 hover:bg-blue-100";
  const inputCls   = dk ? "bg-white/6 text-white placeholder:text-white/20 focus:bg-white/10"
                        : "bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-300 focus:border-blue-300";
  const addBtnCls  = (side: "short" | "long") => side === "short"
    ? dk ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-50 text-red-600 hover:bg-red-100"
    : dk ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100";
  const sideLabelCls = (side: "short" | "long") => side === "short"
    ? dk ? "text-red-400" : "text-red-600"
    : dk ? "text-emerald-400" : "text-emerald-600";

  const isResolved  = c.status === "resolved";
  const isCancelled = c.status === "cancelled";
  const isDone      = isResolved || isCancelled;

  // Price change for resolved markets
  const priceChange = isResolved && c.exitPrice && c.entryPrice
    ? ((c.exitPrice - c.entryPrice) / c.entryPrice) * 100
    : null;

  // Resolved card border tint
  const resolvedCard = c.winnerSide === "long"
    ? dk ? "border-emerald-500/30 bg-emerald-500/5" : "border-emerald-300 bg-emerald-50"
    : dk ? "border-red-500/30 bg-red-500/5" : "border-red-300 bg-red-50";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={shaking ? { x: [0, -6, 6, -4, 4, -2, 2, 0], opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
      transition={shaking ? { duration: 0.5, ease: "easeOut" } : { delay: index * 0.03 }}
      className={`flex flex-col gap-3 rounded-2xl border-2 transition-all p-4 ${isDone ? resolvedCard : card}`}>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <button onClick={onViewCoin} className={`text-[18px] font-black transition-colors leading-none ${symBtn}`}>
              ${c.symbol}
            </button>
            {isResolved && (
              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                c.winnerSide === "long"
                  ? dk ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                  : dk ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-700"
              }`}>
                {c.winnerSide === "long" ? "LONG WON" : "SHORT WON"}
              </span>
            )}
            {isCancelled && (
              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${dk ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-500"}`}>
                CANCELLED
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${chainPill(c.chain)}`}>{c.chain}</span>
            <span className={`text-[10px] font-mono ${priceTxt}`}>@ ${formatPrice(c.entryPrice)}</span>
            {!isDone && livePrice && (() => {
              const pct = ((livePrice - c.entryPrice) / c.entryPrice) * 100;
              const up = pct >= 0;
              return (
                <span className={`text-[10px] font-mono font-bold ${up ? (dk ? "text-emerald-400" : "text-emerald-600") : (dk ? "text-red-400" : "text-red-600")}`}>
                  {up ? "▲" : "▼"} ${formatPrice(livePrice)} ({up ? "+" : ""}{pct.toFixed(2)}%)
                </span>
              );
            })()}
            {isResolved && c.exitPrice && (
              <>
                <span className={`text-[10px] ${priceTxt}`}>→</span>
                <span className={`text-[10px] font-mono font-bold ${
                  priceChange !== null && priceChange >= 0
                    ? dk ? "text-emerald-400" : "text-emerald-600"
                    : dk ? "text-red-400" : "text-red-600"
                }`}>
                  ${formatPrice(c.exitPrice)}
                  {priceChange !== null && ` (${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}%)`}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="text-right">
          <span className={`text-[12px] font-bold ${tfTxt}`}>{c.timeframe}</span>
          <p className={`text-[10px] mt-0.5 tabular-nums ${expTxt}`}>
            {isDone ? "closed" : `${timeLeft} left`}
          </p>
        </div>
      </div>

      {currentMsg && (
        <div className="flex items-start gap-2 min-h-[22px]">
          {currentMsg.avatar ? (
            <img src={currentMsg.avatar} alt="" className="w-5 h-5 rounded-full object-cover shrink-0 mt-0.5" />
          ) : (
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black shrink-0 mt-0.5 ${
              currentMsg.isOpener
                ? dk ? "bg-yellow-500/20 text-yellow-400" : "bg-yellow-100 text-yellow-600"
                : dk ? "bg-white/8 text-white/40" : "bg-gray-100 text-gray-500"
            }`}>
              {currentMsg.user.charAt(0).toUpperCase()}
            </span>
          )}
          <AnimatePresence mode="wait">
            <motion.p
              key={msgIdx}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3 }}
              className={`text-[12px] leading-snug font-bold ${
                currentMsg.isOpener
                  ? dk ? "text-yellow-400/80" : "text-yellow-600"
                  : dk ? "text-white/60" : "text-gray-700"
              }`}
            >
              "{currentMsg.text}"
              {!currentMsg.isOpener && (
                <span className={`not-italic font-normal ml-1.5 text-[10px] ${dk ? "text-white/25" : "text-gray-400"}`}>— {currentMsg.user}</span>
              )}
            </motion.p>
          </AnimatePresence>
        </div>
      )}

      <div className={`rounded-xl p-3 space-y-2.5 ${poolBox}`}>
        <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
          <motion.div animate={{ width: `${shortPct}%` }} transition={{ type: "spring", stiffness: 180, damping: 22 }}
            className={`h-full rounded-l-full ${isResolved && c.winnerSide === "short" ? "bg-red-500" : isResolved ? "bg-red-500/30" : "bg-red-500"}`} />
          <motion.div animate={{ width: `${longPct}%` }}  transition={{ type: "spring", stiffness: 180, damping: 22 }}
            className={`h-full rounded-r-full ${isResolved && c.winnerSide === "long" ? "bg-emerald-500" : isResolved ? "bg-emerald-500/30" : "bg-emerald-500"}`} />
        </div>
        <div className="flex justify-between items-end">
          <div className={isResolved && c.winnerSide === "long" ? "opacity-40" : ""}>
            <div className="flex items-center gap-1">
              <span className={`text-[11px] font-black ${isResolved && c.winnerSide === "short" ? "text-red-400" : "text-red-400"}`}>▼ SHORT</span>
              {!isDone && shortIsJuicy && <span className="text-[9px] font-bold text-yellow-500 bg-yellow-400/15 px-1.5 rounded-full">juicy</span>}
              {isResolved && c.winnerSide === "short" && <span className="text-[9px] font-bold text-red-400 bg-red-500/15 px-1.5 rounded-full">winner</span>}
            </div>
            <span className={`text-[16px] font-black ${dk ? "text-white" : "text-gray-900"}`}>${c.shortPool >= 1000 ? `${(c.shortPool/1000).toFixed(1)}k` : c.shortPool}</span>
            {!isDone && <p className={`text-[10px] font-bold ${multTxt}`}>→ {shortMult.toFixed(2)}x if right</p>}
            {isResolved && c.winnerSide === "short" && <p className={`text-[10px] font-bold ${dk ? "text-emerald-400" : "text-emerald-600"}`}>{shortMult.toFixed(2)}x payout</p>}
          </div>
          <div className={`text-right ${isResolved && c.winnerSide === "short" ? "opacity-40" : ""}`}>
            <div className="flex items-center gap-1 justify-end">
              {!isDone && longIsJuicy && <span className="text-[9px] font-bold text-yellow-500 bg-yellow-400/15 px-1.5 rounded-full">juicy</span>}
              {isResolved && c.winnerSide === "long" && <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/15 px-1.5 rounded-full">winner</span>}
              <span className="text-[11px] font-black text-emerald-400">LONG ▲</span>
            </div>
            <span className={`text-[16px] font-black ${dk ? "text-white" : "text-gray-900"}`}>${c.longPool >= 1000 ? `${(c.longPool/1000).toFixed(1)}k` : c.longPool}</span>
            {!isDone && <p className={`text-[10px] font-bold ${multTxt}`}>{longMult.toFixed(2)}x if right ←</p>}
            {isResolved && c.winnerSide === "long" && <p className={`text-[10px] font-bold ${dk ? "text-emerald-400" : "text-emerald-600"}`}>{longMult.toFixed(2)}x payout</p>}
          </div>
        </div>
      </div>

      <div className={`flex justify-between text-[10px] font-bold ${metaTxt}`}>
        <button
          onClick={(e) => { e.stopPropagation(); if (c.openerUsername) onViewProfile(c.openerUsername); }}
          className={`flex items-center gap-1.5 hover:opacity-70 transition-opacity ${c.openerUsername ? "cursor-pointer" : "cursor-default"}`}
        >
          {c.openerAvatar ? (
            <img src={c.openerAvatar} alt="" className="w-4 h-4 rounded-full object-cover" />
          ) : (
            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black ${dk ? "bg-white/10 text-white/50" : "bg-gray-200 text-gray-500"}`}>
              {(c.openerUsername ?? c.user).charAt(0).toUpperCase()}
            </span>
          )}
          <span>{c.user}</span>
        </button>
        <span>{formatAgo(c.openedAt)}</span>
      </div>

      {!isDone && (
        <AnimatePresence mode="wait">
          {activeSide === null ? (
            <motion.div key="btns" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1.5">
              {paperMode && (
                <div className="flex items-center gap-1.5 px-0.5">
                  <span className="text-[10px] font-black text-yellow-500 bg-yellow-400/15 px-2 py-0.5 rounded-full">PAPER</span>
                  <span className={`text-[10px] font-bold ${dk ? "text-white/25" : "text-gray-400"}`}>simulated bet — no real money</span>
                </div>
              )}
              <div className="flex gap-2">
                <motion.button whileTap={{ scale: 0.94 }} onClick={() => { setActiveSide("short"); setBetError(""); }}
                  className={`flex-1 py-2.5 rounded-xl text-[12px] font-black transition-all border ${
                    dk ? "bg-red-500/15 text-red-400 hover:bg-red-500/25 border-red-500/20"
                       : "bg-red-50 text-red-600 hover:bg-red-100 border-red-200"
                  }`}>▼ Short</motion.button>
                <motion.button whileTap={{ scale: 0.94 }} onClick={() => { setActiveSide("long"); setBetError(""); }}
                  className={`flex-1 py-2.5 rounded-xl text-[12px] font-black transition-all border ${
                    dk ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border-emerald-500/20"
                       : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-200"
                  }`}>Long ▲</motion.button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="picker" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[12px] font-black ${sideLabelCls(activeSide)}`}>
                    {activeSide === "short" ? "▼ Short" : "Long ▲"} · {activeSide === "short" ? shortMult.toFixed(2) : longMult.toFixed(2)}x
                  </span>
                  {paperMode && <span className="text-[9px] font-black text-yellow-500 bg-yellow-400/15 px-1.5 py-0.5 rounded-full">PAPER</span>}
                </div>
                <button onClick={() => { setActiveSide(null); setCustomAmt(""); setBetError(""); }} className={`text-[11px] font-bold ${cancelBtn}`}>✕</button>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {QUICK_AMOUNTS.map(a => (
                  <button key={a} onClick={() => handleQuick(a)} disabled={betLoading}
                    className={`py-2 rounded-xl text-[11px] font-black transition-all disabled:opacity-50 ${amtIdle}`}>${a}</button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>$</span>
                  <input autoFocus type="number" placeholder="custom" value={customAmt}
                    onChange={e => setCustomAmt(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleCustom()}
                    className={`w-full text-[12px] font-bold pl-6 pr-3 py-2 rounded-xl outline-none ${inputCls}`} />
                </div>
                <button onClick={handleCustom} disabled={betLoading}
                  className={`px-4 py-2 rounded-xl text-[12px] font-black transition-all disabled:opacity-50 ${addBtnCls(activeSide)}`}>
                  {betLoading ? "…" : "Add"}
                </button>
              </div>
              {betError && (
                <p className={`text-[11px] font-bold px-2 py-1.5 rounded-lg ${dk ? "text-red-400 bg-red-500/10" : "text-red-600 bg-red-50"}`}>
                  {betError}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {isCancelled && (
        <p className={`text-[11px] font-bold text-center py-1 ${dk ? "text-white/30" : "text-gray-400"}`}>
          Market cancelled — all positions refunded
        </p>
      )}
    </motion.div>
  );
}

// ─── FilterBar ────────────────────────────────────────────────────────────────

type FilterBarProps = {
  dk: boolean; navBorder: string;
  filter: Filter; setFilter: (v: Filter) => void;
  marketCapMax: number | null; setMarketCapMax: (v: number | null) => void;
  minPool: number | null; setMinPool: (v: number | null) => void;
  poolSortDir: "asc" | "desc" | null; setPoolSortDir: (v: "asc" | "desc" | null) => void;
  statusFilter: "open" | "closed"; setStatusFilter: (v: "open" | "closed") => void;
};

function FilterBar({ dk, navBorder, filter, setFilter, marketCapMax, setMarketCapMax, minPool, setMinPool, poolSortDir, setPoolSortDir, statusFilter, setStatusFilter }: FilterBarProps) {
  const [open, setOpen] = useState(false);

  const activeCount = [filter !== "all", marketCapMax !== null, minPool !== null, poolSortDir !== null].filter(Boolean).length;

  const btnBase = dk
    ? "border border-white/8 text-[11px] font-black px-3 py-1.5 rounded-xl transition-all"
    : "border border-gray-200 text-[11px] font-black px-3 py-1.5 rounded-xl transition-all";
  const btnActive   = dk ? "bg-white/14 text-white"              : "bg-gray-200 text-gray-900";
  const btnInactive = dk ? "bg-transparent text-white/35 hover:text-white/60 hover:bg-white/6" : "bg-transparent text-gray-400 hover:text-gray-700 hover:bg-gray-50";

  const chipOn  = dk ? "bg-white text-black"    : "bg-gray-900 text-white";
  const chipOff = dk ? "bg-white/6 text-white/40 hover:bg-white/10 hover:text-white/70 border border-white/8" : "bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-700 border border-gray-200";

  function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
      <button onClick={onClick} className={`text-[11px] font-black px-3 py-1.5 rounded-xl transition-all ${active ? chipOn : chipOff}`}>
        {label}
      </button>
    );
  }

  function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
      <div className="flex items-center gap-2">
        <span className={`text-[9px] font-black uppercase tracking-widest w-[62px] shrink-0 ${dk ? "text-white/20" : "text-gray-400"}`}>{label}</span>
        <div className="flex items-center gap-1.5 flex-wrap">{children}</div>
      </div>
    );
  }

  // Active pill tags
  const activePills = [
    filter !== "all"       ? { label: filter === "hot" ? "🔥 Hot" : "🍋 Juicy", clear: () => setFilter("all") }         : null,
    marketCapMax !== null  ? { label: `Cap <${marketCapMax >= 1_000_000 ? "$1M" : marketCapMax >= 1_000 ? `$${marketCapMax / 1000}K` : `$${marketCapMax}`}`, clear: () => setMarketCapMax(null) } : null,
    minPool !== null       ? { label: `Pool >$${minPool}`, clear: () => setMinPool(null) }                              : null,
    poolSortDir !== null   ? { label: poolSortDir === "asc" ? "Pool ↑" : "Pool ↓", clear: () => setPoolSortDir(null) } : null,
  ].filter(Boolean) as { label: string; clear: () => void }[];

  return (
    <div className={`shrink-0 border-b ${navBorder}`}>
      <div className="flex items-center gap-2 px-4 md:px-5 py-2">
        {/* Open / Closed status toggle */}
        <div className={`flex items-center rounded-xl p-0.5 border text-[11px] font-black shrink-0 ${dk ? "bg-white/4 border-white/8" : "bg-gray-100 border-gray-200"}`}>
          <button onClick={() => setStatusFilter("open")}
            className={`px-3 py-1 rounded-[9px] transition-all ${statusFilter === "open"
              ? (dk ? "bg-white text-black" : "bg-white text-gray-900 shadow-sm")
              : (dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700")
            }`}>
            Open
          </button>
          <button onClick={() => setStatusFilter("closed")}
            className={`px-3 py-1 rounded-[9px] transition-all ${statusFilter === "closed"
              ? (dk ? "bg-white text-black" : "bg-white text-gray-900 shadow-sm")
              : (dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700")
            }`}>
            Closed
          </button>
        </div>

        {/* Active filter pills */}
        <div className="flex items-center gap-1.5 flex-1 overflow-x-auto scrollbar-none">
          {activePills.map(p => (
            <button key={p.label} onClick={p.clear}
              className={`flex items-center gap-1 shrink-0 text-[11px] font-black px-2.5 py-1 rounded-xl transition-all ${dk ? "bg-white/10 text-white/70 hover:bg-white/6" : "bg-gray-100 text-gray-600 hover:bg-gray-50"}`}>
              {p.label} <span className="text-[9px] opacity-50">✕</span>
            </button>
          ))}
        </div>

        {/* Filters popup button — right aligned */}
        <div className="relative shrink-0">
          <button onClick={() => setOpen(o => !o)} className={`flex items-center gap-1.5 ${btnBase} ${open || activeCount > 0 ? btnActive : btnInactive}`}>
            <span>Filters</span>
            {activeCount > 0 && (
              <span className={`text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center ${dk ? "bg-white/25 text-white" : "bg-gray-400 text-white"}`}>
                {activeCount}
              </span>
            )}
            <span className={`text-[9px] transition-transform duration-150 ${open ? "rotate-180" : ""}`}>▾</span>
          </button>

          {/* Floating bubble — same style as ScoutFilterBar */}
          <AnimatePresence>
            {open && (
              <>
                {/* click-away overlay */}
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.97, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className={`absolute right-0 top-full mt-1 z-20 rounded-2xl border p-3 space-y-2.5 min-w-[260px] ${dk ? "bg-[#161616] border-white/10 shadow-2xl" : "bg-white border-gray-200 shadow-xl"}`}
                >
                  {statusFilter === "open" && (
                    <Row label="Quality">
                      <Chip label="All"      active={filter === "all"}   onClick={() => setFilter("all")} />
                      <Chip label="🔥 Hot"   active={filter === "hot"}   onClick={() => setFilter("hot")} />
                      <Chip label="🍋 Juicy" active={filter === "juicy"} onClick={() => setFilter("juicy")} />
                    </Row>
                  )}
                  <Row label="Mkt Cap">
                    <Chip label="Any"    active={marketCapMax === null}       onClick={() => setMarketCapMax(null)} />
                    <Chip label="<$20K"  active={marketCapMax === 20_000}     onClick={() => setMarketCapMax(20_000)} />
                    <Chip label="<$100K" active={marketCapMax === 100_000}    onClick={() => setMarketCapMax(100_000)} />
                    <Chip label="<$1M"   active={marketCapMax === 1_000_000}  onClick={() => setMarketCapMax(1_000_000)} />
                  </Row>
                  {statusFilter === "open" && (
                    <Row label="Min Pool">
                      <Chip label="Any"   active={minPool === null} onClick={() => setMinPool(null)} />
                      <Chip label=">$50"  active={minPool === 50}   onClick={() => setMinPool(50)} />
                      <Chip label=">$250" active={minPool === 250}  onClick={() => setMinPool(250)} />
                      <Chip label=">$1K"  active={minPool === 1000} onClick={() => setMinPool(1000)} />
                    </Row>
                  )}
                  <Row label="Sort">
                    <Chip label="Default" active={poolSortDir === null}   onClick={() => setPoolSortDir(null)} />
                    <Chip label="Pool ↑"  active={poolSortDir === "asc"}  onClick={() => setPoolSortDir("asc")} />
                    <Chip label="Pool ↓"  active={poolSortDir === "desc"} onClick={() => setPoolSortDir("desc")} />
                  </Row>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ─── TrendingFilterBar ────────────────────────────────────────────────────────

function TrendingFilterBar({ dk, chain, setChain, sort, setSort }: {
  dk: boolean;
  chain: string | null; setChain: (v: string | null) => void;
  sort: "mcap-desc" | "mcap-asc" | "vol-desc" | "vol-asc" | null;
  setSort: (v: "mcap-desc" | "mcap-asc" | "vol-desc" | "vol-asc" | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = [chain !== null, sort !== null].filter(Boolean).length;

  const btnBase = `border text-[11px] font-black px-3 py-1.5 rounded-xl transition-all ${dk ? "border-white/8" : "border-gray-200"}`;
  const btnOn  = dk ? "bg-white/14 text-white" : "bg-gray-200 text-gray-900";
  const btnOff = dk ? "bg-transparent text-white/35 hover:text-white/60 hover:bg-white/6" : "bg-transparent text-gray-400 hover:text-gray-700 hover:bg-gray-50";
  const chipOn  = dk ? "bg-white text-black" : "bg-gray-900 text-white";
  const chipOff = dk ? "bg-white/6 text-white/40 hover:bg-white/10 hover:text-white/70 border border-white/8" : "bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-700 border border-gray-200";

  function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return <button onClick={onClick} className={`text-[11px] font-black px-3 py-1.5 rounded-xl transition-all ${active ? chipOn : chipOff}`}>{label}</button>;
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className={`flex items-center gap-1.5 ${btnBase} ${open || activeCount > 0 ? btnOn : btnOff}`}>
        <span>Filters</span>
        {activeCount > 0 && (
          <span className={`text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center ${dk ? "bg-white/25 text-white" : "bg-gray-400 text-white"}`}>
            {activeCount}
          </span>
        )}
        <span className={`text-[9px] transition-transform duration-150 ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.12 }}
            className={`absolute right-0 top-full mt-1 z-20 rounded-2xl border p-3 space-y-2.5 min-w-[260px] ${dk ? "bg-[#161616] border-white/10 shadow-2xl" : "bg-white border-gray-200 shadow-xl"}`}
          >
            <div className="flex items-center gap-2">
              <span className={`text-[9px] font-black uppercase tracking-widest w-[40px] shrink-0 ${dk ? "text-white/20" : "text-gray-400"}`}>Chain</span>
              <div className="flex gap-1.5 flex-wrap">
                <Chip label="All"  active={chain === null}    onClick={() => setChain(null)} />
                <Chip label="SOL"  active={chain === "SOL"}   onClick={() => setChain("SOL")} />
                <Chip label="ETH"  active={chain === "ETH"}   onClick={() => setChain("ETH")} />
                <Chip label="BASE" active={chain === "BASE"}  onClick={() => setChain("BASE")} />
                <Chip label="BSC"  active={chain === "BSC"}   onClick={() => setChain("BSC")} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[9px] font-black uppercase tracking-widest w-[40px] shrink-0 ${dk ? "text-white/20" : "text-gray-400"}`}>Sort</span>
              <div className="flex gap-1.5 flex-wrap">
                <Chip label="Trend ↑"   active={sort === null}         onClick={() => setSort(null)} />
                <Chip label="MCap ↓"    active={sort === "mcap-desc"}  onClick={() => setSort("mcap-desc")} />
                <Chip label="MCap ↑"    active={sort === "mcap-asc"}   onClick={() => setSort("mcap-asc")} />
                <Chip label="Vol 24h ↓" active={sort === "vol-desc"}   onClick={() => setSort("vol-desc")} />
                <Chip label="Vol 24h ↑" active={sort === "vol-asc"}    onClick={() => setSort("vol-asc")} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// TrendingTokenCard moved to src/screens/DiscoverScreen.tsx

// ─── TapeSidebar ──────────────────────────────────────────────────────────────

type TapeEntry = {
  uid: string; symbol: string; side: "short" | "long";
  amount: number; message: string; user: string; ts: number;
  isOpen: boolean; isOpener?: boolean;
};

function TapeSidebar({ challenges, onViewCoin, onViewToken, dk, tapeBorder, sidebarLabel, tapeColLabel, open, onToggle, onViewProfile, paperMode }: {
  challenges: Challenge[]; onViewCoin: (symbol: string) => void; onViewToken?: (symbol: string) => void; dk: boolean;
  tapeBorder: string; sidebarLabel: string; tapeColLabel: string; open: boolean; onToggle: () => void; paperMode?: boolean;
  onViewProfile?: (username: string) => void;
}) {
  const toEntries = (cs: Challenge[]) =>
    [...cs].reverse().slice(0, 40).map(c => ({
      uid: `init-${c.id}`,
      symbol: c.symbol,
      side: (c.longPool >= c.shortPool ? "long" : "short") as "long" | "short",
      amount: Math.round(c.longPool + c.shortPool),
      message: c.tagline,
      user: c.openerUsername ?? c.user,
      ts: Date.now() - c.openedAt * 1000,
      isOpen: c.status === "open",
      isOpener: true,
    }));

  const [entries, setEntries] = useState<TapeEntry[]>(() => toEntries(challenges));
  const scrollRef = useRef<HTMLDivElement>(null);

  // Merge in real position messages from /positions/recent
  useEffect(() => {
    async function loadPositions() {
      try {
        const recent = await api.getRecentPositions(paperMode);
        const posEntries: TapeEntry[] = recent.map(p => ({
          uid: `pos-${p.id}`,
          symbol: p.symbol,
          side: p.side,
          amount: Math.round(parseFloat(p.amount)),
          message: p.message ?? "",
          user: p.username,
          ts: new Date(p.placed_at).getTime(),
          isOpen: p.status === "open",
          isOpener: p.is_opener,
        }));
        // Replace entries completely — no stale data
        const marketEntries = toEntries(challenges);
        const all = [...posEntries, ...marketEntries];
        const seen = new Set<string>();
        const deduped = all.filter(e => { if (seen.has(e.uid)) return false; seen.add(e.uid); return true; });
        setEntries(deduped.sort((a, b) => b.ts - a.ts).slice(0, 60));
      } catch {}
    }
    loadPositions();
    const iv = setInterval(loadPositions, 30_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    setEntries(toEntries(challenges));
  }, [challenges]);

  const rowBg  = dk ? "hover:bg-white/4" : "hover:bg-gray-100";
  const divider = dk ? "border-white/4" : "border-gray-200";
  const amtTxt = dk ? "text-white/50" : "text-gray-800 font-black";
  const msgTxt = dk ? "text-white/30" : "text-gray-700";
  const userTxt = dk ? "text-white/20" : "text-gray-600";

  if (entries.length === 0) return null;

  return (
    <div style={{ width: open ? "250px" : "32px", minWidth: open ? "250px" : "32px" }} className={`shrink-0 border-l ${tapeBorder} flex flex-col overflow-hidden transition-all duration-200`}>
      <div className="px-3 py-2.5 shrink-0 flex items-center justify-between">
        {open && (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <p className={`text-[9px] font-black tracking-widest uppercase ${sidebarLabel}`}>Tape</p>
          </div>
        )}
        <button onClick={onToggle}
          className={`${open ? "ml-auto" : "mx-auto"} flex items-center justify-center w-6 h-6 rounded-lg text-[12px] font-black transition-all ${dk ? "bg-white/6 hover:bg-white/12 text-white/40 hover:text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-700"}`}>
          {open ? "›" : "‹"}
        </button>
      </div>
      {!open && (
        <button onClick={onToggle} className={`mx-auto mt-4 flex flex-col items-center gap-1 ${dk ? "text-white/20 hover:text-white/40" : "text-gray-300 hover:text-gray-500"} transition-colors`}>
          {"TAPE".split("").map((c, i) => (
            <span key={i} className="text-[8px] font-black leading-none">{c}</span>
          ))}
        </button>
      )}

      {open && (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <AnimatePresence initial={false}>
            {entries.map(e => (
              <motion.div key={e.uid} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
                className={`px-4 py-3 border-b ${divider} ${rowBg} transition-colors cursor-pointer`}
                onClick={() => onViewCoin(e.symbol)}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[12px] font-black ${e.side === "long" ? "text-emerald-400" : "text-red-400"}`}>{e.side === "long" ? "▲" : "▼"}</span>
                  <button
                    onClick={ev => { ev.stopPropagation(); onViewToken?.(e.symbol); }}
                    className={`text-[13px] font-black ${dk ? "text-white" : "text-gray-900"} ${onViewToken ? "hover:opacity-60 transition-opacity" : ""}`}
                  >${e.symbol}</button>
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ml-0.5 ${
                    e.isOpen
                      ? dk ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                      : dk ? "bg-white/8 text-white/25"           : "bg-gray-100 text-gray-400"
                  }`}>{e.isOpen ? "open" : "closed"}</span>
                  <span className={`text-[12px] font-bold ml-auto ${amtTxt}`}>${e.amount}</span>
                </div>
                {e.message && (
                  <div className="flex items-center gap-2">
                    <p className={`text-[11px] italic line-clamp-2 leading-snug flex-1 ${e.isOpener ? (dk ? "text-yellow-400/70" : "text-yellow-600") : msgTxt}`}>"{e.message}"</p>
                    <span
                      className={`text-[10px] font-bold shrink-0 ${userTxt} ${onViewProfile ? "cursor-pointer hover:opacity-60 transition-opacity" : ""}`}
                      onClick={(ev) => { ev.stopPropagation(); if (onViewProfile && e.user) onViewProfile(e.user); }}
                    >{e.user}</span>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

