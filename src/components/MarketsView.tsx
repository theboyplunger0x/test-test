"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, Market, LeaderboardEntry } from "@/lib/api";
import CallCard, { type Call } from "./CallCard";
import DebateCard, { type Debate } from "./DebateCard";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Props {
  dk:             boolean;
  liveMarkets:    Market[];
  paperMode?:     boolean;
  presets?:       number[];
  onSelectToken?: (symbol: string, chain: string) => void;
  onViewProfile?: (username: string) => void;
  onBet?:         (id: string, side: "long" | "short", amount: number) => Promise<string | null>;
  shakingIds?:    Set<string>;
  calls?:         Call[];
  debates?:       Debate[];
  onFadeCall?:    (call: Call, side: "long" | "short", amount: number) => Promise<string | null>;
  onFadeDebate?:  (marketId: string, side: "long" | "short") => void;
  onViewToken?:   (symbol: string, chain: string) => void;
  loggedIn?:      boolean;
  onAuthRequired?: () => void;
  defaultFilter?: MarketFilter;
  hideFilterBar?: boolean;
  isTestnet?:     boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Currency formatting — set _gen flag at component level
let _gen = false;
function fmtPool(n: number): string {
  if (_gen) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k GEN` : `${n.toFixed(0)} GEN`; }
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
function $(n: number): string {
  return _gen ? `${n.toFixed(0)} GEN` : `$${n.toFixed(0)}`;
}
function fmtMult(m: number): string {
  if (!m || m <= 0) return "—";
  if (m >= 100) return "100x+";
  if (m >= 10)  return `${Math.floor(m)}x`;
  if (m >= 2)   return `${m.toFixed(1)}x`;
  return `${m.toFixed(2)}x`;
}
function multColor(m: number): string {
  if (!m || m <= 0) return "text-white/20";
  if (m >= 8)  return "text-yellow-400 font-black";
  if (m >= 4)  return "text-emerald-400 font-bold";
  if (m >= 2)  return "text-emerald-400";
  return "text-white/40";
}

const CHAIN_DOT: Record<string, string> = {
  SOL:  "bg-purple-400",
  ETH:  "bg-blue-400",
  BASE: "bg-blue-300",
};

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (data.length < 2) return null;
  const W = 300; const H = 100;
  const min = Math.min(...data); const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H * 0.8) - H * 0.1}`
  ).join(" ");
  const color = positive ? "#10b981" : "#f87171";
  const fillPts = `0,${H} ${pts} ${W},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill="url(#sg)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Hero Card ─────────────────────────────────────────────────────────────────
function HeroCard({ market, dk, onTrade }: { market: Market; dk: boolean; onTrade: () => void }) {
  const longPool  = parseFloat(market.long_pool);
  const shortPool = parseFloat(market.short_pool);
  const total     = longPool + shortPool;
  const longPct   = total > 0 ? Math.round((longPool  / total) * 100) : 50;
  const shortPct  = 100 - longPct;
  const longMult  = shortPool > 0 ? 1 + (shortPool * 0.95) / Math.max(longPool, 5) : 1.95;
  const shortMult = longPool  > 0 ? 1 + (longPool  * 0.95) / Math.max(shortPool, 5) : 1.95;
  const bias      = longPct >= 60 ? "SHORT" : shortPct >= 60 ? "LONG" : null;

  const border = dk ? "border-white/8"  : "border-gray-200";
  const bg     = dk ? "bg-[#111]"       : "bg-white";
  const strong = dk ? "text-white"      : "text-gray-900";
  const muted  = dk ? "text-white/35"   : "text-gray-500";
  const divCls = dk ? "border-white/6"  : "border-gray-100";

  // mock sparkline based on pool ratio
  const spark = Array.from({ length: 20 }, (_, i) => {
    const noise = Math.sin(i * 0.8) * 0.15 + Math.cos(i * 0.4) * 0.1;
    return longPct / 100 + noise;
  });

  return (
    <div className={`flex-1 rounded-2xl border ${border} ${bg} p-5 flex flex-col min-h-[280px]`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-black shrink-0 ${dk ? "bg-white/8 text-white/70" : "bg-gray-100 text-gray-700"}`}>
          ${market.symbol}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>{market.chain?.toUpperCase()} · {market.timeframe}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {bias && (
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${bias === "LONG" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                {bias} BIAS
              </span>
            )}
          </div>
          <h2 className={`text-[18px] font-black leading-tight ${strong}`}>
            {market.tagline || `Will $${market.symbol} go up in ${market.timeframe}?`}
          </h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex gap-4 flex-1">
        {/* Sides */}
        <div className={`flex flex-col justify-center flex-1 divide-y ${divCls}`}>
          <div className={`flex items-center justify-between py-3`}>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 text-[15px]">▲</span>
              <span className={`text-[14px] font-black ${strong}`}>Long</span>
            </div>
            <div className="text-right">
              <p className="text-[28px] font-black tabular-nums text-emerald-400">{longPct}%</p>
              <p className={`text-[10px] font-bold ${muted}`}>{fmtPool(longPool)} pool · {fmtMult(longMult)}</p>
            </div>
          </div>
          <div className={`flex items-center justify-between py-3`}>
            <div className="flex items-center gap-2">
              <span className="text-red-400 text-[15px]">▼</span>
              <span className={`text-[14px] font-black ${strong}`}>Short</span>
            </div>
            <div className="text-right">
              <p className="text-[28px] font-black tabular-nums text-red-400">{shortPct}%</p>
              <p className={`text-[10px] font-bold ${muted}`}>{fmtPool(shortPool)} pool · {fmtMult(shortMult)}</p>
            </div>
          </div>
        </div>
        {/* Sparkline */}
        <div className="w-36 self-stretch hidden sm:flex items-center">
          <div className="w-full h-24">
            <Sparkline data={spark} positive={longPct >= 50} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className={`flex items-center justify-between mt-4 pt-3 border-t ${divCls}`}>
        <span className={`text-[12px] font-bold ${muted}`}>{fmtPool(total)} vol · by {market.opener_username ?? "anon"}</span>
        <div className="flex gap-1.5">
          <button onClick={onTrade} className={`px-4 py-1.5 rounded-lg text-[12px] font-black border transition-all ${dk ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15" : "border-emerald-500 text-emerald-600 hover:bg-emerald-50"}`}>
            ▲ Long
          </button>
          <button onClick={onTrade} className={`px-4 py-1.5 rounded-lg text-[12px] font-black border transition-all ${dk ? "border-red-500/30 text-red-400 hover:bg-red-500/15" : "border-red-500 text-red-600 hover:bg-red-50"}`}>
            ▼ Short
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Right panel (Best Odds + Top Traders) ────────────────────────────────────
function RightPanel({ dk, paperMode, onSelectToken, onViewProfile }: { dk: boolean; paperMode: boolean; onSelectToken?: (s: string, c: string) => void; onViewProfile?: (u: string) => void }) {
  const [topMarkets, setTopMarkets] = useState<Market[]>([]);
  const [leaders, setLeaders]       = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    api.getMarkets().then(ms => {
      const open = ms.filter(m => m.status === "open" && !!m.is_paper === paperMode);
      // Sort by best multiplier descending
      const withMult = open.map(m => {
        const lp = parseFloat(m.long_pool), sp = parseFloat(m.short_pool);
        const bestMult = Math.max(
          sp > 0 ? 1 + (sp * 0.95) / Math.max(lp, 5) : 0,
          lp > 0 ? 1 + (lp * 0.95) / Math.max(sp, 5) : 0,
        );
        return { ...m, bestMult };
      });
      const sorted = withMult.sort((a, b) => b.bestMult - a.bestMult);
      setTopMarkets(sorted.slice(0, 4));
    }).catch(() => {});
    api.leaderboard("week", paperMode).then(r => setLeaders(r.slice(0, 3))).catch(() => {});
  }, [paperMode]);

  const border = dk ? "border-white/6"  : "border-gray-200";
  const bg     = dk ? "bg-[#111]"       : "bg-white";
  const strong = dk ? "text-white"      : "text-gray-900";
  const muted  = dk ? "text-white/35"   : "text-gray-400";
  const rowHov = dk ? "hover:bg-white/4": "hover:bg-gray-50";

  return (
    <div className="w-[260px] shrink-0 flex flex-col gap-3">
      {/* Best odds */}
      <div className={`rounded-2xl border ${border} ${bg} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`text-[11px] font-black uppercase tracking-widest ${muted}`}>Best Odds Now</h3>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </div>
        <div className="space-y-1">
          {topMarkets.length === 0 ? (
            <p className={`text-[11px] ${muted}`}>No open markets yet.</p>
          ) : topMarkets.map((m, i) => {
            const lp = parseFloat(m.long_pool);
            const sp = parseFloat(m.short_pool);
            const bestMult = Math.max(
              sp > 0 ? 1 + (sp * 0.95) / Math.max(lp, 5) : 0,
              lp > 0 ? 1 + (lp * 0.95) / Math.max(sp, 5) : 0,
            );
            const bestSide = (sp > lp) ? "LONG" : "SHORT";
            return (
              <button key={m.id} onClick={() => onSelectToken?.(m.symbol, m.chain)}
                className={`w-full flex items-center justify-between px-2 py-2 rounded-xl transition-colors ${rowHov}`}>
                <div className="flex items-center gap-2 text-left">
                  <span className={`text-[11px] font-black ${muted} w-4`}>{i + 1}</span>
                  <div>
                    <p className={`text-[13px] font-black ${strong}`}>${m.symbol}</p>
                    <p className={`text-[9px] font-bold ${muted}`}>{m.timeframe} · {bestSide}</p>
                  </div>
                </div>
                <span className={`text-[14px] font-black ${multColor(bestMult)}`}>{fmtMult(bestMult)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Top Traders */}
      <div className={`rounded-2xl border ${border} ${bg} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`text-[11px] font-black uppercase tracking-widest ${muted}`}>Top Traders</h3>
          <span className={`text-[11px] font-bold ${muted}`}>this week</span>
        </div>
        <div className="space-y-1">
          {leaders.length === 0 ? (
            <p className={`text-[11px] ${muted}`}>No resolved trades yet.</p>
          ) : leaders.map((l, i) => {
            const pnl = parseFloat(l.pnl);
            const medals = ["🥇", "🥈", "🥉"];
            return (
              <div key={l.username} className={`flex items-center justify-between px-2 py-2 rounded-xl ${rowHov}`}>
                <div className="flex items-center gap-2">
                  <span className="text-[13px]">{medals[i]}</span>
                  <button onClick={() => onViewProfile?.(l.username)} className={`text-[13px] font-black ${strong} hover:opacity-70 transition-opacity`}>{l.username}</button>
                </div>
                <span className={`text-[13px] font-black tabular-nums ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toFixed(0)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Quick Trade Modal — multi-tf sweep with order book view ───────────────────
function QuickTradeModal({ market, dk, onClose, paperMode, presets }: { market: Market; dk: boolean; onClose: () => void; paperMode: boolean; presets: number[] }) {
  const [side, setSide]     = useState<"long"|"short"|null>(null);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone]     = useState<string | null>(null);
  const [err, setErr]       = useState<string | null>(null);
  const [book, setBook]     = useState<import("@/lib/api").OrderBook | null>(null);
  const [bookLoading, setBookLoading] = useState(true);

  // Fetch order book on mount
  useEffect(() => {
    api.getOrderBook(market.symbol, market.chain, paperMode)
      .then(setBook)
      .catch(() => {})
      .finally(() => setBookLoading(false));
  }, [market.symbol, market.chain, paperMode]);

  const amt = parseFloat(amount) || 0;

  // Compute fill preview: how would $amt get distributed across timeframes
  const fillPreview = useMemo(() => {
    if (!book || !side || amt <= 0) return [];
    const makerSide = side === "long" ? "short" : "long";
    const tfs = Object.values(book.timeframes)
      .filter(tf => tf[makerSide].total > 0);

    if (tfs.length === 0) return [];

    // Distribute proportionally across all tfs, capped by available liquidity
    const totalAvailable = tfs.reduce((s, tf) => s + tf[makerSide].total, 0);
    const fills: { timeframe: string; fillAmt: number; available: number; mult: number }[] = [];
    let allocated = 0;

    for (let i = 0; i < tfs.length; i++) {
      const tf = tfs[i];
      const available = tf[makerSide].total;
      const share = available / totalAvailable;
      // Last tf gets the remainder to avoid rounding issues
      const fillAmt = i === tfs.length - 1
        ? Math.min(amt - allocated, available)
        : Math.min(Math.round(amt * share), available);
      if (fillAmt <= 0) continue;
      const myPool = fillAmt;
      const otherPool = available;
      const mult = 1 + (otherPool * 0.95) / Math.max(myPool, 1);
      fills.push({ timeframe: tf.timeframe, fillAmt, available, mult });
      allocated += fillAmt;
    }
    return fills;
  }, [book, side, amt]);

  const totalFill = fillPreview.reduce((s, f) => s + f.fillAmt, 0);
  const unfilled = Math.max(0, amt - totalFill);

  // Multi-tf sweep: use the same proportional distribution as fillPreview
  async function execute() {
    if (!side || amt <= 0 || !book) return;
    setLoading(true); setErr(null);

    // Use fillPreview to determine how much goes to each tf
    let totalFilled = 0;
    let tfsFilled = 0;

    for (const f of fillPreview) {
      if (f.fillAmt <= 0) continue;
      try {
        const res = await api.sweep({
          symbol: market.symbol, chain: market.chain,
          timeframe: f.timeframe, side, amount: f.fillAmt, is_paper: paperMode,
        });
        totalFilled += res.filled_amount ?? f.fillAmt;
        tfsFilled++;
      } catch {
        // This tf failed, continue to next
      }
    }

    // If nothing filled, fall back to limit order on the originally clicked tf
    if (totalFilled === 0) {
      try {
        await api.createOrders([{
          symbol: market.symbol, chain: market.chain,
          timeframe: market.timeframe, side, amount: amt, is_paper: paperMode,
        }]);
        setDone(`No fills available — limit order placed for $${amt.toFixed(0)}`);
      } catch (e2: any) {
        setErr(e2.message ?? "Failed");
      }
    } else {
      setDone(`Swept $${totalFilled.toFixed(0)} across ${tfsFilled} timeframe${tfsFilled > 1 ? "s" : ""}${unfilled > 0 ? ` · $${unfilled.toFixed(0)} unfilled` : ""}`);
    }
    setLoading(false);
  }

  const longPool  = parseFloat(market.long_pool);
  const shortPool = parseFloat(market.short_pool);
  const longMult  = shortPool > 0 ? 1 + (shortPool * 0.95) / Math.max(longPool + (side === "long" ? amt : 0), 5) : 1.95;
  const shortMult = longPool  > 0 ? 1 + (longPool  * 0.95) / Math.max(shortPool + (side === "short" ? amt : 0), 5) : 1.95;

  const [showBook, setShowBook] = useState(false);
  const panel = dk ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const muted = dk ? "text-white/25" : "text-gray-400";
  const bookTfs = book ? Object.values(book.timeframes) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ duration: 0.2 }}
        className={`relative w-full max-w-sm rounded-2xl border ${panel} p-5 flex flex-col gap-3 max-h-[85vh] overflow-y-auto`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`text-[18px] font-black ${dk ? "text-white" : "text-gray-900"}`}>${market.symbol}</span>
            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${dk ? "bg-white/8 text-white/40" : "bg-gray-100 text-gray-500"}`}>{market.chain}</span>
          </div>
          <button onClick={onClose} className={`text-[18px] leading-none ${dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700"}`}>×</button>
        </div>

        {done ? (
          <div className="text-center py-4">
            <p className="text-[28px] mb-2">✅</p>
            <p className={`text-[14px] font-black ${dk ? "text-white" : "text-gray-900"}`}>{done}</p>
            <button onClick={onClose} className="mt-4 text-[13px] font-bold text-emerald-400 hover:text-emerald-300">Close</button>
          </div>
        ) : (
          <>
            {/* Side selector with multiplier */}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setSide("long")}
                className={`py-3 rounded-xl font-black text-[14px] transition-all border ${side === "long" ? "bg-emerald-500 border-emerald-500 text-white" : dk ? "border-white/10 text-white/40 hover:border-emerald-500/40 hover:text-emerald-400" : "border-gray-200 text-gray-400 hover:border-emerald-400 hover:text-emerald-500"}`}>
                ▲ LONG · {fmtMult(longMult)}
              </button>
              <button onClick={() => setSide("short")}
                className={`py-3 rounded-xl font-black text-[14px] transition-all border ${side === "short" ? "bg-red-500 border-red-500 text-white" : dk ? "border-white/10 text-white/40 hover:border-red-500/40 hover:text-red-400" : "border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-500"}`}>
                ▼ SHORT · {fmtMult(shortMult)}
              </button>
            </div>

            {/* Amount */}
            <div>
              <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${dk ? "border-white/10 bg-white/4" : "border-gray-200 bg-gray-50"}`}>
                <span className={`text-[14px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>{_gen ? "GEN" : "$"}</span>
                <input type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)}
                  className={`flex-1 bg-transparent text-[16px] font-black outline-none ${dk ? "text-white placeholder:text-white/20" : "text-gray-900 placeholder:text-gray-300"}`} />
              </div>
              <div className="flex gap-1.5 mt-2">
                {presets.map(q => (
                  <button key={q} onClick={() => setAmount(String(q))}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-black transition-all ${dk ? "bg-white/6 text-white/40 hover:bg-white/12 hover:text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"}`}>
                    ${q}
                  </button>
                ))}
              </div>
            </div>

            {/* Fill preview — only when side + amount selected */}
            {side && amt > 0 && fillPreview.length > 0 && (
              <div className="space-y-1">
                {fillPreview.map(f => (
                  <div key={f.timeframe} className={`flex items-center justify-between text-[10px] font-bold ${dk ? "text-white/50" : "text-gray-500"}`}>
                    <span>{f.timeframe} — <span className={dk ? "text-white/80" : "text-gray-700"}>${f.fillAmt.toFixed(0)}</span></span>
                    <span className={multColor(f.mult)}>{fmtMult(f.mult)}</span>
                  </div>
                ))}
                {unfilled > 0 && (
                  <p className={`text-[10px] font-bold ${dk ? "text-amber-400/60" : "text-amber-600"}`}>
                    ${unfilled.toFixed(0)} unfilled → limit order
                  </p>
                )}
              </div>
            )}

            {side && amt > 0 && fillPreview.length === 0 && !bookLoading && (
              <p className={`text-[10px] font-bold ${dk ? "text-amber-400/60" : "text-amber-600"}`}>
                No liquidity — will post as limit order
              </p>
            )}

            {err && <p className="text-[12px] text-red-400">{err}</p>}

            <button onClick={execute} disabled={!side || amt <= 0 || loading}
              className={`w-full py-3.5 rounded-xl font-black text-[14px] transition-all ${
                side === "long"  ? "bg-emerald-500 hover:bg-emerald-400 text-white" :
                side === "short" ? "bg-red-500 hover:bg-red-400 text-white" :
                dk ? "bg-white/6 text-white/20" : "bg-gray-100 text-gray-300"
              } disabled:opacity-50`}>
              {loading ? "Executing…" : !side ? "Select a side" : side && amt > 0 && fillPreview.length === 0 && !bookLoading ? `Place order ${side === "long" ? "▲ Long" : "▼ Short"} ${$(amt)}` : `Sweep ${side === "long" ? "▲ Long" : "▼ Short"} ${amt > 0 ? $(amt) : "—"}`}
            </button>

            {/* Order book — collapsible */}
            <button onClick={() => setShowBook(!showBook)}
              className={`flex items-center justify-between w-full text-[10px] font-bold ${muted} hover:opacity-70 transition-opacity`}>
              <span>Order book</span>
              <span className={`transition-transform ${showBook ? "rotate-180" : ""}`}>▾</span>
            </button>
            <AnimatePresence>
              {showBook && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  {bookLoading ? (
                    <p className={`text-[11px] ${muted} animate-pulse`}>Loading…</p>
                  ) : bookTfs.length === 0 ? (
                    <p className={`text-[11px] ${muted}`}>Empty book</p>
                  ) : (
                    <div className="space-y-1">
                      {bookTfs.map(tf => {
                        const sl = tf.short.total;
                        const ll = tf.long.total;
                        const t = sl + ll;
                        if (t === 0) return null;
                        return (
                          <div key={tf.timeframe} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${dk ? "bg-white/[0.03]" : "bg-gray-50"}`}>
                            <span className={`text-[10px] font-black w-8 ${dk ? "text-white/50" : "text-gray-500"}`}>{tf.timeframe}</span>
                            <div className="flex-1 flex h-1.5 rounded-full overflow-hidden gap-px">
                              {sl > 0 && <div className="bg-red-500 rounded-l-full" style={{ width: `${(sl/t)*100}%` }} />}
                              {ll > 0 && <div className="bg-emerald-500 rounded-r-full" style={{ width: `${(ll/t)*100}%` }} />}
                            </div>
                            <div className="flex gap-2 text-[9px] font-bold tabular-nums shrink-0">
                              <span className="text-red-400 w-10 text-right">${sl.toFixed(0)}</span>
                              <span className="text-emerald-400 w-10">${ll.toFixed(0)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ── Live Market Card ──────────────────────────────────────────────────────────
const P2P_AMOUNTS = [10, 25, 50, 100];

function MarketCard({ market, dk, onClick, onTrade, onBet, shaking, isP2PView, paperMode, onAuthRequired }: { market: Market; dk: boolean; onClick: () => void; onTrade: () => void; onBet?: (id: string, side: "long" | "short", amount: number) => Promise<string | null>; shaking?: boolean; isP2PView?: boolean; paperMode?: boolean; onAuthRequired?: () => void }) {
  const longPool  = parseFloat(market.long_pool);
  const shortPool = parseFloat(market.short_pool);
  const total     = longPool + shortPool;
  const longPct   = total > 0 ? Math.round((longPool  / total) * 100) : 50;
  const shortPct  = 100 - longPct;

  // Rotating messages: opener tagline (yellow) + bettor messages
  type Msg = { text: string; user: string; isOpener: boolean };
  const [msgs, setMsgs]     = useState<Msg[]>(() =>
    market.tagline ? [{ text: market.tagline, user: market.opener_username ?? "", isOpener: true }] : []
  );
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    function load() {
      api.getMarketPositions(market.id).then((positions: any[]) => {
        const betMsgs: Msg[] = positions
          .filter(p => p.message)
          .map(p => ({ text: p.message, user: p.username ?? "", isOpener: p.is_opener ?? false }));
        const openerMsg: Msg[] = market.tagline
          ? [{ text: market.tagline, user: market.opener_username ?? "", isOpener: true }]
          : [];
        // dedupe by text
        const seen = new Set<string>();
        const all = [...openerMsg, ...betMsgs].filter(m => { if (seen.has(m.text)) return false; seen.add(m.text); return true; });
        setMsgs(all);
      }).catch(() => {});
    }
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [market.id]);

  useEffect(() => {
    if (msgs.length <= 1) return;
    const iv = setInterval(() => setMsgIdx(i => (i + 1) % msgs.length), 3000);
    return () => clearInterval(iv);
  }, [msgs.length]);

  const currentMsg = msgs[msgIdx] ?? null;

  const longMult  = shortPool > 0 ? 1 + (shortPool * 0.95) / Math.max(longPool, 5) : 1.95;
  const shortMult = longPool  > 0 ? 1 + (longPool  * 0.95) / Math.max(shortPool, 5) : 1.95;
  const bestMult  = Math.max(longMult, shortMult);
  const bestSide  = longMult >= shortMult ? "LONG" : "SHORT";
  const shortIsJuicy = longPool > shortPool * 2;
  const longIsJuicy  = shortPool > longPool * 2;

  // P2P inline bet state
  const [p2pSide, setP2pSide]       = useState<"long" | "short" | null>(null);
  const [p2pCustom, setP2pCustom]   = useState("");
  const [p2pLoading, setP2pLoading] = useState(false);
  const [p2pError, setP2pError]     = useState("");

  const handleP2pQuick = async (amount: number) => {
    if (!p2pSide || !onBet) return;
    setP2pLoading(true); setP2pError("");
    const err = await onBet(market.id, p2pSide, amount);
    setP2pLoading(false);
    if (err) setP2pError(err);
    else { setP2pSide(null); setP2pCustom(""); }
  };

  const handleP2pCustom = async () => {
    const amt = parseFloat(p2pCustom);
    if (!p2pSide || !amt || amt <= 0 || !onBet) return;
    setP2pLoading(true); setP2pError("");
    const err = await onBet(market.id, p2pSide, amt);
    setP2pLoading(false);
    if (err) setP2pError(err);
    else { setP2pSide(null); setP2pCustom(""); }
  };

  const isHot = bestMult >= 15 && !isP2PView;
  // For hot cards: the majority side is the one with LOWER mult (more money there)
  const majoritySide  = bestSide === "LONG" ? "SHORT" : "LONG";
  const majorityPct   = bestSide === "LONG" ? shortPct : longPct;
  const contrarian    = bestSide; // the side with the HIGH multiplier = fade opportunity

  const border   = isHot
    ? "border-amber-400/60 shadow-[0_0_16px_rgba(251,191,36,0.18)]"
    : dk ? "border-white/6" : "border-gray-200";
  const bg       = isHot
    ? dk ? "bg-[#111]" : "bg-amber-50/40"
    : dk ? "bg-[#111]" : "bg-white";
  const strong   = dk ? "text-white"      : "text-gray-900";
  const muted    = dk ? "text-white/35"   : "text-gray-400";
  const divCls   = isHot ? "border-amber-400/20" : dk ? "border-white/5" : "border-gray-100";
  const chainCls = {
    sol:  dk ? "bg-purple-500/15 text-purple-300" : "bg-purple-100 text-purple-700",
    eth:  dk ? "bg-blue-500/15 text-blue-300"     : "bg-blue-100 text-blue-700",
    base: dk ? "bg-blue-500/15 text-blue-300"     : "bg-blue-100 text-blue-700",
  }[market.chain?.toLowerCase()] ?? (dk ? "bg-white/8 text-white/40" : "bg-gray-100 text-gray-500");

  return (
    <motion.div
      layout
      className="h-full"
      animate={shaking ? { x: [0, -6, 6, -4, 4, -2, 2, 0] } : {}}
      transition={shaking ? { duration: 0.5, ease: "easeOut" } : {}}
    >
    <button onClick={onClick} className={`w-full h-full text-left rounded-2xl border ${border} ${bg} p-4 flex flex-col gap-3 transition-all ${isHot ? "" : "hover:border-white/20"}`}>

      {isHot ? (
        /* ── HOT CARD: contrarian opportunity hero layout ── */
        <>
          {/* Top row: symbol + chain + multi-tf */}
          <div className="flex items-center gap-1.5">
            <span className={`text-[15px] font-black ${strong}`}>${market.symbol}</span>
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${chainCls}`}>{market.chain?.toUpperCase()}</span>
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${dk ? "bg-white/6 text-white/30" : "bg-gray-100 text-gray-400"}`}>multi-tf</span>
            <span className="ml-auto text-[9px] font-black px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-400 tracking-wide">🔥 HOT</span>
          </div>

          {/* Hero: big multiplier + fade label */}
          <div>
            <p className="text-[38px] font-black tabular-nums leading-none text-amber-400">{fmtMult(bestMult)}</p>
            <p className={`text-[11px] font-black mt-1 ${contrarian === "LONG" ? "text-emerald-400" : "text-red-400"}`}>
              {contrarian === "LONG" ? "▲ LONG" : "▼ SHORT"} — fade the crowd
            </p>
          </div>

          {/* Message */}
          <div className="min-h-[20px]">
            <AnimatePresence mode="wait">
              {currentMsg && (
                <motion.div key={msgIdx} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.3 }}>
                  <p className={`text-[10px] italic line-clamp-2 leading-[14px] ${currentMsg.isOpener ? (dk ? "text-yellow-400/80" : "text-yellow-600") : muted}`}>
                    "{currentMsg.text}"
                    {currentMsg.user && <span className={`not-italic ml-1 ${dk ? "text-white/20" : "text-gray-400"}`}>— {currentMsg.user}</span>}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Pool bar */}
          <div className={`pt-2 border-t ${divCls} flex items-center gap-2`}>
            <span className="text-[9px] font-black text-emerald-400 shrink-0">▲ {fmtPool(longPool)}</span>
            <div className="flex-1 h-2 rounded-full overflow-hidden flex">
              <motion.div initial={{ width: 0 }} animate={{ width: `${longPct}%` }} transition={{ duration: 0.6, ease: "easeOut" }} className="h-full bg-emerald-500" />
              <motion.div initial={{ width: 0 }} animate={{ width: `${shortPct}%` }} transition={{ duration: 0.6, ease: "easeOut" }} className="h-full bg-red-500" />
            </div>
            <span className="text-[9px] font-black text-red-400 shrink-0">{fmtPool(shortPool)} ▼</span>
          </div>

          {/* Trade CTA — amber for hot */}
          <button
            onClick={e => { e.stopPropagation(); if (onAuthRequired) { onAuthRequired(); return; } onTrade(); }}
            className="w-full py-2.5 rounded-xl font-black text-[13px] tracking-wide bg-amber-400 text-black hover:bg-amber-300 active:scale-95 transition-all">
            Sweep {fmtMult(bestMult)} · {contrarian}
          </button>
        </>
      ) : (
        /* ── NORMAL CARD ── */
        <>
          {/* Header */}
          <div className="flex items-start justify-between gap-2 w-full">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-[18px] font-black ${strong}`}>${market.symbol}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${chainCls}`}>{market.chain?.toUpperCase()}</span>
                <span className={`text-[10px] font-mono ${muted}`}>@ ${(() => {
                  const p = parseFloat(market.entry_price);
                  if (p >= 1) return p.toFixed(2);
                  return p.toPrecision(4);
                })()}</span>
              </div>
            </div>
            <div className="text-right">
              <p className={`text-[18px] font-black tabular-nums leading-none ${multColor(bestMult)}`}>{fmtMult(bestMult)}</p>
              <span className={`text-[12px] font-bold ${muted}`}>{market.timeframe}</span>
              <p className={`text-[10px] mt-0.5 tabular-nums ${muted}`}>
                {(() => {
                  const ms = Math.max(0, new Date(market.closes_at).getTime() - Date.now());
                  if (ms <= 0) return "expired";
                  const s = Math.floor(ms / 1000);
                  const m = Math.floor(s / 60);
                  const h = Math.floor(m / 60);
                  if (ms < 60_000) return `${s}s left`;
                  if (ms < 60 * 60_000) return `${m}m left`;
                  return `${h}h left`;
                })()}
              </p>
            </div>
          </div>

          {/* Message */}
          <div className="min-h-[28px] w-full">
            <AnimatePresence mode="wait">
              {currentMsg && (
                <motion.div key={msgIdx} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.3 }}>
                  <div className="flex items-start gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black shrink-0 mt-0.5 ${
                      currentMsg.isOpener
                        ? dk ? "bg-yellow-500/20 text-yellow-400" : "bg-yellow-100 text-yellow-600"
                        : dk ? "bg-white/8 text-white/40" : "bg-gray-100 text-gray-500"
                    }`}>
                      {currentMsg.user.charAt(0).toUpperCase()}
                    </span>
                    <p className={`text-[12px] italic leading-snug font-bold ${
                      currentMsg.isOpener
                        ? dk ? "text-yellow-400/80" : "text-yellow-600"
                        : dk ? "text-white/60" : "text-gray-700"
                    }`}>
                      "{currentMsg.text}"
                      {!currentMsg.isOpener && currentMsg.user && (
                        <span className={`not-italic font-normal ml-1.5 text-[10px] ${dk ? "text-white/25" : "text-gray-400"}`}>— {currentMsg.user}</span>
                      )}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Pool section */}
          <div className={`w-full rounded-xl p-3 space-y-2.5 ${dk ? "bg-white/4" : "bg-gray-50"}`}>
            <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
              <motion.div animate={{ width: `${shortPct}%` }} transition={{ type: "spring", stiffness: 180, damping: 22 }}
                className="h-full rounded-l-full bg-red-500" />
              <motion.div animate={{ width: `${longPct}%` }} transition={{ type: "spring", stiffness: 180, damping: 22 }}
                className="h-full rounded-r-full bg-emerald-500" />
            </div>
            <table className="w-full">
              <tbody>
                <tr>
                  <td className="align-top">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-black text-red-400">▼ SHORT</span>
                      {shortIsJuicy && <span className="text-[9px] font-bold text-yellow-500 bg-yellow-400/15 px-1.5 rounded-full">juicy</span>}
                    </div>
                    <span className={`text-[16px] font-black ${dk ? "text-white" : "text-gray-900"}`}>{fmtPool(shortPool)}</span>
                    <p className={`text-[10px] font-bold ${muted}`}>→ {fmtMult(shortMult)}</p>
                  </td>
                  <td className="align-top text-right">
                    <div className="flex items-center gap-1 justify-end">
                      {longIsJuicy && <span className="text-[9px] font-bold text-yellow-500 bg-yellow-400/15 px-1.5 rounded-full">juicy</span>}
                      <span className="text-[11px] font-black text-emerald-400">LONG ▲</span>
                    </div>
                    <span className={`text-[16px] font-black ${dk ? "text-white" : "text-gray-900"}`}>{fmtPool(longPool)}</span>
                    <p className={`text-[10px] font-bold ${muted}`}>{fmtMult(longMult)} ←</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* User + time */}
          <div className={`flex justify-between text-[10px] font-bold ${muted}`}>
            <span className="flex items-center gap-1.5">
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black ${dk ? "bg-white/10 text-white/50" : "bg-gray-200 text-gray-500"}`}>
                {(market.opener_username ?? "?").charAt(0).toUpperCase()}
              </span>
              {market.opener_username ?? "anon"}
            </span>
            <span>{(() => {
              const s = Math.floor((Date.now() - new Date(market.created_at).getTime()) / 1000);
              if (s < 60) return `${s}s ago`;
              const m = Math.floor(s / 60);
              if (m < 60) return `${m}m ago`;
              return `${Math.floor(m / 60)}h ago`;
            })()}</span>
          </div>

          {/* CTA */}
          {onBet ? (
            <AnimatePresence mode="wait">
              {p2pSide === null ? (
                <motion.div key="btns" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1.5">
                  {paperMode && (
                    <div className="flex items-center gap-1.5 px-0.5">
                      <span className="text-[10px] font-black text-yellow-500 bg-yellow-400/15 px-2 py-0.5 rounded-full">PAPER</span>
                      <span className={`text-[10px] font-bold ${muted}`}>simulated bet — no real money</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <motion.button whileTap={{ scale: 0.94 }} onClick={e => { e.stopPropagation(); if (onAuthRequired) { onAuthRequired(); return; } setP2pSide("short"); setP2pError(""); }}
                      className={`flex-1 py-2.5 rounded-xl text-[12px] font-black transition-all border ${dk ? "bg-red-500/15 text-red-400 hover:bg-red-500/25 border-red-500/20" : "bg-red-50 text-red-600 hover:bg-red-100 border-red-200"}`}>
                      ▼ Short
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.94 }} onClick={e => { e.stopPropagation(); if (onAuthRequired) { onAuthRequired(); return; } setP2pSide("long"); setP2pError(""); }}
                      className={`flex-1 py-2.5 rounded-xl text-[12px] font-black transition-all border ${dk ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border-emerald-500/20" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-200"}`}>
                      Long ▲
                    </motion.button>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="picker" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2"
                  onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center">
                    <span className={`text-[12px] font-black ${p2pSide === "short" ? "text-red-400" : "text-emerald-400"}`}>
                      {p2pSide === "short" ? "▼ Short" : "Long ▲"} · {p2pSide === "short" ? fmtMult(shortMult) : fmtMult(longMult)}
                    </span>
                    <button onClick={() => { setP2pSide(null); setP2pCustom(""); setP2pError(""); }}
                      className={`text-[11px] font-bold ${dk ? "text-white/25 hover:text-white/50" : "text-gray-400 hover:text-gray-600"}`}>✕</button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {P2P_AMOUNTS.map(a => (
                      <button key={a} onClick={() => handleP2pQuick(a)} disabled={p2pLoading}
                        className={`py-2 rounded-xl text-[11px] font-black transition-all disabled:opacity-50 ${dk ? "bg-white/6 text-white/50 hover:bg-white/12 hover:text-white" : "bg-blue-50 text-blue-600 hover:bg-blue-100"}`}>
                        ${a}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>{_gen ? "GEN" : "$"}</span>
                      <input autoFocus type="number" placeholder="custom" value={p2pCustom}
                        onChange={e => setP2pCustom(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleP2pCustom()}
                        className={`w-full text-[12px] font-bold pl-6 pr-3 py-2 rounded-xl outline-none ${dk ? "bg-white/6 text-white placeholder:text-white/20 focus:bg-white/10" : "bg-gray-50 border border-gray-200 text-gray-900"}`} />
                    </div>
                    <button onClick={handleP2pCustom} disabled={p2pLoading}
                      className={`px-4 py-2 rounded-xl text-[12px] font-black transition-all disabled:opacity-50 ${
                        p2pSide === "short"
                          ? dk ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-50 text-red-600 hover:bg-red-100"
                          : dk ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                      }`}>
                      {p2pLoading ? "…" : "Add"}
                    </button>
                  </div>
                  {p2pError && (
                    <p className={`text-[11px] font-bold px-2 py-1.5 rounded-lg ${dk ? "text-red-400 bg-red-500/10" : "text-red-600 bg-red-50"}`}>
                      {p2pError}
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); onTrade(); }}
              className="w-full py-2.5 rounded-xl font-black text-[13px] tracking-wide bg-white text-black hover:bg-white/90 active:scale-95 transition-all">
              Trade
            </button>
          )}
        </>
      )}

    </button>
    </motion.div>
  );
}

// ── OB types & hook ───────────────────────────────────────────────────────────
type OBEntry = {
  key:       string;
  symbol:    string;
  chain:     string;
  timeframe: string;
  longTotal: number;
  shortTotal:number;
  bestMult:  number;
  bestSide:  "LONG" | "SHORT";
  topLong:   { username: string; amount: number }[];
  topShort:  { username: string; amount: number }[];
};

const OB_TOKENS = [
  { symbol: "DOGE", chain: "sol" },
  { symbol: "PEPE", chain: "eth" },
  { symbol: "WIF",  chain: "sol" },
  { symbol: "BONK", chain: "sol" },
  { symbol: "SHIB", chain: "eth" },
  { symbol: "SOL",  chain: "sol" },
  { symbol: "BTC",  chain: "sol" },
];

function useOBEntries(paperMode: boolean) {
  const [entries, setEntries] = useState<OBEntry[]>([]);
  useEffect(() => {
    Promise.allSettled(
      OB_TOKENS.map(t => api.getOrderBook(t.symbol, t.chain, paperMode).then(ob => ({ t, ob })))
    ).then(results => {
      const out: OBEntry[] = [];
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { t, ob } = r.value;
        for (const [tf, tfData] of Object.entries(ob.timeframes) as [string, any][]) {
          const lt = tfData.long.total  ?? 0;
          const st = tfData.short.total ?? 0;
          if (lt + st === 0) continue;
          const bestMult = Math.max(
            st > 0 ? 1 + (st * 0.95) / Math.max(lt, 5) : 0,
            lt > 0 ? 1 + (lt * 0.95) / Math.max(st, 5) : 0,
          );
          out.push({
            key:       `${t.symbol}-${t.chain}-${tf}`,
            symbol:    t.symbol,
            chain:     t.chain.toUpperCase(),
            timeframe: tf,
            longTotal: lt,
            shortTotal:st,
            bestMult,
            bestSide:  st > lt ? "LONG" : "SHORT",
            topLong:  (tfData.long.orders  ?? []).slice(0, 3).map((o: any) => ({ username: o.username, amount: o.remaining_amount })),
            topShort: (tfData.short.orders ?? []).slice(0, 3).map((o: any) => ({ username: o.username, amount: o.remaining_amount })),
          });
        }
      }
      out.sort((a, b) => (b.longTotal + b.shortTotal) - (a.longTotal + a.shortTotal));
      setEntries(out);
    });
  }, [paperMode]);
  return entries;
}

// ── OB Card ───────────────────────────────────────────────────────────────────
function OBCard({ entry, dk, onClick }: { entry: OBEntry; dk: boolean; onClick: () => void }) {
  const border  = dk ? "border-white/6 border-dashed" : "border-gray-200 border-dashed";
  const bg      = dk ? "bg-[#0e0e0e]"  : "bg-gray-50";
  const strong  = dk ? "text-white"    : "text-gray-900";
  const muted   = dk ? "text-white/30" : "text-gray-400";
  const divCls  = dk ? "border-white/5": "border-gray-100";
  const chainCls = {
    sol:  dk ? "bg-purple-500/15 text-purple-300" : "bg-purple-100 text-purple-700",
    eth:  dk ? "bg-blue-500/15 text-blue-300"     : "bg-blue-100 text-blue-700",
    base: dk ? "bg-blue-500/15 text-blue-300"     : "bg-blue-100 text-blue-700",
  }[entry.chain?.toLowerCase()] ?? (dk ? "bg-white/8 text-white/40" : "bg-gray-100 text-gray-500");

  const total   = entry.longTotal + entry.shortTotal;
  const longPct = total > 0 ? Math.round((entry.longTotal / total) * 100) : 50;
  const shortPct = 100 - longPct;

  // top waiting traders across both sides
  const waiters = [
    ...entry.topShort.map(o => ({ ...o, side: "short" as const })),
    ...entry.topLong.map(o => ({ ...o, side: "long"  as const })),
  ].sort((a, b) => b.amount - a.amount).slice(0, 3);

  return (
    <motion.div layout>
    <button onClick={onClick} className={`w-full text-left rounded-2xl border ${border} ${bg} p-4 flex flex-col gap-3 hover:border-white/20 transition-colors`}>

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`text-[16px] font-black ${strong}`}>${entry.symbol}</span>
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${chainCls}`}>{entry.chain}</span>
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${dk ? "bg-white/6 text-white/30" : "bg-gray-100 text-gray-400"}`}>{entry.timeframe}</span>
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${dk ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-600"}`}>ORDER BOOK</span>
          </div>
          {/* Waiting traders */}
          <div className="min-h-[28px] w-full">
            {waiters.length > 0 && (
              <p className={`text-[10px] line-clamp-2 leading-[14px] ${muted}`}>
                {waiters.map((w, i) => (
                  <span key={i}>
                    <span className={w.side === "long" ? "text-emerald-400" : "text-red-400"}>{w.side === "long" ? "▲" : "▼"}</span>
                    {" "}<span className={dk ? "text-white/50" : "text-gray-700"}>{w.username}</span>{" "}${Math.round(w.amount)}
                    {i < waiters.length - 1 ? "  ·  " : ""}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
        {/* Multiplier */}
        <div className="text-right shrink-0">
          <p className={`text-[18px] font-black tabular-nums leading-none ${multColor(entry.bestMult)}`}>{fmtMult(entry.bestMult)}</p>
          <p className={`text-[9px] font-black mt-0.5 ${entry.bestSide === "LONG" ? "text-emerald-400/60" : "text-red-400/60"}`}>{entry.bestSide}</p>
        </div>
      </div>

      {/* Pool bar */}
      <div className={`pt-2 border-t ${divCls}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] font-black text-emerald-400">▲ {fmtPool(entry.longTotal)}</span>
          <div className="flex-1 h-2 rounded-full overflow-hidden flex">
            <motion.div initial={{ width: 0 }} animate={{ width: `${longPct}%` }} transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-full bg-emerald-500/60" />
            <motion.div initial={{ width: 0 }} animate={{ width: `${shortPct}%` }} transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-full bg-red-500/60" />
          </div>
          <span className="text-[9px] font-black text-red-400">{fmtPool(entry.shortTotal)} ▼</span>
        </div>
      </div>

    </button>
    </motion.div>
  );
}

const MARKET_FILTERS = ["all", "calls", "debates", "hot", "sweep", "p2p"] as const;
type MarketFilter = typeof MARKET_FILTERS[number];
const FILTER_LABELS: Record<MarketFilter, string> = { all: "All", calls: "Calls", debates: "Debates", hot: "Hot X's", sweep: "Sweep", p2p: "P2P" };
const HOT_THRESHOLD = 5; // multiplier above this = hot

// ── Markets Tape Sidebar ───────────────────────────────────────────────────────
type TapeEntry = { uid: string; symbol: string; chain: string; timeframe: string; side: "long" | "short"; amount: number; message: string; user: string; ts: number; isOpener: boolean; isOpen: boolean };

function MarketsTape({ dk, onSelectToken, onViewProfile, paperMode }: { dk: boolean; onSelectToken?: (s: string, c: string) => void; onViewProfile?: (u: string) => void; paperMode?: boolean }) {
  const [open, setOpen]       = useState(true);
  const [entries, setEntries] = useState<TapeEntry[]>([]);
  const scrollRef             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const recent = await api.getRecentPositions(paperMode);
        const items: TapeEntry[] = recent.map(p => ({
          uid:       `pos-${p.id}`,
          symbol:    p.symbol,
          chain:     p.chain ?? "",
          timeframe: p.timeframe ?? "",
          side:      p.side,
          amount:    Math.round(parseFloat(p.amount)),
          message:   p.message ?? "",
          user:      p.username,
          ts:        new Date(p.placed_at).getTime(),
          isOpener:  p.is_opener,
          isOpen:    p.status === "open" || p.status === "live",
        }));
        setEntries(items.sort((a, b) => b.ts - a.ts).slice(0, 60));
      } catch {}
    }
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [paperMode]);

  const border  = dk ? "border-white/5"  : "border-gray-100";
  const label   = dk ? "text-white/25"   : "text-gray-500";
  const divider = dk ? "border-white/4"  : "border-gray-200";
  const rowHov  = dk ? "hover:bg-white/4": "hover:bg-gray-50";
  const amtTxt  = dk ? "text-white/50"   : "text-gray-800 font-black";
  const msgTxt  = dk ? "text-white/30"   : "text-gray-700";
  const userTxt = dk ? "text-white/20"   : "text-gray-500";
  const strong  = dk ? "text-white"      : "text-gray-900";

  if (entries.length === 0) return null;

  return (
    <div style={{ width: open ? "240px" : "32px", minWidth: open ? "240px" : "32px" }}
      className={`shrink-0 border-l ${border} flex flex-col overflow-hidden transition-all duration-200 hidden md:flex`}>
      <div className="px-3 py-2.5 shrink-0 flex items-center justify-between">
        {open && (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <p className={`text-[9px] font-black tracking-widest uppercase ${label}`}>Tape</p>
          </div>
        )}
        <button onClick={() => setOpen(o => !o)}
          className={`${open ? "ml-auto" : "mx-auto"} flex items-center justify-center w-6 h-6 rounded-lg text-[12px] font-black transition-all ${dk ? "bg-white/6 hover:bg-white/12 text-white/40 hover:text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-700"}`}>
          {open ? "›" : "‹"}
        </button>
      </div>
      {open && (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <AnimatePresence initial={false}>
            {entries.length === 0 ? (
              <p className={`text-[11px] px-4 py-6 ${label}`}>No trades yet.</p>
            ) : entries.map(e => (
              <motion.div key={e.uid} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
                className={`px-4 py-3 border-b ${divider} ${rowHov} transition-colors cursor-pointer`}
                onClick={() => onSelectToken?.(e.symbol, e.chain)}>
                {/* Row 1: side arrow + symbol + badge + amount */}
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[12px] font-black ${e.side === "long" ? "text-emerald-400" : "text-red-400"}`}>{e.side === "long" ? "▲" : "▼"}</span>
                  <span className={`text-[13px] font-black ${strong}`}>${e.symbol}</span>
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                    e.isOpen
                      ? dk ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                      : dk ? "bg-white/8 text-white/25"           : "bg-gray-100 text-gray-400"
                  }`}>{e.isOpen ? "open" : "closed"}</span>
                  <span className={`text-[12px] font-bold ml-auto ${amtTxt}`}>${e.amount}</span>
                </div>
                {/* Row 2: message + username */}
                <div className="flex items-center gap-2">
                  <p className={`text-[11px] italic line-clamp-2 leading-snug flex-1 ${e.isOpener ? (dk ? "text-yellow-400/70" : "text-yellow-600") : msgTxt}`}>
                    {e.message ? `"${e.message}"` : ""}
                  </p>
                  <span
                    className={`text-[10px] font-bold shrink-0 ${userTxt} cursor-pointer hover:opacity-60 transition-opacity`}
                    onClick={ev => { ev.stopPropagation(); if (e.user) onViewProfile?.(e.user); }}>
                    {e.user}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function MarketsView({ dk, liveMarkets = [], paperMode = false, presets = [10, 25, 50, 100], onSelectToken, onViewProfile, onBet, shakingIds, calls = [], debates = [], onFadeCall, onFadeDebate, onViewToken, loggedIn, onAuthRequired, defaultFilter, hideFilterBar, isTestnet = false }: Props) {
  _gen = isTestnet;
  const [selectedFilter, setSelectedFilter] = useState<MarketFilter>(defaultFilter ?? "all");
  const [tradeMarket, setTradeMarket]     = useState<Market | null>(null);

  const strong  = dk ? "text-white"     : "text-gray-900";
  const muted   = dk ? "text-white/30"  : "text-gray-400";
  const divider = dk ? "border-white/6" : "border-gray-200";

  const openMarkets = liveMarkets.filter(m => m.status === "open" && new Date(m.closes_at).getTime() > Date.now() && (parseFloat(m.long_pool) + parseFloat(m.short_pool)) > 0);

  // Hero: pick market with highest pool
  const hero = [...openMarkets].sort((a, b) =>
    (parseFloat(b.long_pool) + parseFloat(b.short_pool)) - (parseFloat(a.long_pool) + parseFloat(a.short_pool))
  )[0];

  // Compute multiplier for each market
  const marketsWithMult = openMarkets.map(m => {
    const lp = parseFloat(m.long_pool);
    const sp = parseFloat(m.short_pool);
    const longMult  = sp > 0 ? 1 + (sp * 0.95) / Math.max(lp, 5) : 1.95;
    const shortMult = lp > 0 ? 1 + (lp * 0.95) / Math.max(sp, 5) : 1.95;
    const bestMult = Math.max(longMult, shortMult);
    return { ...m, bestMult };
  });

  // Filter by category
  const filteredMarkets = selectedFilter === "all"
    ? marketsWithMult
    : selectedFilter === "hot"
    ? marketsWithMult.filter(m => m.bestMult >= HOT_THRESHOLD && !m.sweep_id)
    : selectedFilter === "sweep"
    ? marketsWithMult.filter(m => !!m.sweep_id && m.bestMult >= 15)
    : selectedFilter === "p2p"
    ? marketsWithMult.filter(m => !m.sweep_id)
    : marketsWithMult;

  // Sort: all filters by recent activity
  const sortedMarkets = filteredMarkets;

  const hasGrid = sortedMarkets.length > 0;

  return (
    <>
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 overflow-y-auto">
      <div className="px-4 md:px-5 py-5 max-w-7xl mx-auto space-y-6">

        {/* Hero row — hidden in sweep-only mode */}
        {!hideFilterBar && (hero ? (
          <div className="flex gap-4 items-start">
            <HeroCard market={hero} dk={dk} onTrade={() => { if (!loggedIn && onAuthRequired) { onAuthRequired(); return; } setTradeMarket(hero); }} />
            <div className="hidden lg:block">
              <RightPanel dk={dk} paperMode={paperMode} onSelectToken={onSelectToken} onViewProfile={onViewProfile} />
            </div>
          </div>
        ) : (
          <div className={`rounded-2xl border ${dk ? "border-white/6 bg-[#111]" : "border-gray-200 bg-white"} p-8 text-center`}>
            <p className={`text-[28px] mb-2`}>📈</p>
            <p className={`text-[15px] font-black ${strong}`}>No open markets yet.</p>
            <p className={`text-[12px] ${muted} mt-1`}>Be the first to open one.</p>
          </div>
        ))}

        {/* Unified grid: P2P markets + OB cards */}
        {hasGrid && (
          <>
            {!hideFilterBar && <div className={`flex items-center justify-between border-b ${divider} pb-3`}>
              <h2 className={`text-[16px] font-black ${strong}`}>All Markets</h2>
              <div className="flex items-center gap-1">
                {MARKET_FILTERS.map(f => {
                  const active = f === selectedFilter;
                  return (
                    <button key={f} onClick={() => setSelectedFilter(f)}
                      className={`text-[12px] px-3 py-1.5 rounded-xl font-black transition-all ${
                        active
                          ? f === "hot" ? "bg-amber-400/20 text-amber-400" : dk ? "bg-white/15 text-white" : "bg-gray-900 text-white"
                          : dk ? "text-white/40 hover:text-white/70 hover:bg-white/6" : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                      }`}>
                      {FILTER_LABELS[f]}
                    </button>
                  );
                })}
              </div>
            </div>}

            {selectedFilter === "calls" ? (
              /* Calls — same design as Calls tab */
              calls.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {calls.map((c, i) => (
                    <CallCard key={c.id} call={c} dk={dk} index={i}
                      onViewProfile={(u) => onViewProfile?.(u)}
                      onViewToken={(symbol, chain) => onViewToken?.(symbol, chain)}
                      onFade={onFadeCall}
                    />
                  ))}
                </div>
              ) : (
                <p className={`text-center py-8 text-[13px] ${dk ? "text-white/30" : "text-gray-400"}`}>No calls yet</p>
              )
            ) : selectedFilter === "debates" ? (
              /* Debates — same design as Hot Debates tab */
              debates.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {debates.map((d, i) => (
                    <DebateCard key={d.market.id} debate={d} dk={dk} index={i}
                      onViewProfile={(u) => onViewProfile?.(u)}
                      onViewToken={(symbol, chain) => onViewToken?.(symbol, chain)}
                      onFade={(marketId, side) => onFadeDebate?.(marketId, side)}
                    />
                  ))}
                </div>
              ) : (
                <p className={`text-center py-8 text-[13px] ${dk ? "text-white/30" : "text-gray-400"}`}>No active debates</p>
              )
            ) : (
              /* Markets grid — All: everything mixed by timestamp */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {selectedFilter === "all" ? (() => {
                  // Build unified feed sorted by timestamp
                  type FeedItem = { type: "market"; data: typeof sortedMarkets[0]; ts: number }
                    | { type: "call"; data: Call; ts: number }
                    | { type: "debate"; data: Debate; ts: number };

                  const items: FeedItem[] = [
                    ...sortedMarkets.map(m => ({ type: "market" as const, data: m, ts: new Date(m.last_bet_at ?? m.created_at).getTime() })),
                    ...calls.map(c => ({ type: "call" as const, data: c, ts: new Date(c.placed_at).getTime() })),
                    ...debates.map(d => ({ type: "debate" as const, data: d, ts: new Date(d.market.created_at).getTime() })),
                  ];
                  items.sort((a, b) => b.ts - a.ts);

                  return items.map((item, i) => {
                    if (item.type === "debate") {
                      return (
                        <motion.div key={`debate-${item.data.market.id}`} className="sm:col-span-2" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: i * 0.02 }}>
                          <DebateCard debate={item.data} dk={dk} index={i}
                            onViewProfile={(u) => onViewProfile?.(u)}
                            onViewToken={(symbol, chain) => onViewToken?.(symbol, chain)}
                            onFade={(marketId, side) => onFadeDebate?.(marketId, side)}
                          />
                        </motion.div>
                      );
                    }
                    if (item.type === "call") {
                      return (
                        <motion.div key={`call-${item.data.id}`} className="h-full" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: i * 0.02 }}>
                          <CallCard call={item.data} dk={dk} index={i}
                            onViewProfile={(u) => onViewProfile?.(u)}
                            onViewToken={(symbol, chain) => onViewToken?.(symbol, chain)}
                            onFade={onFadeCall}
                          />
                        </motion.div>
                      );
                    }
                    return (
                      <motion.div key={item.data.id} className="h-full" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: i * 0.02 }}>
                        <MarketCard market={item.data} dk={dk} onClick={() => onSelectToken?.(item.data.symbol, item.data.chain)} onTrade={() => setTradeMarket(item.data)} onBet={onBet} shaking={shakingIds?.has(item.data.id)} isP2PView={false} paperMode={paperMode} onAuthRequired={!loggedIn ? onAuthRequired : undefined} />
                      </motion.div>
                    );
                  });
                })() : sortedMarkets.map((m, i) => (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: i * 0.03 }}>
                    <MarketCard market={m} dk={dk} onClick={() => onSelectToken?.(m.symbol, m.chain)} onTrade={() => setTradeMarket(m)} onBet={onBet} shaking={shakingIds?.has(m.id)} isP2PView={selectedFilter === "p2p"} paperMode={paperMode} onAuthRequired={!loggedIn ? onAuthRequired : undefined} />
                  </motion.div>
                ))
              }
              </div>
            )}
          </>
        )}

      </div>
      </div>
    </div>

    <AnimatePresence>
      {tradeMarket && (
        <QuickTradeModal market={tradeMarket} dk={dk} paperMode={paperMode} presets={presets} onClose={() => setTradeMarket(null)} />
      )}
    </AnimatePresence>
    </>
  );
}
