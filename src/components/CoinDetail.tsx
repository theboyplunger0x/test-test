"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import type { Candle, TokenInfo } from "@/lib/chartData";
import { searchBySymbol, getOHLCV, resolutionForTf } from "@/lib/chartData";
import { api, Market } from "@/lib/api";

const Chart = dynamic(() => import("./Chart"), { ssr: false });

const FEE = 0.05;
const AMOUNTS = [5, 25, 100, 500];
const TIMEFRAMES = ["5m", "15m", "1h", "4h", "24h"];

function mult(mine: number, other: number) {
  if (mine === 0) return 0;
  return 1 + (other * (1 - FEE)) / mine;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

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

function formatMcap(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

interface Props {
  symbol: string;
  chain: string;
  timeframe: string;
  theme: "dark" | "light";
  markets: Market[];        // live markets for this symbol
  onBet: (marketId: string, side: "long" | "short", amount: number) => Promise<string | null>;
  onAutoTrade?: (side: "long" | "short", amount: number, timeframe: string) => Promise<string | null>;
  onOpenMarket: () => void;
  loggedIn: boolean;
  onAuthRequired: () => void;
  tokenInfo?: TokenInfo;    // pre-fetched (from CA search); skips symbol lookup
}

export default function CoinDetail({
  symbol, chain, timeframe: initialTf, theme,
  markets, onBet, onAutoTrade, onOpenMarket, loggedIn, onAuthRequired,
  tokenInfo: tokenInfoProp,
}: Props) {
  const dk = theme === "dark";
  const [timeframe, setTimeframe] = useState(initialTf);
  const [chartTf, setChartTf]     = useState(initialTf);   // independent chart timeframe
  const [chartView, setChartView] = useState<"price" | "mcap">("price");

  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(tokenInfoProp ?? null);
  const [candles, setCandles]     = useState<Candle[]>([]);
  const [loading, setLoading]     = useState(true);
  const [tick, setTick]           = useState(0);
  const [livePrice, setLivePrice] = useState<number | null>(null);

  // countdown ticker
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);
  void tick;

  // Fetch token info + pair address (skip if already provided)
  useEffect(() => {
    if (tokenInfoProp) { setTokenInfo(tokenInfoProp); return; }
    searchBySymbol(symbol, chain).then(setTokenInfo);
  }, [symbol, chain, tokenInfoProp]);

  // When trade duration changes, sync chart to show same timeframe
  useEffect(() => { setChartTf(timeframe); }, [timeframe]);

  // Fetch OHLCV candles when pair address or chartTf changes
  const fetchCandles = useCallback(async (pairAddr: string, tf: string) => {
    const { resolution, limit } = resolutionForTf(tf);
    const data = await getOHLCV(pairAddr, chain, resolution, limit);
    setCandles(data);
    setLoading(false);
  }, [chain]);

  useEffect(() => {
    if (!tokenInfo?.pairAddress) return;
    setLoading(true);
    fetchCandles(tokenInfo.pairAddress, chartTf);
  }, [tokenInfo, chartTf, fetchCandles]);

  // Full OHLCV refresh every 30s (historical shape)
  useEffect(() => {
    if (!tokenInfo?.pairAddress) return;
    const i = setInterval(() => fetchCandles(tokenInfo!.pairAddress, chartTf), 30_000);
    return () => clearInterval(i);
  }, [tokenInfo, chartTf, fetchCandles]);

  // Fast price poll every 5s — updates just the last chart point via livePrice prop
  useEffect(() => {
    if (!tokenInfo) return;
    const poll = async () => {
      const info = await searchBySymbol(symbol, chain);
      if (info) { setLivePrice(info.price); setTokenInfo(info); }
    };
    poll();
    const i = setInterval(poll, 5_000);
    return () => clearInterval(i);
  }, [tokenInfo?.pairAddress, symbol, chain]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transform candles for market cap view: multiply price values by circulating supply
  // Supply approximated as currentMcap / currentPrice (constant supply assumption)
  const displayCandles = (() => {
    if (chartView === "price" || !tokenInfo || !tokenInfo.marketCap || !tokenInfo.price || candles.length === 0) return candles;
    const supply = tokenInfo.marketCap / tokenInfo.price;
    return candles.map(c => ({
      time:  c.time,
      open:  c.open  * supply,
      high:  c.high  * supply,
      low:   c.low   * supply,
      close: c.close * supply,
    }));
  })();

  // Active market for this symbol (most recent, open)
  const activeMarket = markets
    .filter((m) => m.symbol === symbol && m.status === "open")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;

  const msLeft    = activeMarket ? Math.max(0, new Date(activeMarket.closes_at).getTime() - Date.now()) : 0;
  const tfMs      = { "5m": 5*60000, "15m": 15*60000, "1h": 3600000, "4h": 14400000, "24h": 86400000 }[activeMarket?.timeframe ?? "1h"] ?? 3600000;
  const progress  = activeMarket ? Math.max(0, Math.min(100, ((tfMs - msLeft) / tfMs) * 100)) : 0;

  const longPool  = activeMarket ? parseFloat(activeMarket.long_pool)  : 0;
  const shortPool = activeMarket ? parseFloat(activeMarket.short_pool) : 0;
  const total     = longPool + shortPool;
  const longPct   = total > 0 ? Math.round((longPool  / total) * 100) : 50;
  const shortPct  = 100 - longPct;
  // Default ~1.95x when no market yet (50/50 pool, 5% fee); avoid showing 0x when pools are empty
  const DEFAULT_MULT = 1.95;
  const longMult  = total > 0 ? mult(longPool,  shortPool) : DEFAULT_MULT;
  const shortMult = total > 0 ? mult(shortPool, longPool)  : DEFAULT_MULT;

  const [side, setSide]         = useState<"long" | "short" | null>(null);
  const [amount, setAmount]     = useState<number | null>(null);
  const [customAmt, setCustomAmt] = useState("");
  const [betError, setBetError] = useState("");
  const [betLoading, setBetLoading] = useState(false);

  const parsedCustom = customAmt !== "" ? parseFloat(customAmt) : NaN;
  const finalAmount  = customAmt !== "" ? (isNaN(parsedCustom) ? null : parsedCustom) : amount;
  const isReady      = side && finalAmount != null && finalAmount >= 5;
  const activeMult   = side === "long" ? longMult : shortMult;
  const winAmount    = finalAmount != null && finalAmount > 0 && side
    ? (finalAmount * activeMult).toFixed(0)
    : null;

  const entryPrice  = activeMarket ? parseFloat(activeMarket.entry_price) : tokenInfo?.price;

  async function handleTrade() {
    if (!isReady) return;
    if (!loggedIn) { onAuthRequired(); return; }
    setBetLoading(true);
    setBetError("");
    let err: string | null;
    if (!activeMarket) {
      if (onAutoTrade) {
        err = await onAutoTrade(side!, finalAmount!, timeframe);
      } else {
        onOpenMarket();
        setBetLoading(false);
        return;
      }
    } else {
      err = await onBet(activeMarket.id, side!, finalAmount!);
    }
    setBetLoading(false);
    if (err) setBetError(err);
    else { setSide(null); setAmount(null); setCustomAmt(""); }
  }

  // ── Theme ──────────────────────────────────────────────────────────────────
  const T = {
    chartBg:     dk ? "" : "bg-gray-50",
    panelBg:     dk ? "bg-[#0e0e0e]" : "bg-white",
    textPrimary: dk ? "text-white"    : "text-gray-900",
    textMuted:   dk ? "text-white/30" : "text-gray-400",
    priceLbl:    dk ? "text-white/35" : "text-gray-400",
    priceVal:    dk ? "text-white/80 font-mono" : "text-gray-700 font-mono",
    changePill:  (up: boolean) => up
      ? dk ? "text-emerald-300 bg-emerald-500/20" : "text-emerald-700 bg-emerald-100"
      : dk ? "text-red-300 bg-red-500/20"         : "text-red-700 bg-red-100",
    chainPill:   (c: string) => {
      if (c === "SOL")  return dk ? "text-purple-300 bg-purple-500/20" : "text-purple-700 bg-purple-100";
      if (c === "BASE") return dk ? "text-blue-300 bg-blue-500/20"     : "text-blue-700 bg-blue-100";
      if (c === "BSC")  return dk ? "text-yellow-300 bg-yellow-500/20" : "text-yellow-700 bg-yellow-100";
      return dk ? "text-orange-300 bg-orange-500/20" : "text-orange-700 bg-orange-100";
    },
    cdBarBg:     dk ? "bg-white/5"  : "bg-gray-100",
    cdBarFill:   dk ? "from-white/20 to-white/40" : "from-blue-400 to-blue-600",
    upIdle:      dk ? "bg-emerald-500/10 border-2 border-emerald-500/25" : "bg-emerald-50 border-2 border-emerald-200",
    downIdle:    dk ? "bg-red-500/10 border-2 border-red-500/25"         : "bg-rose-50 border-2 border-rose-200",
    amtIdle:     dk ? "bg-white/7 text-white/50 hover:bg-white/12 hover:text-white" : "bg-blue-50 text-blue-600 hover:bg-blue-100",
    input:       dk ? "bg-white/5 border-white/8 text-white placeholder:text-white/20 focus:border-white/20"
                    : "bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-300 focus:border-blue-300",
    toggleBase:  dk ? "bg-white/5" : "bg-gray-100",
    toggleActive:dk ? "bg-white text-black" : "bg-gray-900 text-white",
    toggleInact: dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700",
    durIdle:     dk ? "border-white/8 text-white/30 hover:border-white/20 hover:text-white/60"
                    : "border-blue-100 text-blue-400 hover:text-blue-600 hover:border-blue-300",
    durActive:   dk ? "border-white/30 bg-white/12 text-white" : "border-blue-400 bg-blue-50 text-blue-700",
    sectionLbl:  dk ? "text-white/25" : "text-gray-400",
    poolLabel:   dk ? "text-white/25" : "text-gray-400",
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

      {/* ── TOP/LEFT: Chart area ─────────────────────────────── */}
      <div className={`flex-1 flex flex-col overflow-hidden ${T.chartBg}`} style={{ minHeight: 0 }}>

        {/* Header */}
        <div className="px-5 pt-4 pb-3 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <span className={`text-[20px] font-black ${T.textPrimary}`}>${symbol}</span>
              {tokenInfo && (
                <span className={`text-[12px] font-black px-2 py-0.5 rounded-full ${T.changePill(tokenInfo.change24h >= 0)}`}>
                  {tokenInfo.change24h >= 0 ? "+" : ""}{tokenInfo.change24h.toFixed(1)}%
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${T.chainPill(chain)}`}>{chain}</span>
            </div>
            <p className={`text-[11px] font-bold ${T.priceLbl}`}>
              {tokenInfo ? (
                chartView === "price" ? (
                  <>Price <span className={T.priceVal}>${formatPrice(tokenInfo.price)}</span></>
                ) : (
                  <>MCap <span className={T.priceVal}>{formatMcap(tokenInfo.marketCap)}</span>
                  {tokenInfo.price > 0 && <span className={`ml-2 ${T.textMuted}`}>@ ${formatPrice(tokenInfo.price)}</span>}</>
                )
              ) : (
                <span className={T.textMuted}>Loading…</span>
              )}
            </p>
          </div>

          {/* Chart control toggles */}
          <div className="flex items-center gap-1.5">
            {/* Chart TF — independent from trade TF */}
            <div className={`flex rounded-xl overflow-hidden text-[11px] font-black shrink-0 ${T.toggleBase}`}>
              {["5m","15m","1h","4h","24h"].map((tf) => (
                <button key={tf} onClick={() => setChartTf(tf)}
                  className={`w-9 py-2 text-center transition-all ${chartTf === tf ? T.toggleActive : T.toggleInact}`}>
                  {tf}
                </button>
              ))}
            </div>
            {/* Price / MCap */}
            <div className={`flex rounded-xl overflow-hidden text-[10px] font-black ${T.toggleBase}`}>
              {(["price", "mcap"] as const).map((v) => (
                <button key={v} onClick={() => setChartView(v)}
                  className={`px-3 py-1.5 transition-all ${chartView === v ? T.toggleActive : T.toggleInact}`}>
                  {v === "price" ? "Price" : "MCap"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Countdown bar (only when market is active) */}
        {activeMarket && (
          <div className="px-5 pb-3 flex items-center gap-3">
            <span className={`text-[9px] font-black uppercase tracking-widest shrink-0 ${T.textMuted}`}>Closes</span>
            <span className={`text-[14px] font-black tabular-nums ${T.textPrimary}`}>{formatCountdown(msLeft)}</span>
            <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${T.cdBarBg}`}>
              <motion.div
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.8, ease: "linear" }}
                className={`h-full rounded-full bg-gradient-to-r ${T.cdBarFill}`}
              />
            </div>
            <span className={`text-[9px] font-black shrink-0 ${T.textMuted}`}>{activeMarket.timeframe}</span>
          </div>
        )}

        {/* Chart */}
        <div className="flex-1 min-h-0 h-[260px] md:h-auto px-3 pb-3 relative">
          {loading && candles.length === 0 && (
            <div className={`absolute inset-0 flex items-center justify-center ${T.textMuted} text-[12px] font-bold`}>
              Loading chart…
            </div>
          )}
          {!loading && candles.length === 0 && (
            <div className={`absolute inset-0 flex items-center justify-center ${T.textMuted} text-[12px] font-bold`}>
              No chart data available
            </div>
          )}
          <Chart
            candles={displayCandles}
            livePrice={chartView === "price" ? (livePrice ?? undefined) : undefined}
            entryPrice={chartView === "price" ? entryPrice : undefined}
            direction={side}
            dk={dk}
          />
        </div>
      </div>

      {/* ── BOTTOM/RIGHT: Order panel ───────────────────────────── */}
      <div className={`w-full md:w-[280px] shrink-0 flex flex-col overflow-y-auto border-t md:border-t-0 md:border-l ${dk ? "border-white/8" : "border-gray-100"} ${T.panelBg}`}>

        {/* Long / Short */}
        <div className="px-4 pt-5 pb-4">
          <div className="flex gap-2.5 mb-3">
            <motion.button whileTap={{ scale: 0.96 }}
              onClick={() => setSide(side === "long" ? null : "long")}
              className={`flex-1 rounded-2xl py-4 text-center transition-all duration-150 ${
                side === "long" ? "bg-emerald-500 shadow-[0_0_24px_rgba(16,185,129,0.35)]" : T.upIdle
              }`}>
              <p className={`text-[12px] font-black tracking-wide ${side === "long" ? "text-emerald-100" : "text-emerald-400"}`}>▲ LONG</p>
              <p className={`text-[26px] font-black leading-tight ${side === "long" ? "text-white" : "text-emerald-300"}`}>{longPct}%</p>
              <p className={`text-[11px] font-bold ${side === "long" ? "text-emerald-100/70" : "text-emerald-500/60"}`}>{longMult.toFixed(2)}x{!activeMarket ? "~" : ""}</p>
            </motion.button>

            <motion.button whileTap={{ scale: 0.96 }}
              onClick={() => setSide(side === "short" ? null : "short")}
              className={`flex-1 rounded-2xl py-4 text-center transition-all duration-150 ${
                side === "short" ? "bg-red-500 shadow-[0_0_24px_rgba(239,68,68,0.35)]" : T.downIdle
              }`}>
              <p className={`text-[12px] font-black tracking-wide ${side === "short" ? "text-red-100" : "text-red-400"}`}>▼ SHORT</p>
              <p className={`text-[26px] font-black leading-tight ${side === "short" ? "text-white" : "text-red-300"}`}>{shortPct}%</p>
              <p className={`text-[11px] font-bold ${side === "short" ? "text-red-100/70" : "text-red-500/60"}`}>{shortMult.toFixed(2)}x{!activeMarket ? "~" : ""}</p>
            </motion.button>
          </div>

          {/* Pool bar */}
          {activeMarket && (
            <>
              <div className="flex h-1.5 rounded-full overflow-hidden gap-0.5 mb-1.5">
                <motion.div animate={{ width: `${longPct}%` }}  transition={{ type: "spring", stiffness: 160, damping: 20 }} className="h-full bg-emerald-500 rounded-l-full" />
                <motion.div animate={{ width: `${shortPct}%` }} transition={{ type: "spring", stiffness: 160, damping: 20 }} className="h-full bg-red-500 rounded-r-full" />
              </div>
              <div className={`flex justify-between text-[10px] font-bold ${T.poolLabel}`}>
                <span className="text-emerald-400/60">${longPool.toLocaleString()}</span>
                <span>{markets.filter(m => m.symbol === symbol && m.status === "open").length} open</span>
                <span className="text-red-400/60">${shortPool.toLocaleString()}</span>
              </div>
            </>
          )}
        </div>

        {/* Amount */}
        <div className="px-4 pb-4">
          <p className={`text-[9px] font-black uppercase tracking-widest mb-2.5 ${T.sectionLbl}`}>Amount</p>
          <div className="grid grid-cols-4 gap-2 mb-2.5">
            {AMOUNTS.map((a) => {
              const isActive = amount === a && !customAmt;
              return (
                <button key={a} onClick={() => { setAmount(a); setCustomAmt(""); }}
                  className={`py-2.5 rounded-xl text-[13px] font-black transition-all ${
                    isActive
                      ? side === "long"  ? "bg-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                      : side === "short" ? "bg-red-500 text-white shadow-[0_0_12px_rgba(239,68,68,0.3)]"
                      : dk ? "bg-white text-black" : "bg-gray-900 text-white"
                      : T.amtIdle
                  }`}>
                  ${a}
                </button>
              );
            })}
          </div>
          <div className="relative">
            <span className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-[12px] font-bold ${T.textMuted}`}>$</span>
            <input type="number" placeholder="custom" value={customAmt}
              onChange={(e) => { setCustomAmt(e.target.value); setAmount(null); }}
              className={`w-full border text-[13px] font-bold pl-7 pr-3 py-2.5 rounded-xl outline-none transition-all ${T.input}`} />
          </div>
        </div>

        {/* To win */}
        <div className="px-4 pb-4">
          <div className="flex items-end justify-between mb-0.5">
            <p className={`text-[9px] font-black uppercase tracking-widest ${T.sectionLbl}`}>
              To win{!activeMarket && winAmount ? <span className="ml-1 normal-case opacity-50">(est.)</span> : ""}
            </p>
            <span className={`text-[28px] font-black leading-none ${winAmount && winAmount !== "0" ? "text-emerald-400" : T.textMuted}`}>
              {winAmount && winAmount !== "0" ? `$${winAmount}` : "$0"}
            </span>
          </div>
          {winAmount && finalAmount != null && parseFloat(winAmount) > 0 && (
            <p className={`text-[10px] font-bold text-right ${T.textMuted}`}>
              +${(parseFloat(winAmount) - finalAmount).toFixed(0)} profit · 5% fee
            </p>
          )}
        </div>

        {betError && (
          <p className="px-4 pb-2 text-[11px] font-bold text-red-400">{betError}</p>
        )}

        {/* Trade / Open Market button */}
        <div className="px-4 pb-4">
          <motion.button whileTap={{ scale: 0.97 }} onClick={handleTrade}
            disabled={!isReady || betLoading}
            className={`w-full py-4 rounded-2xl text-[15px] font-black uppercase tracking-widest transition-all ${
              betLoading ? dk ? "bg-white/8 text-white/30" : "bg-gray-100 text-gray-400"
              : isReady
                ? side === "long"
                  ? "bg-emerald-500 text-white hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                  : "bg-red-500 text-white hover:bg-red-400 shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                : dk ? "bg-white/5 text-white/15 cursor-not-allowed" : "bg-gray-100 text-gray-300 cursor-not-allowed"
            }`}>
            {betLoading ? "Placing…" : activeMarket ? "Trade" : "Open Market →"}
          </motion.button>
        </div>

        {/* Duration selector */}
        <div className="px-4 pb-5">
          <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${T.sectionLbl}`}>Duration</p>
          <div className="flex flex-wrap gap-1.5">
            {TIMEFRAMES.map((tf) => (
              <button key={tf} onClick={() => setTimeframe(tf)}
                className={`text-[11px] font-black px-3.5 py-1.5 rounded-full border transition-all ${
                  timeframe === tf ? T.durActive : T.durIdle
                }`}>
                {tf}
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
