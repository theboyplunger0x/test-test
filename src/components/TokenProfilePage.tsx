"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { TokenInfo, getOHLCV, resolutionForTf } from "@/lib/chartData";

const TFS = ["1m", "5m", "15m", "1h", "4h", "24h"];

function formatPrice(n: number): string {
  if (n === 0) return "0";
  if (n >= 1) return n.toFixed(4);
  const s = n.toFixed(12).replace(/0+$/, "");
  const match = s.match(/^0\.(0+)/);
  if (match) {
    const zeros = match[1].length;
    if (zeros >= 4) return `0.0{${zeros}}${s.slice(2 + zeros, 2 + zeros + 4)}`;
  }
  return n.toPrecision(4);
}

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Mini sparkline SVG
function Sparkline({ candles, dk }: { candles: { close: number }[]; dk: boolean }) {
  if (candles.length < 2) return null;
  const values = candles.map(c => c.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 240, H = 48;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x},${y}`;
  }).join(" ");
  const isUp = values[values.length - 1] >= values[0];
  const color = isUp ? "#34d399" : "#f87171";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

interface Position {
  id: string;
  market_id: string;
  side: "long" | "short";
  amount: string;
  message: string | null;
  placed_at: string;
  is_paper: boolean;
  username: string;
  avatar_url: string | null;
  tier: string;
  is_opener: boolean;
}

interface MarketRow {
  id: string;
  timeframe: string;
  entry_price: string;
  status: string;
  long_pool: string;
  short_pool: string;
  is_paper: boolean;
  tagline: string;
  opener_username: string;
  opener_avatar: string | null;
}

interface Props {
  token: TokenInfo;
  dk: boolean;
  onClose: () => void;
  onViewChart: () => void;
  onBet: (marketId: string, side: "long" | "short", amount: number, message?: string) => Promise<string | null>;
  onOpenMarket: () => void;
  loggedIn: boolean;
  onAuthRequired: () => void;
  paperMode: boolean;
  presets: number[];
}

export default function TokenProfilePage({
  token, dk, onClose, onViewChart, onBet, onOpenMarket, loggedIn, onAuthRequired, paperMode, presets,
}: Props) {
  const [markets, setMarkets]     = useState<MarketRow[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [candles, setCandles]     = useState<{ close: number }[]>([]);
  const [chartTf, setChartTf]     = useState("1h");
  const [loading, setLoading]     = useState(true);
  const [betMarket, setBetMarket] = useState<MarketRow | null>(null);
  const [betSide, setBetSide]     = useState<"long" | "short" | null>(null);
  const [betAmt, setBetAmt]       = useState<number | null>(null);
  const [betMsg, setBetMsg]       = useState("");
  const [betCustom, setBetCustom] = useState("");
  const [betLoading, setBetLoading] = useState(false);
  const [betError, setBetError]   = useState<string | null>(null);
  const [betDone, setBetDone]     = useState(false);

  const bg      = dk ? "bg-[#0c0c0c]" : "bg-white";
  const border  = dk ? "border-white/8" : "border-gray-100";
  const muted   = dk ? "text-white/40" : "text-gray-400";
  const strong  = dk ? "text-white" : "text-gray-900";
  const rowHov  = dk ? "hover:bg-white/[0.03]" : "hover:bg-gray-50";

  useEffect(() => {
    setLoading(true);
    api.getTokenFeed(token.symbol).then(data => {
      setMarkets(data.markets ?? []);
      setPositions(data.positions ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [token.symbol]);

  useEffect(() => {
    const addr = token.pairAddress || token.address;
    if (!addr) return;
    const { resolution, limit } = resolutionForTf(chartTf);
    getOHLCV(addr, token.chainLabel ?? "solana", resolution, limit).then(c => setCandles(c)).catch(() => {});
  }, [token.pairAddress, token.address, chartTf]);

  const totalLong  = positions.filter(p => p.side === "long").reduce((s, p) => s + parseFloat(p.amount), 0);
  const totalShort = positions.filter(p => p.side === "short").reduce((s, p) => s + parseFloat(p.amount), 0);
  const totalVol   = totalLong + totalShort;
  const longPct    = totalVol > 0 ? (totalLong / totalVol) * 100 : 50;

  // Positions: opener first (if has message), then sorted by amount
  const sortedPositions = [...positions].sort((a, b) => {
    if (a.is_opener && !b.is_opener) return -1;
    if (!a.is_opener && b.is_opener) return 1;
    return parseFloat(b.amount) - parseFloat(a.amount);
  });

  const finalBetAmt = betCustom ? parseFloat(betCustom) : betAmt;

  async function handleBet() {
    if (!betMarket || !betSide || !finalBetAmt) return;
    if (!loggedIn) { onAuthRequired(); return; }
    setBetLoading(true);
    setBetError(null);
    const err = await onBet(betMarket.id, betSide, finalBetAmt, betMsg.trim() || undefined);
    setBetLoading(false);
    if (err) { setBetError(err); return; }
    setBetDone(true);
    // refresh feed
    api.getTokenFeed(token.symbol).then(data => {
      setMarkets(data.markets ?? []);
      setPositions(data.positions ?? []);
    }).catch(() => {});
    setTimeout(() => { setBetMarket(null); setBetSide(null); setBetAmt(null); setBetCustom(""); setBetMsg(""); setBetDone(false); setBetError(null); }, 2000);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={`flex-1 overflow-y-auto ${bg}`}
    >
      {/* Header */}
      <div className={`px-5 pt-5 pb-4 border-b ${border}`}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-[22px] font-black ${strong}`}>${token.symbol}</span>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${dk ? "bg-white/8 text-white/50" : "bg-gray-100 text-gray-500"}`}>{token.chainLabel}</span>
              <span className={`text-[11px] font-bold ${token.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {token.change24h >= 0 ? "+" : ""}{token.change24h.toFixed(1)}%
              </span>
            </div>
            <p className={`text-[12px] ${muted}`}>{token.name}</p>
          </div>
          <div className="text-right">
            <p className={`text-[18px] font-black font-mono ${strong}`}>${formatPrice(token.price)}</p>
            {token.marketCap > 0 && <p className={`text-[11px] ${muted}`}>MC {formatNum(token.marketCap)}</p>}
          </div>
        </div>

        {/* Mini chart */}
        <div className="mb-3 h-12">
          <Sparkline candles={candles} dk={dk} />
        </div>

        {/* Chart TF selector */}
        <div className="flex gap-1">
          {TFS.map(tf => (
            <button key={tf} onClick={() => setChartTf(tf)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all ${
                chartTf === tf
                  ? dk ? "bg-white text-black" : "bg-gray-900 text-white"
                  : dk ? "bg-white/6 text-white/35 hover:bg-white/12" : "bg-gray-100 text-gray-400 hover:bg-gray-200"
              }`}>{tf}</button>
          ))}
          <button onClick={onViewChart}
            className={`ml-auto px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"}`}>
            Full chart →
          </button>
        </div>

        {/* Pool bar */}
        {totalVol > 0 && (
          <div className="mt-3">
            <div className="flex justify-between text-[10px] font-bold mb-1">
              <span className="text-emerald-400">▲ Long {longPct.toFixed(0)}%</span>
              <span className="text-red-400">{(100 - longPct).toFixed(0)}% Short ▼</span>
            </div>
            <div className={`h-1.5 rounded-full overflow-hidden ${dk ? "bg-red-500/20" : "bg-red-100"}`}>
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${longPct}%` }} />
            </div>
            <p className={`text-[10px] font-bold text-center mt-1 ${muted}`}>
              Total volume: {formatNum(totalVol)} · {positions.length} trader{positions.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>

      {/* Markets + bet */}
      {markets.length > 0 && (
        <div className={`px-5 py-3 border-b ${border}`}>
          <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${muted}`}>Open markets</p>
          <div className="flex flex-wrap gap-2">
            {markets.filter(m => m.status === "open").map(m => (
              <button key={m.id}
                onClick={() => { setBetMarket(m); setBetSide(null); setBetAmt(null); setBetCustom(""); setBetMsg(""); setBetDone(false); setBetError(null); }}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-black border transition-all ${
                  betMarket?.id === m.id
                    ? dk ? "bg-white text-black border-white" : "bg-gray-900 text-white border-gray-900"
                    : dk ? "bg-white/5 text-white/60 border-white/10 hover:bg-white/10" : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                }`}>
                {m.timeframe} {m.is_paper ? "· paper" : ""}
              </button>
            ))}
            <button onClick={onOpenMarket}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-black border border-dashed transition-all ${
                dk ? "border-white/15 text-white/30 hover:border-white/30 hover:text-white/60" : "border-gray-300 text-gray-400 hover:text-gray-600"
              }`}>
              + Open market
            </button>
          </div>
        </div>
      )}

      {/* Bet panel */}
      <AnimatePresence>
        {betMarket && !betDone && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className={`overflow-hidden border-b ${border}`}>
            <div className="px-5 py-4 space-y-3">
              <p className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>Trade · {betMarket.timeframe}</p>
              <div className="flex gap-2">
                <button onClick={() => setBetSide("long")}
                  className={`flex-1 py-2.5 rounded-xl text-[12px] font-black transition-all ${betSide === "long" ? "bg-emerald-500 text-white" : dk ? "bg-emerald-500/10 text-emerald-400/60 hover:bg-emerald-500/20" : "bg-emerald-50 text-emerald-600"}`}>
                  ▲ Long
                </button>
                <button onClick={() => setBetSide("short")}
                  className={`flex-1 py-2.5 rounded-xl text-[12px] font-black transition-all ${betSide === "short" ? "bg-red-500 text-white" : dk ? "bg-red-500/10 text-red-400/60 hover:bg-red-500/20" : "bg-rose-50 text-red-600"}`}>
                  ▼ Short
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {presets.map(a => (
                  <button key={a} onClick={() => { setBetAmt(a); setBetCustom(String(a)); }}
                    className={`py-1.5 rounded-lg text-[11px] font-black transition-all ${
                      betAmt === a && betCustom === String(a)
                        ? dk ? "bg-white/20 text-white" : "bg-gray-300 text-gray-900"
                        : dk ? "bg-white/6 text-white/40 hover:bg-white/12" : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                    }`}>${a}</button>
                ))}
              </div>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[12px] font-bold ${muted}`}>$</span>
                <input type="number" placeholder="custom" value={betCustom}
                  onChange={e => { setBetCustom(e.target.value); setBetAmt(null); }}
                  className={`w-full pl-6 pr-3 py-2 rounded-xl text-[12px] font-bold border outline-none transition-all ${dk ? "bg-white/5 border-white/8 text-white placeholder:text-white/20" : "bg-gray-50 border-gray-200 text-gray-900"}`} />
              </div>
              <textarea value={betMsg} onChange={e => setBetMsg(e.target.value)} maxLength={80} rows={2}
                placeholder="Your take (optional)"
                className={`w-full border text-[12px] font-bold p-3 rounded-xl outline-none resize-none transition-all ${dk ? "bg-white/5 border-white/8 text-white placeholder:text-white/20" : "bg-gray-50 border-gray-200 text-gray-900"}`} />
              {betError && <p className="text-[11px] text-red-400">{betError}</p>}
              <button onClick={handleBet} disabled={!betSide || !finalBetAmt || betLoading}
                className={`w-full py-3 rounded-xl text-[13px] font-black transition-all disabled:opacity-40 ${dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white"}`}>
                {betLoading ? "Placing…" : `${betSide === "long" ? "▲ Long" : betSide === "short" ? "▼ Short" : "Place"} $${finalBetAmt ?? "—"}`}
              </button>
              <button onClick={() => setBetMarket(null)} className={`text-[11px] font-bold ${muted} hover:opacity-70 transition-opacity`}>← Cancel</button>
            </div>
          </motion.div>
        )}
        {betDone && (
          <div className={`px-5 py-3 border-b ${border}`}>
            <p className="text-emerald-400 text-[13px] font-black text-center">Trade placed ✓</p>
          </div>
        )}
      </AnimatePresence>

      {/* Positions feed */}
      <div className="pb-6">
        {loading && (
          <div className="flex justify-center py-10">
            <span className={`text-[12px] animate-pulse ${muted}`}>Loading…</span>
          </div>
        )}

        {!loading && sortedPositions.length === 0 && (
          <div className="text-center py-10">
            <p className={`text-[13px] font-bold ${muted}`}>No positions yet</p>
            <p className={`text-[11px] ${muted} mt-1`}>Be the first to open a market</p>
          </div>
        )}

        {sortedPositions.map((pos, i) => (
          <div key={pos.id} className={`flex items-start gap-3 px-5 py-3.5 border-b transition-colors ${border} ${rowHov}`}>
            {/* Avatar */}
            <div className="shrink-0 mt-0.5">
              {pos.avatar_url ? (
                <img src={pos.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-black ${dk ? "bg-white/8 text-white/50" : "bg-gray-100 text-gray-500"}`}>
                  {pos.username.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                <span className={`text-[12px] font-black ${strong}`}>{pos.username}</span>
                {pos.is_opener && (
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">
                    opener
                  </span>
                )}
                {pos.tier === "top" && <span className="text-yellow-400 text-[11px]">★</span>}
                <span className={`text-[10px] font-bold ${pos.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
                  {pos.side === "long" ? "▲" : "▼"} ${parseFloat(pos.amount).toFixed(0)}
                </span>
                <span className={`text-[10px] ${muted}`}>· {timeAgo(pos.placed_at)}</span>
              </div>
              {pos.message && (
                <p className={`text-[12px] leading-snug ${pos.is_opener ? "text-yellow-400/90 font-bold" : dk ? "text-white/70" : "text-gray-600"}`}>
                  {pos.message}
                </p>
              )}
            </div>

            {/* Amount */}
            <div className="shrink-0 text-right">
              <span className={`text-[11px] font-black ${pos.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
                ${parseFloat(pos.amount).toFixed(0)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
