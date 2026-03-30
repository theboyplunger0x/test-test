"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import type { Candle, TokenInfo } from "@/lib/chartData";
import { searchBySymbol, getOHLCV, resolutionForTf, getPriceByPair } from "@/lib/chartData";
import { api, Market, OrderBook } from "@/lib/api";

const Chart = dynamic(() => import("./Chart"), { ssr: false });

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

const FEE = 0.05;
const DEFAULT_AMOUNTS = [5, 25, 100, 500];
const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "24h"];

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
  onBet: (marketId: string, side: "long" | "short", amount: number, message?: string) => Promise<string | null>;
  onAutoTrade?: (side: "long" | "short", amount: number, timeframe: string, tagline?: string) => Promise<string | null>;
  onSweep?: (side: "long" | "short", amount: number, timeframe: string) => Promise<string | null>;
  onPlaceOrder?: (side: "long" | "short", amount: number, timeframe: string, autoReopen: boolean) => Promise<string | null>;
  onOpenMarket: () => void;
  onViewToken?: () => void;
  onViewProfile?: (username: string) => void;
  loggedIn: boolean;
  onAuthRequired: () => void;
  tokenInfo?: TokenInfo;    // pre-fetched (from CA search); skips symbol lookup
  presets?: number[];
  paperMode?: boolean;
}

export default function CoinDetail({
  symbol, chain, timeframe: initialTf, theme,
  markets, onBet, onAutoTrade, onSweep, onPlaceOrder, onOpenMarket, onViewToken, onViewProfile, loggedIn, onAuthRequired,
  tokenInfo: tokenInfoProp,
  presets = DEFAULT_AMOUNTS,
  paperMode = false,
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

  // Fast price poll every 3s — uses pairAddress directly (works for new pairs too)
  useEffect(() => {
    if (!tokenInfo?.pairAddress) return;
    const { pairAddress, chainId } = tokenInfo;
    const poll = async () => {
      const price = await getPriceByPair(chainId, pairAddress);
      if (price) setLivePrice(price);
    };
    poll();
    const i = setInterval(poll, 3_000);
    return () => clearInterval(i);
  }, [tokenInfo?.pairAddress]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Active market for this symbol + selected trade timeframe (most recent, open)
  const activeMarket = markets
    .filter((m) => m.symbol === symbol && m.status === "open" && m.timeframe === timeframe)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;

  const msLeft    = activeMarket ? Math.max(0, new Date(activeMarket.closes_at).getTime() - Date.now()) : 0;
  const tfMs      = { "1m": 60000, "5m": 5*60000, "15m": 15*60000, "1h": 3600000, "4h": 14400000, "12h": 43200000, "24h": 86400000 }[activeMarket?.timeframe ?? "1h"] ?? 3600000;
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

  // ── Order book ──────────────────────────────────────────────────────────────
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const obTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const ob = await api.getOrderBook(symbol, chain.toLowerCase(), paperMode);
        if (!cancelled) setOrderBook(ob);
      } catch { /* ignore */ }
    };
    fetch();
    obTimerRef.current = setInterval(fetch, 5_000);
    return () => { cancelled = true; if (obTimerRef.current) clearInterval(obTimerRef.current); };
  }, [symbol, chain, paperMode]);

  const [side, setSide]         = useState<"long" | "short" | null>(null);
  const [amount, setAmount]     = useState<number | null>(null);
  const [customAmt, setCustomAmt] = useState("");
  const [tagline, setTagline]   = useState("");
  const [betError, setBetError] = useState("");
  const [betLoading, setBetLoading] = useState(false);
  const [sweepError, setSweepError] = useState("");
  const [sweepLoading, setSweepLoading] = useState(false);

  // ── Trade panel tab ─────────────────────────────────────────────────────────
  const [tradeTab, setTradeTab]         = useState<"market" | "sweep" | "limit">("market");
  const [makerSide, setMakerSide]       = useState<"long" | "short" | null>(null);
  const [makerAmt, setMakerAmt]         = useState("");
  const [autoReopen, setAutoReopen]     = useState(false);
  const [makerError, setMakerError]     = useState("");
  const [makerLoading, setMakerLoading] = useState(false);
  const [makerDone, setMakerDone]       = useState(false);
  const [makerTfs, setMakerTfs]         = useState<Set<string>>(() => new Set([initialTf]));

  async function handlePlaceOrder() {
    if (!makerSide) return;
    const amt = parseFloat(makerAmt);
    if (isNaN(amt) || amt < 5) { setMakerError("Minimum $5"); return; }
    if (!loggedIn) { onAuthRequired(); return; }
    if (!onPlaceOrder) return;
    setMakerLoading(true);
    setMakerError("");
    const err = await onPlaceOrder(makerSide, amt, timeframe, autoReopen);
    setMakerLoading(false);
    if (err) { setMakerError(err); }
    else { setMakerDone(true); setMakerAmt(""); setMakerSide(null); setAutoReopen(false); setTimeout(() => setMakerDone(false), 2500); }
  }

  const parsedCustom = customAmt !== "" ? parseFloat(customAmt) : NaN;
  const finalAmount  = customAmt !== "" ? (isNaN(parsedCustom) ? null : parsedCustom) : amount;
  const isReady      = side && finalAmount != null && finalAmount >= 5;
  const activeMult   = side === "long" ? longMult : shortMult;
  const winAmount    = finalAmount != null && finalAmount > 0 && side
    ? (finalAmount * activeMult).toFixed(0)
    : null;

  const entryPrice  = activeMarket ? parseFloat(activeMarket.entry_price) : (livePrice ?? tokenInfo?.price);

  async function handleTrade() {
    if (!isReady) return;
    if (!loggedIn) { onAuthRequired(); return; }
    setBetLoading(true);
    setBetError("");
    let err: string | null;
    if (!activeMarket) {
      if (onAutoTrade) {
        err = await onAutoTrade(side!, finalAmount!, timeframe, tagline.trim() || undefined);
      } else {
        onOpenMarket();
        setBetLoading(false);
        return;
      }
    } else {
      err = await onBet(activeMarket.id, side!, finalAmount!, tagline.trim() || undefined);
    }
    setBetLoading(false);
    if (err) setBetError(err);
    else { setSide(null); setAmount(null); setCustomAmt(""); setTagline(""); }
  }

  // ── Theme ──────────────────────────────────────────────────────────────────
  const T = {
    chartBg:     dk ? "" : "bg-gray-50",
    panelBg:     dk ? "bg-[#0e0e0e]" : "bg-white",
    textPrimary: dk ? "text-white"    : "text-gray-900",
    textMuted:   dk ? "text-white/45" : "text-gray-400",
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
    toggleInact: dk ? "text-white/50 hover:text-white/80" : "text-gray-400 hover:text-gray-700",
    durIdle:     dk ? "border-white/20 text-white/50 hover:border-white/40 hover:text-white/80"
                    : "border-blue-200 text-blue-500 hover:text-blue-600 hover:border-blue-300",
    durActive:   dk ? "border-white/50 bg-white/15 text-white" : "border-blue-400 bg-blue-50 text-blue-700",
    sectionLbl:  dk ? "text-white/40" : "text-gray-400",
    poolLabel:   dk ? "text-white/40" : "text-gray-400",
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Stats bar ────────────────────────────────────────────────────────── */}
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b shrink-0 ${dk ? "border-white/8 bg-[#0a0a0a]" : "border-gray-100 bg-white"}`}>
        <button onClick={onViewToken} className={`text-[15px] font-black shrink-0 ${T.textPrimary} ${onViewToken ? "hover:opacity-60 cursor-pointer transition-opacity" : "cursor-default"}`}>
          ${symbol}
        </button>
        <span className={`text-[18px] font-black tabular-nums shrink-0 ${T.textPrimary}`}>
          {tokenInfo ? `$${formatPrice(livePrice ?? tokenInfo.price)}` : "—"}
        </span>
        {tokenInfo && (
          <span className={`shrink-0 text-[11px] font-black px-1.5 py-0.5 rounded ${T.changePill(tokenInfo.change24h >= 0)}`}>
            {tokenInfo.change24h >= 0 ? "+" : ""}{tokenInfo.change24h.toFixed(2)}%
          </span>
        )}
        <div className={`flex items-center gap-3 flex-1 min-w-0 overflow-x-auto border-l pl-3 ${dk ? "border-white/8" : "border-gray-100"}`}>
          {tokenInfo?.marketCap ? (
            <div className="shrink-0">
              <span className={`text-[9px] uppercase tracking-widest ${T.textMuted}`}>MCap </span>
              <span className={`text-[11px] font-bold ${T.textPrimary}`}>{formatMcap(tokenInfo.marketCap)}</span>
            </div>
          ) : null}
          <span className={`shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full ${T.chainPill(chain)}`}>{chain}</span>
          {tokenInfo?.address && <CopyCA ca={tokenInfo.address} dk={dk} />}
        </div>
        <div className={`flex rounded-lg overflow-hidden text-[10px] font-black shrink-0 ${T.toggleBase}`}>
          {(["price", "mcap"] as const).map((v) => (
            <button key={v} onClick={() => setChartView(v)}
              className={`px-2.5 py-1.5 transition-all ${chartView === v ? T.toggleActive : T.toggleInact}`}>
              {v === "price" ? "P" : "M"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main 3-column area ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">

      {/* ── LEFT: Chart ──────────────────────────────────────────── */}
      <div className={`flex-1 flex flex-col overflow-hidden min-h-0 ${T.chartBg}`} style={{ minHeight: 0 }}>

        {/* Chart toolbar: TF selector + countdown */}
        <div className={`flex items-center gap-2 px-3 py-2 border-b shrink-0 ${dk ? "border-white/6" : "border-gray-100"}`}>
          <div className={`flex rounded-lg overflow-hidden text-[10px] font-black ${T.toggleBase}`}>
            {["1m","5m","15m","1h","4h","24h"].map((tf) => (
              <button key={tf} onClick={() => setChartTf(tf)}
                className={`px-2.5 py-1.5 transition-all ${chartTf === tf ? T.toggleActive : T.toggleInact}`}>
                {tf}
              </button>
            ))}
          </div>
          {activeMarket ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className={`flex-1 h-1 rounded-full overflow-hidden ${T.cdBarBg}`}>
                <motion.div
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.8, ease: "linear" }}
                  className={`h-full rounded-full bg-gradient-to-r ${T.cdBarFill}`}
                />
              </div>
              <span className={`text-[11px] font-black tabular-nums shrink-0 ${T.textPrimary}`}>{formatCountdown(msLeft)}</span>
            </div>
          ) : (
            <span className={`text-[10px] ml-1 ${T.textMuted}`}>no active market</span>
          )}
        </div>

        {/* Chart */}
        <div className="flex-1 min-h-0 h-[240px] md:h-auto relative">
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
          {loading && candles.length === 0 && (
            <div className={`absolute inset-0 flex items-center justify-center ${T.textMuted} text-[12px] font-bold`}>Loading chart…</div>
          )}
          {!loading && candles.length === 0 && (
            <div className={`absolute inset-0 flex items-center justify-center ${T.textMuted} text-[12px] font-bold`}>No chart data</div>
          )}
        </div>
      </div>

      {/* ── CENTER: Order Book (desktop only) ────────────────────── */}
      {(() => {
        const shorts: { tf: string; pool: number; mult: number }[] = [];
        const longs:  { tf: string; pool: number; mult: number }[] = [];
        if (orderBook) {
          for (const [tf, data] of Object.entries(orderBook.timeframes)) {
            if (data.short.total > 0) shorts.push({ tf, pool: data.short.total, mult: data.long_multiplier });
            if (data.long.total  > 0) longs.push({  tf, pool: data.long.total,  mult: data.short_multiplier });
          }
        }
        const allPools = [...shorts, ...longs].map(r => r.pool);
        const maxPool  = allPools.length > 0 ? Math.max(...allPools) : 1;

        const renderRows = (rows: typeof shorts, takerSide: "long" | "short") =>
          rows.sort((a, b) => b.mult - a.mult).map(r => {
            const barW  = Math.max(6, (r.pool / maxPool) * 100);
            const mc    = r.mult >= 5 ? "text-amber-400" : r.mult >= 3 ? "text-emerald-400" : dk ? "text-white/55" : "text-gray-500";
            const isSelected = side === takerSide && timeframe === r.tf;
            return (
              <button
                key={`${takerSide}-${r.tf}`}
                onClick={() => { setTradeTab("market"); setSide(takerSide); setTimeframe(r.tf); }}
                className={`w-full px-3 py-1.5 flex items-center gap-1.5 relative overflow-hidden transition-colors ${
                  isSelected
                    ? dk ? "bg-white/[0.07]" : "bg-gray-100"
                    : dk ? "hover:bg-white/[0.04]" : "hover:bg-gray-50"
                }`}
              >
                <div
                  className={`absolute left-0 top-0 bottom-0 ${takerSide === "long" ? "bg-emerald-500" : "bg-red-500"} opacity-[0.07]`}
                  style={{ width: `${barW}%` }}
                />
                <span className={`text-[10px] font-black shrink-0 w-7 text-left ${dk ? "text-white/30" : "text-gray-400"}`}>{r.tf}</span>
                <span className={`text-[10px] font-mono flex-1 text-right tabular-nums ${dk ? "text-white/45" : "text-gray-500"}`}>
                  ${r.pool >= 1000 ? `${(r.pool / 1000).toFixed(1)}k` : r.pool.toFixed(0)}
                </span>
                <span className={`text-[11px] font-black tabular-nums w-12 text-right ${mc}`}>
                  {r.mult >= 100 ? "100x+" : `${r.mult.toFixed(1)}x`}
                </span>
              </button>
            );
          });

        return (
          <div className={`hidden md:flex flex-col w-[170px] shrink-0 border-l overflow-hidden ${dk ? "border-white/8 bg-[#090909]" : "border-gray-100 bg-gray-50/30"}`}>
            <div className={`px-3 py-2 border-b shrink-0 flex items-center justify-between ${dk ? "border-white/6" : "border-gray-100"}`}>
              <p className={`text-[9px] font-black uppercase tracking-widest ${T.sectionLbl}`}>Order Book</p>
              <span className={`text-[9px] ${T.sectionLbl}`}>{shorts.length + longs.length} orders</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* SHORTS → taker goes LONG */}
              <div className={`flex items-center justify-between px-3 pt-2 pb-0.5`}>
                <span className="text-[8px] font-black uppercase tracking-wider text-red-400/50">Shorts</span>
                <span className={`text-[8px] ${dk ? "text-white/15" : "text-gray-300"}`}>↑ long</span>
              </div>
              {shorts.length === 0
                ? <p className={`px-3 py-1.5 text-[10px] ${dk ? "text-white/15" : "text-gray-300"}`}>—</p>
                : renderRows(shorts, "long")
              }

              <div className={`mx-3 my-1.5 border-t ${dk ? "border-white/6" : "border-gray-100"}`} />

              {/* LONGS → taker goes SHORT */}
              <div className={`flex items-center justify-between px-3 pt-0.5 pb-0.5`}>
                <span className="text-[8px] font-black uppercase tracking-wider text-emerald-400/50">Longs</span>
                <span className={`text-[8px] ${dk ? "text-white/15" : "text-gray-300"}`}>↓ short</span>
              </div>
              {longs.length === 0
                ? <p className={`px-3 py-1.5 text-[10px] ${dk ? "text-white/15" : "text-gray-300"}`}>—</p>
                : renderRows(longs, "short")
              }

              {shorts.length === 0 && longs.length === 0 && (
                <p className={`px-3 py-3 text-[10px] ${dk ? "text-white/20" : "text-gray-400"}`}>
                  {orderBook ? "No orders yet." : "Loading…"}
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── RIGHT: Trade Panel ───────────────────────────────────── */}
      <div className={`w-full md:w-[238px] shrink-0 flex flex-col border-t md:border-t-0 md:border-l overflow-y-auto ${dk ? "border-white/8 bg-[#0e0e0e]" : "border-gray-100 bg-white"}`}>

        {/* Trade / Challenge tabs */}
        <div className={`flex shrink-0 border-b ${dk ? "border-white/8" : "border-gray-100"}`}>
          {(["market", "sweep", "limit"] as const).map(tab => (
            <button key={tab} onClick={() => setTradeTab(tab)}
              className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-wider transition-all relative ${
                tradeTab === tab
                  ? dk ? "text-white" : "text-gray-900"
                  : dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"
              }`}>
              {tab === "market" ? "Open Market" : tab === "sweep" ? "Sweep" : "Challenge"}
              {tradeTab === tab && <span className={`absolute bottom-0 left-0 right-0 h-[2px] ${dk ? "bg-white" : "bg-gray-900"}`} />}
            </button>
          ))}
        </div>

        {/* ── MARKET tab ──────────────────────────────────────────── */}
        {tradeTab === "market" && (() => {
          async function handleExecute() {
            if (!isReady) return;
            if (!loggedIn) { onAuthRequired(); return; }
            setBetLoading(true); setBetError("");
            let err: string | null;
            if (!activeMarket) {
              err = onAutoTrade ? await onAutoTrade(side!, finalAmount!, timeframe, tagline.trim() || undefined) : null;
              if (!err && !onAutoTrade) { onOpenMarket(); setBetLoading(false); return; }
            } else {
              err = await onBet(activeMarket.id, side!, finalAmount!, tagline.trim() || undefined);
            }
            setBetLoading(false);
            if (err) setBetError(err);
            else { setSide(null); setAmount(null); setCustomAmt(""); setTagline(""); }
          }

          return (
          <div className="flex flex-col flex-1 px-3 pt-3 gap-3 pb-4">

            {/* Long / Short */}
            <div className="flex gap-2">
              <motion.button whileTap={{ scale: 0.96 }} onClick={() => setSide(side === "long" ? null : "long")}
                className={`flex-1 rounded-xl py-3 text-center transition-all duration-150 ${side === "long" ? "bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)]" : T.upIdle}`}>
                <p className={`text-[16px] font-black leading-tight ${side === "long" ? "text-white" : "text-emerald-300"}`}>▲ Long</p>
                <p className={`text-[11px] font-black ${side === "long" ? "text-emerald-100/80" : "text-emerald-400/70"}`}>{longMult.toFixed(2)}x{!activeMarket ? "~" : ""}</p>
              </motion.button>
              <motion.button whileTap={{ scale: 0.96 }} onClick={() => setSide(side === "short" ? null : "short")}
                className={`flex-1 rounded-xl py-3 text-center transition-all duration-150 ${side === "short" ? "bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]" : T.downIdle}`}>
                <p className={`text-[16px] font-black leading-tight ${side === "short" ? "text-white" : "text-red-300"}`}>▼ Short</p>
                <p className={`text-[11px] font-black ${side === "short" ? "text-red-100/80" : "text-red-400/70"}`}>{shortMult.toFixed(2)}x{!activeMarket ? "~" : ""}</p>
              </motion.button>
            </div>

            {/* Pool bar */}
            {activeMarket && (
              <div>
                <div className="flex h-1 rounded-full overflow-hidden gap-0.5 mb-1">
                  <motion.div animate={{ width: `${longPct}%` }}  transition={{ type: "spring", stiffness: 160, damping: 20 }} className="h-full bg-emerald-500 rounded-l-full" />
                  <motion.div animate={{ width: `${shortPct}%` }} transition={{ type: "spring", stiffness: 160, damping: 20 }} className="h-full bg-red-500 rounded-r-full" />
                </div>
                <div className={`flex justify-between text-[9px] font-bold ${T.poolLabel}`}>
                  <span className="text-emerald-400/60">${longPool.toLocaleString()}</span>
                  <span>{markets.filter(m => m.symbol === symbol && m.status === "open").length} open</span>
                  <span className="text-red-400/60">${shortPool.toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* Duration */}
            <div>
              <p className={`text-[8px] font-black uppercase tracking-widest mb-1.5 ${T.sectionLbl}`}>Duration</p>
              <div className="flex flex-wrap gap-1">
                {TIMEFRAMES.map((tf) => (
                  <button key={tf} onClick={() => setTimeframe(tf)}
                    className={`text-[10px] font-black px-2.5 py-1 rounded-full border transition-all ${timeframe === tf ? T.durActive : T.durIdle}`}>
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div>
              <p className={`text-[8px] font-black uppercase tracking-widest mb-1.5 ${T.sectionLbl}`}>Amount</p>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {presets.map((a) => {
                  const isActive = amount === a && customAmt === String(a);
                  return (
                    <button key={a} onClick={() => { setAmount(a); setCustomAmt(String(a)); }}
                      className={`py-2 rounded-lg text-[11px] font-black transition-all ${
                        isActive
                          ? side === "long"  ? "bg-emerald-500 text-white"
                          : side === "short" ? "bg-red-500 text-white"
                          : dk ? "bg-white text-black" : "bg-gray-900 text-white"
                          : T.amtIdle
                      }`}>
                      ${a}
                    </button>
                  );
                })}
              </div>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${T.textMuted}`}>$</span>
                <input type="number" placeholder="custom" value={customAmt}
                  onChange={(e) => { setCustomAmt(e.target.value); setAmount(null); }}
                  className={`w-full border text-[12px] font-bold pl-6 pr-3 py-2 rounded-lg outline-none transition-all ${T.input}`} />
              </div>
            </div>

            {/* Message */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className={`text-[8px] font-black uppercase tracking-widest ${T.sectionLbl}`}>Message <span className="opacity-40 normal-case font-bold">(optional)</span></p>
                <span className={`text-[9px] font-bold tabular-nums ${tagline.length > 50 ? "text-amber-400" : T.sectionLbl}`}>{tagline.length}/60</span>
              </div>
              <textarea value={tagline} onChange={(e) => setTagline(e.target.value)}
                maxLength={60} placeholder={`${symbol} to the moon!`} rows={2}
                className={`w-full border text-[11px] font-bold p-2.5 rounded-lg outline-none resize-none transition-all ${T.input} placeholder:opacity-30`} />
            </div>

            {/* To win */}
            <div className="flex items-end justify-between">
              <p className={`text-[8px] font-black uppercase tracking-widest ${T.sectionLbl}`}>
                To win{!activeMarket && winAmount ? <span className="ml-1 normal-case opacity-50">(est.)</span> : ""}
              </p>
              <div className="text-right">
                <span className={`text-[26px] font-black leading-none ${winAmount && winAmount !== "0" ? "text-emerald-400" : T.textMuted}`}>
                  {winAmount && winAmount !== "0" ? `$${winAmount}` : "$0"}
                </span>
                {winAmount && finalAmount != null && parseFloat(winAmount) > 0 && (
                  <p className={`text-[9px] font-bold ${T.textMuted}`}>+${(parseFloat(winAmount) - finalAmount).toFixed(0)} profit</p>
                )}
              </div>
            </div>

            {betError && <p className="text-[10px] font-bold text-red-400">{betError}</p>}

            <motion.button whileTap={{ scale: 0.97 }} onClick={handleExecute}
              disabled={!isReady || betLoading}
              className={`w-full py-3.5 rounded-xl text-[13px] font-black uppercase tracking-widest transition-all mt-auto ${
                betLoading ? dk ? "bg-white/8 text-white/30" : "bg-gray-100 text-gray-400"
                : isReady
                  ? side === "long"  ? "bg-emerald-500 text-white hover:bg-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.3)]"
                  : "bg-red-500 text-white hover:bg-red-400 shadow-[0_0_16px_rgba(239,68,68,0.3)]"
                  : dk ? "bg-white/10 text-white/40 cursor-not-allowed" : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}>
              {betLoading ? "Placing…" : activeMarket ? "Trade" : "Open Market →"}
            </motion.button>
          </div>
          );
        })()}

        {/* ── SWEEP tab ───────────────────────────────────────────── */}
        {tradeTab === "sweep" && (() => {
          const tfData = orderBook?.timeframes[timeframe];
          const opposingSide = side === "long" ? "short" : "long";
          const opposingOrders = (tfData?.[opposingSide as "long" | "short"]?.orders ?? []) as { username: string; remaining_amount: number }[];
          const sortedOrders = [...opposingOrders].sort((a, b) => b.remaining_amount - a.remaining_amount);
          let remaining = finalAmount ?? 0;
          const fills: { username: string; amount: number }[] = [];
          for (const order of sortedOrders) {
            if (remaining <= 0) break;
            const filled = Math.min(remaining, order.remaining_amount);
            fills.push({ username: order.username, amount: filled });
            remaining -= filled;
          }
          const filledTotal   = (finalAmount ?? 0) - remaining;
          const unfilledTotal = remaining;
          const hasFills      = fills.length > 0 && filledTotal > 0;
          const sweepMult     = side === "long"
            ? (tfData?.long_multiplier  ?? longMult)
            : (tfData?.short_multiplier ?? shortMult);
          const sweepWin = finalAmount != null && finalAmount > 0 && side
            ? (finalAmount * sweepMult).toFixed(0) : null;

          async function handleSweep() {
            if (!isReady || !onSweep) return;
            if (!loggedIn) { onAuthRequired(); return; }
            setSweepLoading(true); setSweepError("");
            const err = await onSweep(side!, finalAmount!, timeframe);
            setSweepLoading(false);
            if (err) setSweepError(err);
            else { setSide(null); setAmount(null); setCustomAmt(""); }
          }

          return (
          <div className="flex flex-col flex-1 px-3 pt-3 gap-3 pb-4">
            {/* Long / Short */}
            <div className="flex gap-2">
              <motion.button whileTap={{ scale: 0.96 }} onClick={() => setSide(side === "long" ? null : "long")}
                className={`flex-1 rounded-xl py-3 text-center transition-all duration-150 ${side === "long" ? "bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)]" : T.upIdle}`}>
                <p className={`text-[16px] font-black leading-tight ${side === "long" ? "text-white" : "text-emerald-300"}`}>▲ Long</p>
                <p className={`text-[11px] font-black ${side === "long" ? "text-emerald-100/80" : "text-emerald-400/70"}`}>{longMult.toFixed(2)}x</p>
              </motion.button>
              <motion.button whileTap={{ scale: 0.96 }} onClick={() => setSide(side === "short" ? null : "short")}
                className={`flex-1 rounded-xl py-3 text-center transition-all duration-150 ${side === "short" ? "bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]" : T.downIdle}`}>
                <p className={`text-[16px] font-black leading-tight ${side === "short" ? "text-white" : "text-red-300"}`}>▼ Short</p>
                <p className={`text-[11px] font-black ${side === "short" ? "text-red-100/80" : "text-red-400/70"}`}>{shortMult.toFixed(2)}x</p>
              </motion.button>
            </div>

            {/* Duration */}
            <div>
              <p className={`text-[8px] font-black uppercase tracking-widest mb-1.5 ${T.sectionLbl}`}>Duration</p>
              <div className="flex flex-wrap gap-1">
                {TIMEFRAMES.map((tf) => (
                  <button key={tf} onClick={() => setTimeframe(tf)}
                    className={`text-[10px] font-black px-2.5 py-1 rounded-full border transition-all ${timeframe === tf ? T.durActive : T.durIdle}`}>
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div>
              <p className={`text-[8px] font-black uppercase tracking-widest mb-1.5 ${T.sectionLbl}`}>Amount</p>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {presets.map((a) => {
                  const isActive = amount === a && customAmt === String(a);
                  return (
                    <button key={a} onClick={() => { setAmount(a); setCustomAmt(String(a)); }}
                      className={`py-2 rounded-lg text-[11px] font-black transition-all ${
                        isActive
                          ? side === "long"  ? "bg-emerald-500 text-white"
                          : side === "short" ? "bg-red-500 text-white"
                          : dk ? "bg-white text-black" : "bg-gray-900 text-white"
                          : T.amtIdle
                      }`}>
                      ${a}
                    </button>
                  );
                })}
              </div>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${T.textMuted}`}>$</span>
                <input type="number" placeholder="custom" value={customAmt}
                  onChange={(e) => { setCustomAmt(e.target.value); setAmount(null); }}
                  className={`w-full border text-[12px] font-bold pl-6 pr-3 py-2 rounded-lg outline-none transition-all ${T.input}`} />
              </div>
            </div>

            {/* Fills preview */}
            {isReady && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className={`rounded-xl border p-3 space-y-1.5 ${hasFills ? dk ? "border-amber-500/20 bg-amber-500/5" : "border-amber-200 bg-amber-50" : dk ? "border-white/8 bg-white/3" : "border-gray-200 bg-gray-50"}`}>
                <p className={`text-[8px] font-black uppercase tracking-widest mb-1.5 ${hasFills ? dk ? "text-amber-400/60" : "text-amber-600" : T.sectionLbl}`}>
                  {hasFills ? "⚡ Fills" : "Order Book"}
                </p>
                {hasFills ? fills.map((f, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <button onClick={() => onViewProfile?.(f.username)} className={`text-[10px] font-bold ${dk ? "text-white/50 hover:text-white/80" : "text-gray-600 hover:text-gray-900"} transition-opacity`}>{f.username}</button>
                    <span className={`text-[10px] font-black tabular-nums ${dk ? "text-white/70" : "text-gray-800"}`}>${f.amount.toFixed(0)}</span>
                  </div>
                )) : (
                  <p className={`text-[10px] ${T.textMuted}`}>No open orders on this side yet</p>
                )}
                {unfilledTotal > 0.01 && (
                  <div className={`flex items-center justify-between pt-1 border-t ${dk ? "border-white/8" : "border-amber-200"}`}>
                    <span className={`text-[10px] ${dk ? "text-white/30" : "text-gray-400"}`}>Unfilled → challenge</span>
                    <span className={`text-[10px] font-black tabular-nums ${dk ? "text-white/40" : "text-gray-500"}`}>${unfilledTotal.toFixed(0)}</span>
                  </div>
                )}
                {hasFills && (
                  <div className={`flex items-center justify-between pt-1 border-t ${dk ? "border-white/8" : "border-amber-200"}`}>
                    <span className={`text-[10px] font-black ${dk ? "text-amber-400/80" : "text-amber-700"}`}>Mult</span>
                    <span className={`text-[13px] font-black tabular-nums ${dk ? "text-amber-400" : "text-amber-600"}`}>{sweepMult.toFixed(2)}x</span>
                  </div>
                )}
              </motion.div>
            )}

            {sweepError && <p className="text-[10px] font-bold text-red-400">{sweepError}</p>}

            <motion.button whileTap={{ scale: 0.97 }} onClick={handleSweep}
              disabled={!isReady || !hasFills || sweepLoading}
              className={`w-full py-3.5 rounded-xl text-[13px] font-black uppercase tracking-widest transition-all mt-auto ${
                sweepLoading ? dk ? "bg-white/8 text-white/30" : "bg-gray-100 text-gray-400"
                : isReady && hasFills
                  ? side === "long"  ? "bg-amber-500 text-white hover:bg-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.3)]"
                  : "bg-amber-500 text-white hover:bg-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.3)]"
                  : dk ? "bg-white/10 text-white/40 cursor-not-allowed" : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}>
              {sweepLoading ? "Sweeping…" : hasFills ? `⚡ Sweep $${filledTotal.toFixed(0)}` : "No liquidity"}
            </motion.button>
          </div>
          );
        })()}

        {/* ── LIMIT tab ───────────────────────────────────────────── */}
        {tradeTab === "limit" && (() => {
          const toggleTf = (tf: string) => setMakerTfs(prev => {
            const next = new Set(prev);
            next.has(tf) ? next.delete(tf) : next.add(tf);
            return next;
          });
          const makerAmtNum  = parseFloat(makerAmt) || 0;
          const totalAmt     = makerAmtNum * makerTfs.size;
          const canSubmit    = !!makerSide && makerAmtNum >= 5 && makerTfs.size > 0;

          async function handleMultiOrder() {
            if (!canSubmit) return;
            if (!loggedIn) { onAuthRequired(); return; }
            setMakerLoading(true); setMakerError("");
            try {
              await api.createOrders(
                [...makerTfs].map(tf => ({
                  symbol, chain, timeframe: tf,
                  side: makerSide!, amount: makerAmtNum,
                  is_paper: paperMode, auto_reopen: autoReopen,
                }))
              );
              setMakerDone(true); setMakerAmt(""); setMakerSide(null); setMakerTfs(new Set());
              setTimeout(() => setMakerDone(false), 2500);
            } catch (e: any) {
              setMakerError(e.message ?? "Failed");
            } finally {
              setMakerLoading(false);
            }
          }

          return (
          <div className="px-3 pt-3 pb-5 flex flex-col gap-3">
            {/* Side */}
            <div className="flex gap-2">
              <motion.button whileTap={{ scale: 0.96 }} onClick={() => setMakerSide(makerSide === "long" ? null : "long")}
                className={`flex-1 rounded-xl py-3 text-center transition-all duration-150 ${makerSide === "long" ? "bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.25)]" : T.upIdle}`}>
                <p className={`text-[15px] font-black ${makerSide === "long" ? "text-white" : "text-emerald-300"}`}>▲ Long</p>
                <p className={`text-[9px] font-black ${makerSide === "long" ? "text-emerald-100/80" : "text-emerald-400/60"}`}>open challenge</p>
              </motion.button>
              <motion.button whileTap={{ scale: 0.96 }} onClick={() => setMakerSide(makerSide === "short" ? null : "short")}
                className={`flex-1 rounded-xl py-3 text-center transition-all duration-150 ${makerSide === "short" ? "bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.25)]" : T.downIdle}`}>
                <p className={`text-[15px] font-black ${makerSide === "short" ? "text-white" : "text-red-300"}`}>▼ Short</p>
                <p className={`text-[9px] font-black ${makerSide === "short" ? "text-red-100/80" : "text-red-400/60"}`}>open challenge</p>
              </motion.button>
            </div>

            {/* Multi-timeframe selector */}
            <div>
              <p className={`text-[8px] font-black uppercase tracking-widest mb-1.5 ${T.sectionLbl}`}>
                Timeframes <span className="normal-case font-bold opacity-50">(select multiple)</span>
              </p>
              <div className="flex flex-wrap gap-1">
                {TIMEFRAMES.map((tf) => {
                  const active = makerTfs.has(tf);
                  return (
                    <button key={tf} onClick={() => toggleTf(tf)}
                      className={`text-[10px] font-black px-2.5 py-1 rounded-full border transition-all ${
                        active
                          ? makerSide === "short"
                            ? "bg-red-500 border-red-500 text-white"
                            : "bg-emerald-500 border-emerald-500 text-white"
                          : T.durIdle
                      }`}>
                      {tf}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Amount per timeframe */}
            <div>
              <p className={`text-[8px] font-black uppercase tracking-widest mb-1.5 ${T.sectionLbl}`}>
                Amount per timeframe
              </p>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {[5, 25, 50, 100].map(a => (
                  <button key={a} onClick={() => { setMakerAmt(String(a)); setMakerError(""); }}
                    className={`py-2 rounded-lg text-[11px] font-black transition-all ${
                      makerAmt === String(a) ? T.amtIdle.replace("hover:", "") : T.amtIdle
                    }`}>
                    ${a}
                  </button>
                ))}
              </div>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${T.textMuted}`}>$</span>
                <input type="number" placeholder="min $5" value={makerAmt}
                  onChange={(e) => { setMakerAmt(e.target.value); setMakerError(""); }}
                  className={`w-full border text-[12px] font-bold pl-6 pr-3 py-2 rounded-lg outline-none transition-all ${T.input}`} />
              </div>
            </div>

            {/* Total preview */}
            {canSubmit && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className={`rounded-xl border px-3 py-2.5 flex items-center justify-between ${dk ? "border-white/8 bg-white/4" : "border-gray-200 bg-gray-50"}`}>
                <div>
                  <p className={`text-[9px] font-black uppercase tracking-widest ${T.sectionLbl}`}>Total reserved</p>
                  <p className={`text-[18px] font-black ${T.textPrimary}`}>${totalAmt.toFixed(0)}</p>
                </div>
                <div className="text-right">
                  <p className={`text-[9px] ${T.textMuted}`}>{makerTfs.size} order{makerTfs.size > 1 ? "s" : ""}</p>
                  <p className={`text-[9px] ${T.textMuted}`}>${makerAmtNum} each</p>
                </div>
              </motion.div>
            )}

            {/* Auto-reopen */}
            <button onClick={() => setAutoReopen(v => !v)}
              className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-xl border transition-all ${
                autoReopen
                  ? dk ? "border-white/20 bg-white/8" : "border-gray-300 bg-gray-100"
                  : dk ? "border-white/8 bg-transparent" : "border-gray-100 bg-transparent"
              }`}>
              <span className={`text-[15px] leading-none ${autoReopen ? "" : "opacity-30"}`}>↻</span>
              <div className="text-left">
                <p className={`text-[10px] font-black ${autoReopen ? T.textPrimary : T.textMuted}`}>Auto-reopen</p>
                <p className={`text-[9px] ${T.textMuted}`}>Recreate after each resolves</p>
              </div>
              <div className={`ml-auto w-8 h-4 rounded-full relative transition-colors ${
                autoReopen ? makerSide === "short" ? "bg-red-500" : "bg-emerald-500" : dk ? "bg-white/15" : "bg-gray-200"
              }`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${autoReopen ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
            </button>

            {makerError && <p className="text-[10px] font-bold text-red-400">{makerError}</p>}

            <motion.button whileTap={{ scale: 0.97 }} onClick={handleMultiOrder}
              disabled={!canSubmit || makerLoading || makerDone}
              className={`w-full py-3.5 rounded-xl text-[13px] font-black uppercase tracking-widest transition-all ${
                makerDone ? "bg-emerald-500 text-white"
                : makerLoading ? dk ? "bg-white/8 text-white/30" : "bg-gray-100 text-gray-400"
                : canSubmit
                  ? makerSide === "long"  ? "bg-emerald-500 text-white hover:bg-emerald-400"
                  : "bg-red-500 text-white hover:bg-red-400"
                  : dk ? "bg-white/10 text-white/40 cursor-not-allowed" : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}>
              {makerDone ? `${makerTfs.size > 1 ? "Orders" : "Order"} placed ✓`
                : makerLoading ? "Placing…"
                : canSubmit ? `Place ${makerTfs.size} Order${makerTfs.size > 1 ? "s" : ""} · $${totalAmt.toFixed(0)}`
                : "Select side + timeframe"}
            </motion.button>

            <p className={`text-[9px] text-center ${T.textMuted}`}>
              Orders wait in the book until someone sweeps them.
            </p>
          </div>
          );
        })()}
      </div>

      </div>{/* end 3-col */}
    </div>
  );
}
