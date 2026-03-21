"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, Position, ReferralStats } from "../lib/api";

// ─── local display type ────────────────────────────────────────────────────────

type OrderStatus = "open" | "live" | "won" | "lost" | "cancelled";

type Order = {
  id: string;
  symbol: string;
  direction: "long" | "short";
  amount: number;
  timeframe: string;
  status: OrderStatus;
  myPool: number;
  otherPool: number;
  entryPrice: number;
  openedAt: number;
  expiresAt: number;
  isOpener: boolean;
  isPaper: boolean;
};

// ─── helpers ───────────────────────────────────────────────────────────────────

function positionToOrder(p: Position): Order {
  const myPool   = parseFloat(p.side === "long" ? p.long_pool  : p.short_pool);
  const otherPool = parseFloat(p.side === "long" ? p.short_pool : p.long_pool);

  let status: OrderStatus;
  if (p.market_status === "resolved") {
    status = p.winner_side === p.side ? "won" : "lost";
  } else if (p.market_status === "cancelled") {
    status = "cancelled";
  } else {
    status = p.market_status as "open" | "live";
  }

  return {
    id:         p.id,
    symbol:     p.symbol,
    direction:  p.side,
    amount:     parseFloat(p.amount_usd),
    timeframe:  p.timeframe,
    status,
    myPool,
    otherPool,
    entryPrice: parseFloat(p.entry_price),
    openedAt:   new Date(p.placed_at).getTime(),
    expiresAt:  new Date(p.closes_at).getTime(),
    isOpener:   p.opener_id === p.user_id,
    isPaper:    p.is_paper ?? false,
  };
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function calcPayout(o: Order): number {
  if (o.otherPool === 0) return o.amount;
  return o.amount * (1 + (o.otherPool * 0.95) / o.myPool);
}

// ─── withdraw modal ────────────────────────────────────────────────────────────

function WithdrawModal({
  balance,
  dk,
  onClose,
  onSuccess,
}: {
  balance: number;
  dk: boolean;
  onClose: () => void;
  onSuccess: (newBalance: string) => void;
}) {
  const [amount, setAmount]     = useState("");
  const [address, setAddress]   = useState("");
  const [chain, setChain]       = useState<"base" | "sol">("base");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const inputCls = dk
    ? "bg-white/5 border-white/10 text-white placeholder:text-white/20"
    : "bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400";

  async function submit() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return setError("Enter a valid amount");
    if (amt < 5)          return setError("Minimum withdrawal is $5");
    if (amt > balance)    return setError("Insufficient balance");
    if (!address)         return setError("Enter a wallet address");

    setLoading(true);
    setError(null);
    try {
      const res = await api.withdraw(amt, chain, address);
      onSuccess(res.new_balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`absolute inset-0 ${dk ? "bg-black/60" : "bg-black/30"}`} onClick={onClose} />
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        className={`relative w-full max-w-md rounded-t-3xl p-6 space-y-4 ${dk ? "bg-[#0f0f0f] border-t border-white/8" : "bg-white border-t border-gray-200"}`}
      >
        <div className="flex items-center justify-between">
          <p className={`text-[15px] font-black ${dk ? "text-white" : "text-gray-900"}`}>Withdraw</p>
          <button onClick={onClose} className={`text-[11px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>✕ close</button>
        </div>

        {/* chain selector */}
        <div className="flex gap-2">
          {(["base", "sol"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setChain(c)}
              className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
                chain === c
                  ? dk ? "bg-white text-black" : "bg-gray-900 text-white"
                  : dk ? "bg-white/5 text-white/40" : "bg-gray-100 text-gray-400"
              }`}
            >
              {c === "base" ? "Base (USDC)" : "Solana (USDC)"}
            </button>
          ))}
        </div>

        {/* amount */}
        <div>
          <p className={`text-[10px] font-bold mb-1.5 ${dk ? "text-white/30" : "text-gray-400"}`}>Amount (USD)</p>
          <div className="relative">
            <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold ${dk ? "text-white/40" : "text-gray-400"}`}>$</span>
            <input
              type="number"
              min={5}
              max={balance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={`w-full pl-7 pr-16 py-3 rounded-xl border text-[14px] font-black outline-none ${inputCls}`}
            />
            <button
              onClick={() => setAmount(balance.toFixed(2))}
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black ${dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"}`}
            >
              MAX
            </button>
          </div>
          <p className={`text-[10px] mt-1 ${dk ? "text-white/20" : "text-gray-400"}`}>
            Available: ${balance.toFixed(2)} · Min $5
          </p>
        </div>

        {/* address */}
        <div>
          <p className={`text-[10px] font-bold mb-1.5 ${dk ? "text-white/30" : "text-gray-400"}`}>
            {chain === "base" ? "EVM Wallet Address" : "Solana Wallet Address"}
          </p>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={chain === "base" ? "0x..." : "So1..."}
            className={`w-full px-3 py-3 rounded-xl border text-[12px] font-mono outline-none ${inputCls}`}
          />
        </div>

        {error && (
          <p className="text-[11px] font-bold text-red-400">{error}</p>
        )}

        <button
          onClick={submit}
          disabled={loading}
          className={`w-full py-3.5 rounded-xl text-[13px] font-black transition-all ${
            loading
              ? dk ? "bg-white/10 text-white/30" : "bg-gray-100 text-gray-400"
              : dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-gray-700"
          }`}
        >
          {loading ? "Processing…" : "Request Withdrawal"}
        </button>
        <p className={`text-center text-[10px] ${dk ? "text-white/20" : "text-gray-400"}`}>
          Processed within 24h during beta.
        </p>
      </motion.div>
    </motion.div>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

function fireNotification(title: string, body: string) {
  if (typeof window === "undefined" || Notification.permission !== "granted") return;
  try { new Notification(title, { body, icon: "/favicon.ico" }); } catch {}
}

const SEAL = "M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.233-.784.187-1.324.068-1.934-.234-1.173-1.044-2.053-2.176-2.413-.564-.18-1.167-.17-1.726.028-.56.197-1.053.556-1.411 1.032C12.56 3.09 11.68 2.595 10.75 2.5c-1.077-.109-2.096.41-2.698 1.332-.285.434-.431.942-.421 1.456.01.514.178 1.015.484 1.437-.634.2-1.204.571-1.648 1.072-.444.502-.74 1.11-.853 1.765-.138.78-.017 1.587.346 2.291.363.704.939 1.266 1.644 1.603-.12.59-.15 1.196-.086 1.796.113 1.065.565 2.067 1.287 2.854.722.787 1.685 1.32 2.738 1.52.488.092.99.1 1.485.023.447 1.017 1.275 1.835 2.311 2.299 1.037.465 2.208.538 3.296.203.548-.17 1.048-.466 1.461-.862.413-.395.728-.879.919-1.414.19-.534.249-1.106.172-1.669.577-.265 1.074-.675 1.44-1.19.366-.513.588-1.112.644-1.737.056-.625-.056-1.254-.325-1.82-.269-.565-.682-1.05-1.197-1.406z";
const CHECK = "M9.611 12.851L7.29 10.53l-.927.948 3.248 3.2 6.912-6.83-.95-.943-5.962 5.946z";

function TierBadge({ tier }: { tier: string }) {
  if (tier === "top") return (
    <svg aria-label="Top tier" width="14" height="14" viewBox="0 0 22 22" fill="none" className="inline-block align-middle shrink-0">
      <path d={SEAL} fill="#F4C43B"/><path d={CHECK} fill="white"/>
    </svg>
  );
  if (tier === "normal") return (
    <svg aria-label="Normal tier" width="14" height="14" viewBox="0 0 22 22" fill="none" className="inline-block align-middle shrink-0">
      <path d={SEAL} fill="#1D9BF0"/><path d={CHECK} fill="white"/>
    </svg>
  );
  return null;
}

export default function OrdersView({ dk, balance: balanceProp, notificationsEnabled }: { dk: boolean; balance?: string; notificationsEnabled?: boolean }) {
  const [orders, setOrders]           = useState<Order[]>([]);
  const [balance, setBalance]         = useState<number>(parseFloat(balanceProp ?? "0") || 0);
  const [loading, setLoading]         = useState(true);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [tick, setTick]               = useState(0);
  const prevStatusRef                 = useRef<Map<string, OrderStatus>>(new Map());
  const [referral, setReferral]       = useState<ReferralStats | null>(null);
  const [claiming, setClaiming]       = useState(false);
  const [claimDone, setClaimDone]     = useState(false);

  // sync balance prop changes (from parent auth refresh)
  useEffect(() => {
    const val = parseFloat(balanceProp ?? "0");
    if (!isNaN(val)) setBalance(val);
  }, [balanceProp]);

  const fetchPortfolio = useCallback(async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) { setLoading(false); return; }
    try {
      const data = await api.portfolio();
      setBalance(parseFloat(data.balance) || 0);
      const newOrders = data.positions.map(positionToOrder);
      // Fire notifications for newly resolved positions
      if (notificationsEnabled) {
        for (const o of newOrders) {
          const prev = prevStatusRef.current.get(o.id);
          if (prev && prev !== o.status && (o.status === "won" || o.status === "lost")) {
            const payout = calcPayout(o);
            fireNotification(
              o.status === "won" ? `You won $${payout.toFixed(2)}! 🎉` : `Position closed ❌`,
              `$${o.symbol} ${o.direction.toUpperCase()} ${o.timeframe} — ${o.status === "won" ? `+$${(payout - o.amount).toFixed(2)} profit` : `-$${o.amount} loss`}`
            );
          }
        }
      }
      prevStatusRef.current = new Map(newOrders.map((o) => [o.id, o.status]));
      setOrders(newOrders);
    } catch {
      // not authed or network error — leave empty
    } finally {
      setLoading(false);
    }
  }, [notificationsEnabled]);

  // Smart polling: 5s when any active position has expired (awaiting resolution), else 30s
  const ordersRef = useRef<Order[]>([]);
  ordersRef.current = orders;

  useEffect(() => {
    fetchPortfolio();
    let timer: ReturnType<typeof setTimeout>;

    function schedule() {
      const hasPending = ordersRef.current.some(
        (o) => (o.status === "open" || o.status === "live") && o.expiresAt <= Date.now()
      );
      timer = setTimeout(async () => {
        await fetchPortfolio();
        schedule();
      }, hasPending ? 5_000 : 30_000);
    }

    schedule();
    return () => clearTimeout(timer);
  }, [fetchPortfolio]);

  // countdown ticker
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  // fetch referral/tier info
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    api.getReferral().then(setReferral).catch(() => {});
  }, []);

  async function handleClaim() {
    if (claiming || claimDone || !referral || Number(referral.claimable_usd) <= 0) return;
    setClaiming(true);
    try {
      await api.claimRewards();
      setClaimDone(true);
      const updated = await api.getReferral();
      setReferral(updated);
      // also refresh balance
      const data = await api.portfolio();
      setBalance(parseFloat(data.balance) || 0);
      setTimeout(() => setClaimDone(false), 3000);
    } catch {}
    setClaiming(false);
  }

  const realOrders  = orders.filter((o) => !o.isPaper);
  const paperOrders = orders.filter((o) => o.isPaper);

  const active  = realOrders.filter((o) => o.status === "open" || o.status === "live");
  const settled = realOrders.filter((o) => o.status === "won"  || o.status === "lost");
  const paperActive  = paperOrders.filter((o) => o.status === "open" || o.status === "live");
  const paperSettled = paperOrders.filter((o) => o.status === "won"  || o.status === "lost");

  const grossWon    = settled.filter((o) => o.status === "won").reduce((s, o) => s + calcPayout(o), 0);
  const totalStaked = settled.reduce((s, o) => s + o.amount, 0);
  const pnl         = grossWon - totalStaked;

  const hasPaper = paperOrders.length > 0;

  // theme tokens
  const T = {
    muted:      dk ? "text-white/30"  : "text-gray-400",
    normal:     dk ? "text-white/70"  : "text-gray-700",
    strong:     dk ? "text-white"     : "text-gray-900",
    sectionLbl: dk ? "text-white/20"  : "text-gray-400",
    statBox:    dk ? "bg-white/4 border-white/6"   : "bg-gray-50 border-gray-200",
    cardBase:   dk ? "border-white/8 bg-white/[0.02]"  : "border-gray-200 bg-white",
    cardWon:    dk ? "border-emerald-500/20 bg-emerald-500/[0.04]" : "border-emerald-200 bg-emerald-50/50",
    cardLost:   dk ? "border-red-500/20 bg-red-500/[0.04]"        : "border-red-200 bg-red-50/50",
    poolTrack:  dk ? "bg-white/5" : "bg-gray-100",
    divider:    dk ? "border-white/5" : "border-gray-100",
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

        {/* Balance + P&L */}
        <div className="flex gap-2">
          <div className={`flex-1 rounded-2xl border px-4 py-3 ${T.statBox}`}>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${T.sectionLbl}`}>Balance</p>
            <p className={`text-[22px] font-black ${T.strong}`}>
              ${balance.toFixed(2)}
            </p>
          </div>
          <div className={`flex-1 rounded-2xl border px-4 py-3 ${T.statBox}`}>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${T.sectionLbl}`}>All-time P&L</p>
            <p className={`text-[22px] font-black ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {settled.length === 0 ? "—" : `${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}`}
            </p>
          </div>
        </div>

        {/* Tier + Claim */}
        {referral && (() => {
          const claimable = Number(referral.claimable_usd);
          const hasRewards = claimable > 0;
          const tierLabel = referral.tier === "top" ? "Top" : referral.tier === "normal" ? "Normal" : "No tier";
          const rebate    = referral.tier === "top" ? "50% fee rebate" : referral.tier === "normal" ? "30% fee rebate" : "20% fee rebate";
          return (
            <div className={`rounded-2xl border px-4 py-3 transition-all ${
              hasRewards
                ? dk ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200"
                : T.statBox
            }`}>
              {/* tier row */}
              <div className="flex items-center gap-1.5 mb-3">
                <TierBadge tier={referral.tier} />
                <span className={`text-[11px] font-black ${T.strong}`}>{tierLabel}</span>
                <span className={`text-[10px] ${T.muted}`}>· {rebate}</span>
              </div>
              {/* pending rewards + claim */}
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${
                    hasRewards ? dk ? "text-emerald-400/70" : "text-emerald-600/70" : T.muted
                  }`}>Pending rewards</p>
                  <p className={`text-[22px] font-black ${hasRewards ? dk ? "text-emerald-400" : "text-emerald-600" : T.muted}`}>
                    ${claimable.toFixed(2)}
                  </p>
                </div>
                <button
                  onClick={handleClaim}
                  disabled={claiming || !hasRewards}
                  className={`px-5 py-2.5 rounded-xl text-[13px] font-black transition-all ${
                    claimDone   ? "bg-emerald-500 text-white" :
                    claiming    ? "bg-emerald-500/40 text-white/50 cursor-not-allowed" :
                    hasRewards  ? "bg-emerald-500 hover:bg-emerald-400 text-white" :
                    dk          ? "bg-white/5 text-white/20 cursor-not-allowed" :
                                  "bg-gray-100 text-gray-300 cursor-not-allowed"
                  }`}
                >
                  {claimDone ? "✓ Claimed!" : claiming ? "Claiming..." : "Claim"}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Withdraw button */}
        <button
          onClick={() => setShowWithdraw(true)}
          className={`w-full py-3 rounded-2xl text-[12px] font-black uppercase tracking-widest border transition-all ${
            dk
              ? "border-white/8 bg-white/[0.02] text-white/50 hover:bg-white/6 hover:text-white/80"
              : "border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100"
          }`}
        >
          Withdraw →
        </button>

        {/* Connect Telegram */}
        <a
          href="https://t.me/testingagent13223bot"
          target="_blank"
          rel="noopener noreferrer"
          className={`w-full py-3 rounded-2xl text-[12px] font-black uppercase tracking-widest border transition-all flex items-center justify-center gap-2 ${
            dk
              ? "border-sky-500/30 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20"
              : "border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.247l-2.01 9.468c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.48 14.48l-2.95-.924c-.64-.203-.653-.64.136-.953l11.52-4.443c.537-.194 1.006.13.836.952l-.46-.865z"/>
          </svg>
          Connect Telegram
        </a>

        {/* Open positions */}
        <div>
          <p className={`text-[10px] font-black tracking-widest uppercase mb-3 ${T.sectionLbl}`}>
            Open Positions {active.length > 0 && <span className={`ml-1 ${T.muted}`}>· {active.length}</span>}
          </p>
          {loading ? (
            <p className={`text-[13px] font-bold ${T.muted}`}>Loading…</p>
          ) : active.length === 0 ? (
            <p className={`text-[13px] font-bold ${T.muted}`}>No open positions.</p>
          ) : (
            <div className="space-y-2">
              {active.map((o) => <PositionRow key={o.id} order={o} tick={tick} dk={dk} T={T} />)}
            </div>
          )}
        </div>

        {/* History */}
        {settled.length > 0 && (
          <div>
            <p className={`text-[10px] font-black tracking-widest uppercase mb-3 ${T.sectionLbl}`}>History</p>
            <div className="space-y-2">
              {settled.map((o) => <PositionRow key={o.id} order={o} tick={tick} dk={dk} T={T} />)}
            </div>
          </div>
        )}

        {/* Paper positions */}
        {hasPaper && (
          <div>
            <p className={`text-[10px] font-black tracking-widest uppercase mb-3 ${T.sectionLbl}`}>
              Paper Trading {paperActive.length > 0 && <span className={`ml-1 ${T.muted}`}>· {paperActive.length} open</span>}
            </p>
            <div className="space-y-2">
              {paperActive.map((o) => <PositionRow key={o.id} order={o} tick={tick} dk={dk} T={T} />)}
              {paperSettled.map((o) => <PositionRow key={o.id} order={o} tick={tick} dk={dk} T={T} />)}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && orders.length === 0 && (
          <p className={`text-[13px] font-bold ${T.muted}`}>
            No bets yet. Head to the Feed and make your first call.
          </p>
        )}
      </div>

      <AnimatePresence>
        {showWithdraw && (
          <WithdrawModal
            balance={balance}
            dk={dk}
            onClose={() => setShowWithdraw(false)}
            onSuccess={(newBalance) => {
              setBalance(parseFloat(newBalance) || 0);
              setShowWithdraw(false);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ─── position row ──────────────────────────────────────────────────────────────

function PositionRow({ order: o, tick, dk, T }: {
  order: Order;
  tick: number;
  dk: boolean;
  T: Record<string, string>;
}) {
  const isShort    = o.direction === "short";
  const timeLeft   = o.expiresAt - Date.now();
  const isSettled  = o.status === "won" || o.status === "lost";
  const totalPool  = o.myPool + o.otherPool;
  const myPct      = totalPool > 0 ? (o.myPool / totalPool) * 100 : 100;
  const mult       = o.otherPool > 0 ? (1 + (o.otherPool * 0.95) / o.myPool).toFixed(2) : null;
  const payout     = calcPayout(o);
  const profit     = payout - o.amount;

  const cardCls =
    o.status === "won"  ? T.cardWon  :
    o.status === "lost" ? T.cardLost :
    T.cardBase;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border p-4 space-y-3 ${cardCls}`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-[15px] font-black ${T.strong}`}>${o.symbol}</span>
          <span className={`text-[11px] font-black ${isShort ? "text-red-400" : "text-emerald-400"}`}>
            {isShort ? "▼ SHORT" : "▲ LONG"}
          </span>
          <span className={`text-[10px] font-bold ${T.muted}`}>{o.timeframe}</span>
          {o.isPaper && (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 uppercase tracking-widest">
              paper
            </span>
          )}
        </div>

        {/* Status / countdown */}
        {isSettled ? (
          <span className={`text-[11px] font-black ${o.status === "won" ? "text-emerald-400" : "text-red-400"}`}>
            {o.status === "won" ? `+$${profit.toFixed(2)}` : `-$${o.amount}`}
          </span>
        ) : (
          <span className={`text-[11px] font-black tabular-nums ${timeLeft < 60000 ? "text-red-400" : T.muted}`}>
            {o.status === "open" && o.otherPool === 0 ? "waiting…" : formatCountdown(timeLeft)}
          </span>
        )}
      </div>

      {/* Pool bar — only for active */}
      {!isSettled && (
        <div className={`flex h-1.5 rounded-full overflow-hidden ${T.poolTrack}`}>
          <motion.div
            animate={{ width: `${myPct}%` }}
            className={`h-full rounded-full ${isShort ? "bg-red-500/60" : "bg-emerald-500/60"}`}
          />
        </div>
      )}

      {/* Stake / potential or result */}
      <div className="flex justify-between items-end">
        <div>
          <p className={`text-[10px] font-bold mb-0.5 ${T.muted}`}>Stake</p>
          <p className={`text-[14px] font-black ${T.strong}`}>${o.amount}</p>
        </div>
        <div className="text-right">
          <p className={`text-[10px] font-bold mb-0.5 ${T.muted}`}>{isSettled ? "Payout" : "If right"}</p>
          <p className={`text-[14px] font-black ${isSettled ? (o.status === "won" ? "text-emerald-400" : T.muted) : T.normal}`}>
            {isSettled
              ? o.status === "won" ? `$${payout.toFixed(2)}` : "—"
              : mult ? `${mult}x · $${payout.toFixed(2)}` : "no pool yet"}
          </p>
        </div>
      </div>

    </motion.div>
  );
}
