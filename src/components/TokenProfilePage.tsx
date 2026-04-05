"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import type { Candle } from "@/lib/chartData";
import { api } from "@/lib/api";
import { TokenInfo, getOHLCV, resolutionForTf, searchBySymbol, getPriceByPair } from "@/lib/chartData";
import type { Market } from "@/lib/api";

const Chart = dynamic(() => import("./Chart"), { ssr: false });
const FEE = 0.05;
function calcMult(mine: number, other: number) { return mine === 0 ? 0 : 1 + (other * (1 - FEE)) / mine; }

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

function CopyCA({ ca, dk }: { ca: string; dk: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!ca) return null;
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(ca); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      title={ca}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[10px] font-mono transition-colors ${dk ? "text-white/25 hover:text-white/60 hover:bg-white/6" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"}`}
    >
      {copied ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2"/>
        </svg>
      )}
      {copied ? "copied!" : `${ca.slice(0, 5)}…${ca.slice(-4)}`}
    </button>
  );
}

// Mini sparkline SVG
function Sparkline({ candles, dk }: { candles: { close: number }[]; dk: boolean }) {
  if (candles.length < 2) return null;
  const values = candles.map(c => c.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 600, H = 80;
  const pad = 4;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (W - pad * 2) + pad;
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const isUp = values[values.length - 1] >= values[0];
  const color = isUp ? "#34d399" : "#f87171";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
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
  symbol: string;
  chain: string;
  timeframe: string;
  entry_price: string;
  status: string;
  long_pool: string;
  short_pool: string;
  is_paper: boolean;
  tagline: string;
  created_at: string;
  opener_username: string;
  opener_avatar: string | null;
}

interface Props {
  token: TokenInfo;
  dk: boolean;
  onClose: () => void;
  onViewChart?: () => void;
  onBet?: (marketId: string, side: "long" | "short", amount: number, message?: string) => Promise<string | null>;
  onAutoTrade?: (side: "long" | "short", amount: number, timeframe: string, tagline?: string) => Promise<string | null>;
  onOpenMarket?: () => void;
  onSweep?: (side: "long" | "short", amount: number, timeframe: string, symbol?: string, chain?: string) => Promise<string | null>;
  onPlaceOrder?: (side: "long" | "short", amount: number, timeframe: string, autoReopen: boolean, symbol?: string, chain?: string, ca?: string) => Promise<string | null>;
  loggedIn: boolean;
  onAuthRequired: () => void;
  paperMode: boolean;
  presets?: number[];
}

export default function TokenProfilePage({
  token, dk, onClose, onBet, onAutoTrade, onSweep, loggedIn, onAuthRequired, paperMode, presets = [5, 25, 100, 500],
}: Props) {
  const [markets, setMarkets]     = useState<MarketRow[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [candles, setCandles]     = useState<{ close: number }[]>([]);
  const [chartTf, setChartTf]     = useState("1h");
  const [loading, setLoading]     = useState(true);
  const [resolvedCA, setResolvedCA] = useState(token.address ?? "");

  // View tab: calls (social) or trade (chart + trade panel)
  const [viewTab, setViewTab]       = useState<"calls" | "trade">("calls");

  // Trade state
  const [tradeMode, setTradeMode]   = useState<"trade" | "sweep">("trade");
  const [tradeSide, setTradeSide]   = useState<"long" | "short" | null>(null);
  const [tradeAmt, setTradeAmt]     = useState<number | null>(null);
  const [tradeCustom, setTradeCustom] = useState("");
  const [tradeTf, setTradeTf]       = useState("5m");
  const [tradeMsg, setTradeMsg]     = useState("");
  const [tradeErr, setTradeErr]     = useState("");
  const [tradeLoading, setTradeLoading] = useState(false);
  const [bigCandles, setBigCandles] = useState<Candle[]>([]);
  const [bigChartLoading, setBigChartLoading] = useState(false);
  const [livePrice, setLivePrice]   = useState<number | null>(null);

  // If address is empty (navigated from feed card), look it up
  useEffect(() => {
    if (!token.address && token.symbol) {
      searchBySymbol(token.symbol, token.chainLabel).then(info => {
        if (info?.address) setResolvedCA(info.address);
      }).catch(() => {});
    }
  }, [token.address, token.symbol, token.chainLabel]);

  const bg      = dk ? "bg-[#0c0c0c]" : "bg-white";
  const border  = dk ? "border-white/8" : "border-gray-100";
  const muted   = dk ? "text-white/40" : "text-gray-400";
  const strong  = dk ? "text-white" : "text-gray-900";
  const rowHov  = dk ? "hover:bg-white/[0.03]" : "hover:bg-gray-50";

  useEffect(() => {
    setLoading(true);
    api.getTokenFeed(token.symbol).then(data => {
      setMarkets((data.markets ?? []).filter((m: any) => m && m.symbol));
      setPositions((data.positions ?? []).filter((p: any) => p && p.side));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [token.symbol]);

  useEffect(() => {
    const addr = token.pairAddress || token.address;
    if (!addr) return;
    const { resolution, limit } = resolutionForTf(chartTf);
    getOHLCV(addr, token.chainLabel ?? "solana", resolution, limit).then(c => setCandles(c)).catch(() => {});
  }, [token.pairAddress, token.address, chartTf]);

  // Fetch bigger chart when trade tab is active
  const fetchBigChart = useCallback(async (tf: string) => {
    const addr = token.pairAddress || token.address || resolvedCA;
    if (!addr) return;
    setBigChartLoading(true);
    try {
      const { resolution, limit } = resolutionForTf(tf);
      const data = await getOHLCV(addr, token.chainLabel ?? "solana", resolution, limit);
      setBigCandles(data);
    } catch {}
    setBigChartLoading(false);
  }, [token.pairAddress, token.address, resolvedCA, token.chainLabel]);

  useEffect(() => {
    if (viewTab === "trade") fetchBigChart(chartTf);
  }, [viewTab, chartTf, fetchBigChart]);

  // Live price poll when in trade view
  useEffect(() => {
    if (viewTab !== "trade" || !token.pairAddress || !token.chainId) return;
    const poll = async () => {
      try { const p = await getPriceByPair(token.chainId, token.pairAddress); if (p) setLivePrice(p); } catch {}
    };
    poll();
    const i = setInterval(poll, 5_000);
    return () => clearInterval(i);
  }, [viewTab, token.pairAddress, token.chainId]);

  // Active market for trade
  const activeTradeMarket = markets
    .filter(m => m.symbol && m.status === "open" && m.timeframe === tradeTf && !!m.is_paper === paperMode)
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())[0] ?? null;

  const tLongPool  = activeTradeMarket ? parseFloat(activeTradeMarket.long_pool)  : 0;
  const tShortPool = activeTradeMarket ? parseFloat(activeTradeMarket.short_pool) : 0;
  const tTotal     = tLongPool + tShortPool;
  const tLongMult  = tTotal > 0 ? calcMult(tLongPool, tShortPool)  : 1.95;
  const tShortMult = tTotal > 0 ? calcMult(tShortPool, tLongPool)  : 1.95;

  const tradeFinalAmt = tradeCustom ? parseFloat(tradeCustom) || null : tradeAmt;
  const tradeReady = !!tradeSide && !!tradeFinalAmt && tradeFinalAmt >= 1;

  async function handleTrade() {
    if (!tradeReady) return;
    if (!loggedIn) { onAuthRequired(); return; }
    setTradeLoading(true); setTradeErr("");
    let err: string | null = null;
    if (tradeMode === "sweep" && onSweep) {
      err = await onSweep(tradeSide!, tradeFinalAmt!, tradeTf, token.symbol, token.chainLabel);
    } else if (!activeTradeMarket && onAutoTrade) {
      err = await onAutoTrade(tradeSide!, tradeFinalAmt!, tradeTf, tradeMsg.trim() || undefined);
    } else if (activeTradeMarket && onBet) {
      err = await onBet(activeTradeMarket.id, tradeSide!, tradeFinalAmt!, tradeMsg.trim() || undefined);
    }
    setTradeLoading(false);
    if (err) setTradeErr(err);
    else { setTradeSide(null); setTradeAmt(null); setTradeCustom(""); setTradeMsg(""); }
  }

  const modeMarketIds = new Set(markets.filter(m => m.status === "open" && !!m.is_paper === paperMode).map(m => m.id));
  const modePositions = positions.filter(p => modeMarketIds.has(p.market_id ?? ""));
  const totalLong  = modePositions.filter(p => p.side === "long").reduce((s, p) => s + parseFloat(p.amount), 0);
  const totalShort = modePositions.filter(p => p.side === "short").reduce((s, p) => s + parseFloat(p.amount), 0);
  const totalVol   = totalLong + totalShort;
  const longPct    = totalVol > 0 ? (totalLong / totalVol) * 100 : 50;

  // Positions: opener first (if has message), then sorted by amount
  const sortedPositions = [...modePositions].sort((a, b) => {
    if (a.is_opener && !b.is_opener) return -1;
    if (!a.is_opener && b.is_opener) return 1;
    return parseFloat(b.amount) - parseFloat(a.amount);
  });

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
            <div className="flex items-center gap-1.5">
              <p className={`text-[12px] ${muted}`}>{token.name}</p>
              <CopyCA ca={resolvedCA} dk={dk} />
            </div>
          </div>
          <div className="text-right">
            <p className={`text-[18px] font-black font-mono ${strong}`}>${formatPrice(token.price)}</p>
            {token.marketCap > 0 && <p className={`text-[11px] ${muted}`}>MC {formatNum(token.marketCap)}</p>}
          </div>
        </div>

        {/* Chart — sparkline in Calls mode, full chart in Trade mode */}
        <div className={`mb-3 rounded-xl overflow-hidden transition-all ${viewTab === "trade" ? "h-[180px]" : "h-16"} ${viewTab === "trade" ? dk ? "bg-[#0e0e0e]" : "bg-gray-50" : ""}`}>
          {viewTab === "trade" && bigCandles.length > 0 ? (
            <Chart candles={bigCandles} livePrice={livePrice ?? undefined} dk={dk} />
          ) : (
            <Sparkline candles={candles} dk={dk} />
          )}
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
        </div>

      </div>

      {/* Calls / Trade tabs */}
      <div className={`flex border-b ${border} sticky top-0 z-10 ${dk ? "bg-[#0c0c0c]" : "bg-white"}`}>
        {(["calls", "trade"] as const).map(tab => (
          <button key={tab} onClick={() => setViewTab(tab)}
            className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-wider transition-all relative ${
              viewTab === tab ? dk ? "text-white" : "text-gray-900" : dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"
            }`}>
            {tab === "calls" ? "Calls" : "Trade"}
            {viewTab === tab && <span className={`absolute bottom-0 left-0 right-0 h-[2px] ${dk ? "bg-white" : "bg-gray-900"}`} />}
          </button>
        ))}
      </div>

      {/* ── TRADE VIEW ── */}
      {viewTab === "trade" && (
        <div className="px-5 py-4">
          {/* Order type: Market | Sweep | Advanced */}
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => setTradeMode("trade")}
              className={`text-[11px] font-black transition-all ${tradeMode === "trade" ? dk ? "text-white" : "text-gray-900" : dk ? "text-white/30 hover:text-white/50" : "text-gray-400 hover:text-gray-600"}`}>
              Market
            </button>
            <button onClick={() => setTradeMode("sweep")}
              className={`text-[11px] font-black transition-all ${tradeMode === "sweep" ? dk ? "text-white" : "text-gray-900" : dk ? "text-white/30 hover:text-white/50" : "text-gray-400 hover:text-gray-600"}`}>
              Sweep
            </button>
            <span className={`text-[11px] font-bold cursor-default ${dk ? "text-white/15" : "text-gray-300"}`}>
              Advanced ▾
            </span>
          </div>

          {/* Side */}
          <div className="flex gap-2 mb-3">
            <motion.button whileTap={{ scale: 0.96 }} onClick={() => { if (!loggedIn) { onAuthRequired(); return; } setTradeSide(tradeSide === "long" ? null : "long"); }}
              className={`flex-1 rounded-xl py-2.5 text-center transition-all ${tradeSide === "long" ? "bg-emerald-500" : dk ? "bg-emerald-500/10" : "bg-emerald-50"}`}>
              <p className={`text-[14px] font-black ${tradeSide === "long" ? "text-white" : "text-emerald-300"}`}>{loggedIn ? "▲ Long" : "Sign in"}</p>
              <p className={`text-[10px] font-black ${tradeSide === "long" ? "text-emerald-100/80" : "text-emerald-400/60"}`}>{tLongMult.toFixed(2)}x</p>
            </motion.button>
            <motion.button whileTap={{ scale: 0.96 }} onClick={() => { if (!loggedIn) { onAuthRequired(); return; } setTradeSide(tradeSide === "short" ? null : "short"); }}
              className={`flex-1 rounded-xl py-2.5 text-center transition-all ${tradeSide === "short" ? "bg-red-500" : dk ? "bg-red-500/10" : "bg-rose-50"}`}>
              <p className={`text-[14px] font-black ${tradeSide === "short" ? "text-white" : "text-red-300"}`}>{loggedIn ? "▼ Short" : "Sign in"}</p>
              <p className={`text-[10px] font-black ${tradeSide === "short" ? "text-red-100/80" : "text-red-400/60"}`}>{tShortMult.toFixed(2)}x</p>
            </motion.button>
          </div>

          {/* Duration (Trade only) */}
          {tradeMode === "trade" && (
            <div className="mb-3">
              <p className={`text-[8px] font-black uppercase tracking-widest mb-1.5 ${muted}`}>Duration</p>
              <div className="flex flex-wrap gap-1">
                {TFS.map(tf => (
                  <button key={tf} onClick={() => setTradeTf(tf)}
                    className={`text-[10px] font-black px-2.5 py-1 rounded-full border transition-all ${
                      tradeTf === tf
                        ? dk ? "bg-white text-black border-white" : "bg-gray-900 text-white border-gray-900"
                        : dk ? "bg-white/5 text-white/40 border-white/10" : "bg-gray-100 text-gray-400 border-gray-200"
                    }`}>{tf}</button>
                ))}
              </div>
            </div>
          )}
          {tradeMode === "sweep" && (
            <p className={`text-[8px] font-black uppercase tracking-widest mb-3 ${muted} opacity-50`}>Sweeps all open timeframes</p>
          )}

          {/* Amount */}
          <div className="mb-3">
            <p className={`text-[8px] font-black uppercase tracking-widest mb-1.5 ${muted}`}>Amount</p>
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {presets.map(a => (
                <button key={a} onClick={() => { setTradeAmt(a); setTradeCustom(String(a)); }}
                  className={`py-1.5 rounded-lg text-[10px] font-black transition-all ${
                    tradeAmt === a && tradeCustom === String(a)
                      ? tradeSide === "long" ? "bg-emerald-500 text-white" : tradeSide === "short" ? "bg-red-500 text-white" : dk ? "bg-white text-black" : "bg-gray-900 text-white"
                      : dk ? "bg-white/5 text-white/40" : "bg-gray-100 text-gray-400"
                  }`}>${a}</button>
              ))}
            </div>
            <div className="relative">
              <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${muted}`}>$</span>
              <input type="number" placeholder="custom" value={tradeCustom}
                onChange={e => { setTradeCustom(e.target.value); setTradeAmt(null); }}
                className={`w-full border text-[11px] font-bold pl-6 pr-3 py-1.5 rounded-lg outline-none transition-all ${dk ? "bg-white/5 border-white/8 text-white placeholder:text-white/20" : "bg-gray-50 border-gray-200 text-gray-900"}`} />
            </div>
          </div>

          {/* Message (Trade only) */}
          {tradeMode === "trade" && (
            <textarea value={tradeMsg} onChange={e => setTradeMsg(e.target.value)}
              maxLength={60} placeholder={`${token.symbol} to the moon!`} rows={1}
              className={`w-full border text-[10px] font-bold p-2 rounded-lg outline-none resize-none mb-3 transition-all ${dk ? "bg-white/5 border-white/8 text-white placeholder:text-white/15" : "bg-gray-50 border-gray-200 text-gray-900"}`} />
          )}

          {tradeErr && <p className="text-[10px] font-bold text-red-400 mb-2">{tradeErr}</p>}

          <motion.button whileTap={{ scale: 0.97 }} onClick={handleTrade} disabled={!tradeReady || tradeLoading}
            className={`w-full py-3 rounded-xl text-[12px] font-black uppercase tracking-widest transition-all ${
              tradeLoading ? dk ? "bg-white/8 text-white/30" : "bg-gray-100 text-gray-400"
              : tradeReady
                ? tradeSide === "long" ? "bg-emerald-500 text-white hover:bg-emerald-400" : "bg-red-500 text-white hover:bg-red-400"
                : dk ? "bg-white/10 text-white/40 cursor-not-allowed" : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}>
            {tradeLoading ? "Placing..." : tradeMode === "sweep" ? `Sweep ${tradeSide === "long" ? "▲" : tradeSide === "short" ? "▼" : ""} ${tradeFinalAmt ? `$${tradeFinalAmt}` : ""}`.trim() : activeTradeMarket ? "Trade" : "Open Market"}
          </motion.button>
        </div>
      )}

      {/* ── CALLS VIEW ── */}
      {viewTab === "calls" && (
      <div className="pb-6">
        {loading && (
          <div className="flex justify-center py-10">
            <span className={`text-[12px] animate-pulse ${muted}`}>Loading…</span>
          </div>
        )}

        {!loading && sortedPositions.length === 0 && (
          <div className="text-center py-10">
            <p className={`text-[13px] font-bold ${muted}`}>No calls yet</p>
            <p className={`text-[11px] ${muted} mt-1`}>Be the first to make a call on ${token.symbol}</p>
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
      )}
    </motion.div>
  );
}
