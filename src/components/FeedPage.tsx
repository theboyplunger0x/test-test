"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Challenge } from "@/lib/mockChallenges";
import ChallengeCard from "./ChallengeCard";
import FilterBar, { type Filter } from "./FilterBar";
import TapeSidebar from "./TapeSidebar";
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
import WithdrawVaultModal from "./WithdrawVaultModal";
import LeaderboardView from "./LeaderboardView";
import ProfileModal from "./ProfileModal";
import ProfilePage from "./ProfilePage";
import NotificationsPanel from "./NotificationsPanel";
import TokenProfilePage from "./TokenProfilePage";
import ChartModal from "./ChartModal";
import SpotView from "./SpotView";
import { type Call } from "./CallCard";
import { type Debate } from "./DebateCard";
import { api, User, AuthResponse, Market } from "@/lib/api";
import { useTradingMode } from "@/hooks/useTradingMode";
import { usePrivyWallet } from "@/hooks/usePrivyWallet";
import { useAppTheme } from "@/hooks/useAppTheme";
import { useVault } from "@/hooks/useVault";
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
import CallsScreen from "@/screens/CallsScreen";
import type { TokenInfo } from "@/lib/chartData";
import { fetchTrending } from "@/lib/chartData";

import type { MainTab } from "@/lib/navTypes";
type Theme = "dark" | "light";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "24h"];
const TF_ICONS: Record<string, string> = {
  "1m":  "·",
  "5m":  "≡",
  "15m": "◌",
  "1h":  "◔",
  "4h":  "◑",
  "24h": "↗",
};

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
  const vault = useVault(walletAddr);
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
  const [settingsInitialView, setSettingsInitialView] = useState<"main" | "wallet">("main");
  const [withdrawVaultOpen, setWithdrawVaultOpen]   = useState(false);
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
    // In Real mode, check vault balance (on-chain), not DB balance
    const realBalance = isReal ? parseFloat(vault.vaultBalance || "0") : Number(user.balance_usd);
    if (!paperMode && realBalance <= 0) {
      if (isReal) {
        setSettingsInitialView("wallet");
        setSettingsOpen(true);
      } else {
        setDepositOpen(true);
      }
      return;
    }
    setOpenMarketCoin(coin);
  }

  async function handleAdd(id: string, side: "short" | "long", amount: number, message?: string, faded_position_id?: string, onchainMarketIdOverride?: number): Promise<string | null> {
    if (!user) { setAuthOpen(true); return null; }
    // Mock challenges have simple numeric IDs; real markets have UUIDs
    const isRealMarket = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isRealMarket) return "Demo data — open a real market on any coin to trade.";

    // Real mode: sign bet on-chain via EIP-712 before sending to backend.
    let signature: string | undefined;
    let sigWallet: string | undefined;
    if (isReal) {
      const onchainId = onchainMarketIdOverride ?? markets.find(m => m.id === id)?.onchain_market_id;
      if (!walletAddr) return "Connect a wallet to bet in Real mode.";
      if (onchainId == null) return "This market has no on-chain ID — cannot sign bet. Try creating a new market.";
      const sig = await vault.signBet(onchainId, side, amount);
      if (!sig) return "Signature rejected — bet not placed.";
      signature = sig;
      sigWallet = walletAddr;
    }

    try {
      const result = await api.placeBet(id, side, amount, paperMode, message, faded_position_id, signature, sigWallet);
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
      // Real mode: refresh vault balance immediately after bet (don't wait for 15s poll)
      if (isReal && walletAddr) {
        vault.refreshBalance();
      }
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
    if (!paperMode && !isTestnet && (isReal ? parseFloat(vault.vaultBalance || "0") : Number(user.balance_usd)) < amount) return "Insufficient balance.";
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
    return handleAdd(market.id, side, amount, undefined, undefined, market.onchain_market_id ?? undefined);
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
    if (!paperMode && !isTestnet && (isReal ? parseFloat(vault.vaultBalance || "0") : Number(user.balance_usd)) < amount) return "Insufficient balance.";
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

    // Pass onchain_market_id explicitly — if market was just created, it won't
    // be in the React state yet (closure captures the old `markets` array).
    let err = await handleAdd(market.id, side, amount, undefined, undefined, market.onchain_market_id ?? undefined);

    // If market expired in the DB (race condition — common for short timeframes like 1m),
    // mark it resolved locally and create a fresh one
    if (err && (err.toLowerCase().includes("expired") || err.toLowerCase().includes("closed") || err.toLowerCase().includes("not found"))) {
      setMarkets(prev => prev.map(m => m.id === market!.id ? { ...m, status: "resolved" as const } : m));
      try {
        const fresh = await createFreshMarket();
        err = await handleAdd(fresh.id, side, amount, undefined, undefined, fresh.onchain_market_id ?? undefined);
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
    if (!paperMode && !isTestnet && (isReal ? parseFloat(vault.vaultBalance || "0") : Number(user.balance_usd)) < amount) return "Insufficient balance.";
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
    if (!paperMode && !isTestnet && (isReal ? parseFloat(vault.vaultBalance || "0") : Number(user.balance_usd)) < amount) return "Insufficient balance.";
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
                vaultBalance={vault.vaultBalance}
              />

              {/* Action button — routing lives here, button stays dumb. */}
              {/* User is guaranteed truthy here (parent {user ? ...} branch). */}
              <FundingCTA
                onClick={() => {
                  if (paperMode) {
                    setPaperCreditOpen(true);
                  } else if (!walletAddr) {
                    setPendingFundAfterConnect(false);
                    setConnectWalletOpen(true);
                  } else if (isReal) {
                    // Real mode → open wallet drawer directly to vault deposit.
                    setSettingsInitialView("wallet");
                    setSettingsOpen(true);
                  } else {
                    // Testnet → Privy fund flow.
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
            onClick={() => { setSettingsInitialView("main"); setSettingsOpen(true); }}
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
          <CallsScreen
            dk={dk}
            calls={calls}
            debates={debates}
            callsLoading={callsLoading}
            callsFilter={callsFilter}
            setCallsFilter={setCallsFilter}
            loggedIn={!!user}
            onAuthRequired={() => setAuthOpen(true)}
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
            onMakeCall={() => setMainTab("trending")}
            onFadeCall={async (call, side, amount) => {
              if (!call.market_id) return "Cannot fade — market not found.";
              return handleAdd(call.market_id, side, amount, undefined, call.id);
            }}
            onFadeDebate={(marketId, side) => handleAdd(marketId, side, 25)}
          />
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
            onPlaceBet={(marketId, side, amount, onchainId) => handleAdd(marketId, side, amount, undefined, undefined, onchainId)}
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
        {referralOpen && <ReferralModal dk={dk} isLoggedIn={!!user} onClose={() => setReferralOpen(false)} onSignIn={() => setAuthOpen(true)}
          rewardBalance={vault.rewardBalance} onClaimOnChain={vault.claimRewardsOnChain} />}
      </AnimatePresence>

      {/* Withdraw Vault Modal — Real mode dedicated withdrawal */}
      <AnimatePresence>
        {withdrawVaultOpen && walletAddr && (
          <WithdrawVaultModal
            dk={dk}
            onClose={() => setWithdrawVaultOpen(false)}
            vaultBalance={vault.vaultBalance}
            rewardBalance={vault.rewardBalance}
            walletAddr={walletAddr}
            onWithdraw={async (amt) => { await vault.withdrawFromVault(amt); vault.refreshBalance(); }}
            onClaimRewards={async () => { await vault.claimRewardsOnChain(); vault.refreshBalance(); }}
          />
        )}
      </AnimatePresence>

      {/* Account drawer (with drill-down to Wallet) */}
      <AccountDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialView={settingsInitialView}
        dk={dk}
        user={user}
        wallet={wallet}
        tradingMode={tradingMode}
        onTradingModeChange={setTradingMode}
        notificationsEnabled={notificationsEnabled}
        tradePresets={tradePresets}
        onTradePresetsChange={setTradePresets}
        onToggleNotifications={toggleNotifications}
        onToggleDarkMode={() => setTheme(dk ? "light" : "dark")}
        onOpenReferrals={() => setReferralOpen(true)}
        onLogout={handleLogout}
        vaultBalance={vault.vaultBalance}
        onVaultDeposit={vault.depositToVault}
        onVaultWithdraw={vault.withdrawFromVault}
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
              <div className={`flex items-center gap-3 px-5 py-4 border-b shrink-0 ${T.drawerHeader}`}>
                <span className="text-[15px] font-black flex-1">Your Profile</span>
                {/* Trading mode pill — mobile only (desktop has header toggle) */}
                <div className={`md:hidden flex items-center rounded-lg border overflow-hidden text-[10px] font-black ${dk ? "border-white/10" : "border-gray-200"}`}>
                  {(["paper", "real"] as const).map(m => (
                    <button key={m} onClick={() => setTradingMode(m)}
                      className={`px-2 py-1 transition-all ${
                        tradingMode === m
                          ? m === "paper" ? "bg-yellow-400 text-black" : "bg-emerald-500 text-white"
                          : dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700"
                      }`}>
                      {m === "paper" ? "Paper" : "Real"}
                    </button>
                  ))}
                </div>
                {/* Settings gear */}
                <button onClick={() => { setOrdersOpen(false); setSettingsInitialView("main"); setSettingsOpen(true); }}
                  className={`flex items-center justify-center w-8 h-8 rounded-xl transition-all ${dk ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-600"}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="2"/>
                  </svg>
                </button>
                <button onClick={() => setOrdersOpen(false)} className={`text-[18px] font-bold transition-colors ${T.drawerClose}`}>✕</button>
              </div>
              <div className="flex-1 overflow-hidden flex flex-col">
                <OrdersView dk={dk} balance={isReal ? vault.vaultBalance : user?.balance_usd} useExternalBalance={isReal} notificationsEnabled={notificationsEnabled} paperMode={paperMode}
                  rewardBalance={vault.rewardBalance}
                  onClaimOnChain={vault.claimRewardsOnChain}
                  onOpenWalletDrawer={() => setWithdrawVaultOpen(true)}
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
        accountActive={ordersOpen}
        onNavigate={(tab) => {
          setSettingsOpen(false);
          setProfilePageUser(null);
          setMainTab(tab);
          setTokenProfileToken(null);
        }}
        onOpenAccount={() => {
          if (user) setOrdersOpen(true);
          else setAuthOpen(true);
        }}
      />
    </div>
  );
}

