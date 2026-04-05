"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import type { Candle, TokenInfo } from "@/lib/chartData";
import { getOHLCV, resolutionForTf, getPriceByPair } from "@/lib/chartData";
import { api, Market } from "@/lib/api";

const Chart = dynamic(() => import("./Chart"), { ssr: false });

const FEE = 0.05;
const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "24h"];

function mult(mine: number, other: number) {
  if (mine === 0) return 0;
  return 1 + (other * (1 - FEE)) / mine;
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

type Position = { id: string; side: "long" | "short"; amount: string; message: string | null; placed_at: string; username: string; avatar_url: string | null; is_opener: boolean; timeframe: string };
import type { OrderBook, OrderBookTimeframe } from "@/lib/api";

interface Props {
  token: TokenInfo;
  dk: boolean;
  onClose: () => void;
  onBet: (marketId: string, side: "long" | "short", amount: number, message?: string) => Promise<string | null>;
  onSweep?: (side: "long" | "short", amount: number, timeframe: string, symbol?: string, chain?: string) => Promise<string | null>;
  onOpenMarket: () => void;
  loggedIn: boolean;
  onAuthRequired: () => void;
  paperMode: boolean;
  presets: number[];
  onViewProfile: () => void;
  onViewFullChart?: () => void;
  onAutoTrade?: (side: "long" | "short", amount: number, timeframe: string, tagline?: string) => Promise<string | null>;
}

export default function ChartModal({
  token, dk, onClose, onBet, onSweep, onOpenMarket, loggedIn, onAuthRequired,
  paperMode, presets, onViewProfile, onViewFullChart, onAutoTrade,
}: Props) {
  const [chartTf, setChartTf]     = useState("1h");
  const [candles, setCandles]     = useState<Candle[]>([]);
  const [loading, setLoading]     = useState(true);
  const [livePrice, setLivePrice] = useState<number | null>(null);

  // Trade state
  const [tradeTab, setTradeTab]     = useState<"trade" | "sweep">("trade");
  const [timeframe, setTimeframe]   = useState("5m");
  const [side, setSide]             = useState<"long" | "short" | null>(null);
  const [amount, setAmount]         = useState<number | null>(null);
  const [customAmt, setCustomAmt]   = useState("");
  const [tagline, setTagline]       = useState("");
  const [betError, setBetError]     = useState("");
  const [betLoading, setBetLoading] = useState(false);

  // Data
  const [markets, setMarkets]       = useState<Market[]>([]);
  const [positions, setPositions]   = useState<Position[]>([]);
  const [orderBook, setOrderBook]   = useState<OrderBook | null>(null);
  const [myPositions, setMyPositions] = useState<{ id: string; side: "long" | "short"; amount: string; timeframe: string; closes_at: string }[]>([]);

  const bg     = dk ? "bg-[#0a0a0a]" : "bg-white";
  const border = dk ? "border-white/10" : "border-gray-200";
  const muted  = dk ? "text-white/40" : "text-gray-400";
  const strong = dk ? "text-white" : "text-gray-900";

  // Fetch token data
  useEffect(() => {
    if (!token?.symbol) return;
    api.getTokenFeed(token.symbol).then(data => {
      setMarkets((data.markets ?? []).filter((m: any) => m && m.symbol));
      setPositions(data.positions ?? []);
    }).catch(() => {});
    // Fetch user positions
    if (loggedIn) {
      api.portfolio().then(data => {
        const mine = data.positions
          .filter((p: any) => p.symbol?.toUpperCase() === token.symbol.toUpperCase() && p.market_status === "open" && !!p.is_paper === paperMode)
          .map((p: any) => ({ id: p.id, side: p.side, amount: p.amount_usd, timeframe: p.timeframe, closes_at: p.closes_at }));
        setMyPositions(mine);
      }).catch(() => {});
    }
    // Fetch order book
    api.getOrderBook(token.symbol, token.chainLabel, paperMode).then(data => {
      setOrderBook(data);
    }).catch(() => {});
  }, [token?.symbol, token?.chainLabel, loggedIn, paperMode]);

  // Fetch OHLCV candles
  const fetchCandles = useCallback(async (pairAddr: string, tf: string) => {
    try {
      const { resolution, limit } = resolutionForTf(tf);
      const data = await getOHLCV(pairAddr, token?.chainLabel ?? "solana", resolution, limit);
      setCandles(data);
    } catch {}
    setLoading(false);
  }, [token?.chainLabel]);

  useEffect(() => {
    const addr = token?.pairAddress || token?.address;
    if (!addr) return;
    setLoading(true);
    fetchCandles(addr, chartTf);
  }, [token?.pairAddress, token?.address, chartTf, fetchCandles]);

  useEffect(() => {
    const addr = token?.pairAddress || token?.address;
    if (!addr) return;
    const i = setInterval(() => fetchCandles(addr, chartTf), 30_000);
    return () => clearInterval(i);
  }, [token?.pairAddress, token?.address, chartTf, fetchCandles]);

  // Live price
  useEffect(() => {
    if (!token?.pairAddress || !token?.chainId) return;
    const poll = async () => {
      try {
        const price = await getPriceByPair(token.chainId, token.pairAddress);
        if (price) setLivePrice(price);
      } catch {}
    };
    poll();
    const i = setInterval(poll, 3_000);
    return () => clearInterval(i);
  }, [token?.pairAddress, token?.chainId]);

  // Active market
  const activeMarket = token?.symbol ? markets
    .filter(m => m.symbol?.toUpperCase() === token.symbol.toUpperCase() && m.status === "open" && m.timeframe === timeframe && !!m.is_paper === paperMode)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null : null;

  const longPool  = activeMarket ? parseFloat(activeMarket.long_pool)  : 0;
  const shortPool = activeMarket ? parseFloat(activeMarket.short_pool) : 0;
  const total     = longPool + shortPool;
  const longPct   = total > 0 ? Math.round((longPool / total) * 100) : 50;
  const longMult  = total > 0 ? mult(longPool, shortPool)  : 1.95;
  const shortMult = total > 0 ? mult(shortPool, longPool)  : 1.95;

  const finalAmount = customAmt ? parseFloat(customAmt) || null : amount;
  const isReady = !!side && !!finalAmount && finalAmount >= 1;

  async function handleExecute() {
    if (!isReady) return;
    if (!loggedIn) { onAuthRequired(); return; }
    setBetLoading(true); setBetError("");
    let err: string | null;
    if (tradeTab === "sweep" && onSweep) {
      err = await onSweep(side!, finalAmount!, timeframe, token?.symbol, token?.chainLabel);
    } else if (!activeMarket) {
      err = onAutoTrade ? await onAutoTrade(side!, finalAmount!, timeframe, tagline.trim() || undefined) : null;
      if (!err && !onAutoTrade) { onOpenMarket(); setBetLoading(false); return; }
    } else {
      err = await onBet(activeMarket.id, side!, finalAmount!, tagline.trim() || undefined);
    }
    setBetLoading(false);
    if (err) setBetError(err);
    else { setSide(null); setAmount(null); setCustomAmt(""); setTagline(""); }
  }

  const T = {
    upIdle:    dk ? "bg-emerald-500/10 hover:bg-emerald-500/20" : "bg-emerald-50 hover:bg-emerald-100",
    downIdle:  dk ? "bg-red-500/10 hover:bg-red-500/20" : "bg-rose-50 hover:bg-rose-100",
    durActive: dk ? "bg-white text-black border-white" : "bg-gray-900 text-white border-gray-900",
    durIdle:   dk ? "bg-white/5 text-white/40 border-white/10 hover:bg-white/10" : "bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200",
    amtIdle:   dk ? "bg-white/5 text-white/40 hover:bg-white/10" : "bg-gray-100 text-gray-400 hover:bg-gray-200",
    input:     dk ? "bg-white/5 border-white/8 text-white placeholder:text-white/20" : "bg-gray-50 border-gray-200 text-gray-900",
    sectionLbl: dk ? "text-white/30" : "text-gray-400",
  };

  // Order book entries for current timeframe
  const tfBook: OrderBookTimeframe | null = orderBook?.timeframes?.[timeframe] ?? null;
  const bookShorts = tfBook?.short?.orders ?? [];
  const bookLongs  = tfBook?.long?.orders ?? [];
  const totalOrders = bookShorts.length + bookLongs.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: "spring", damping: 28, stiffness: 340 }}
        className={`relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border ${bg} ${border} shadow-2xl mx-4`}
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button onClick={onClose}
          className={`absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center text-[14px] font-bold transition-colors ${dk ? "bg-white/10 text-white/50 hover:bg-white/20" : "bg-gray-100 text-gray-400 hover:bg-gray-200"}`}>
          ✕
        </button>

        {/* Header */}
        <div className={`px-5 pt-5 pb-3 border-b ${border}`}>
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[20px] font-black ${strong}`}>${token?.symbol ?? ""}</span>
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${dk ? "bg-white/8 text-white/50" : "bg-gray-100 text-gray-500"}`}>{token?.chainLabel ?? ""}</span>
            {onViewFullChart && (
              <button onClick={onViewFullChart} className={`ml-auto text-[10px] font-bold transition-all ${dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"}`}>
                Full chart →
              </button>
            )}
          </div>
          <p className={`text-[16px] font-black font-mono ${strong}`}>
            ${formatPrice(livePrice ?? token?.price ?? 0)}
            <span className={`text-[11px] font-bold ml-2 ${(token?.change24h ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {(token?.change24h ?? 0) >= 0 ? "+" : ""}{(token?.change24h ?? 0).toFixed(1)}%
            </span>
          </p>
        </div>

        {/* Top row: Chart (left) + Trade Panel (right) */}
        <div className={`flex border-b ${border}`}>
          {/* Chart */}
          <div className={`flex-1 min-w-0 px-4 pt-3 pb-3 border-r ${border}`}>
            <div className={`relative w-full h-[220px] rounded-xl overflow-hidden ${dk ? "bg-[#0e0e0e]" : "bg-gray-50"}`}>
              {candles.length > 0 && <Chart candles={candles} livePrice={livePrice ?? undefined} dk={dk} />}
              {loading && candles.length === 0 && <div className={`absolute inset-0 flex items-center justify-center ${muted} text-[12px] font-bold`}>Loading chart...</div>}
              {!loading && candles.length === 0 && <div className={`absolute inset-0 flex items-center justify-center ${muted} text-[12px] font-bold`}>No chart data</div>}
            </div>
            <div className="flex gap-1 mt-2">
              {TIMEFRAMES.map(tf => (
                <button key={tf} onClick={() => setChartTf(tf)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all ${chartTf === tf ? dk ? "bg-white text-black" : "bg-gray-900 text-white" : dk ? "bg-white/6 text-white/35 hover:bg-white/12" : "bg-gray-100 text-gray-400 hover:bg-gray-200"}`}>
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Trade Panel */}
          <div className="shrink-0 overflow-y-auto px-4 pt-3 pb-4" style={{ width: 260, maxHeight: 340 }}>
            {/* Trade / Sweep tabs */}
            <div className={`flex mb-3 border-b ${border}`}>
              {(["trade", "sweep"] as const).map(tab => (
                <button key={tab} onClick={() => setTradeTab(tab)}
                  className={`flex-1 pb-2 text-[10px] font-black uppercase tracking-wider transition-all relative ${tradeTab === tab ? dk ? "text-white" : "text-gray-900" : dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"}`}>
                  {tab === "trade" ? "Trade" : "Sweep"}
                  {tradeTab === tab && <span className={`absolute bottom-0 left-0 right-0 h-[2px] ${dk ? "bg-white" : "bg-gray-900"}`} />}
                </button>
              ))}
            </div>

            {/* Side */}
            <div className="flex gap-2 mb-3">
              <motion.button whileTap={{ scale: 0.96 }} onClick={() => { if (!loggedIn) { onAuthRequired(); return; } setSide(side === "long" ? null : "long"); }}
                className={`flex-1 rounded-xl py-2.5 text-center transition-all duration-150 ${side === "long" ? "bg-emerald-500" : T.upIdle}`}>
                <p className={`text-[14px] font-black ${side === "long" ? "text-white" : "text-emerald-300"}`}>▲ Long</p>
                <p className={`text-[10px] font-black ${side === "long" ? "text-emerald-100/80" : "text-emerald-400/70"}`}>{longMult.toFixed(2)}x</p>
              </motion.button>
              <motion.button whileTap={{ scale: 0.96 }} onClick={() => { if (!loggedIn) { onAuthRequired(); return; } setSide(side === "short" ? null : "short"); }}
                className={`flex-1 rounded-xl py-2.5 text-center transition-all duration-150 ${side === "short" ? "bg-red-500" : T.downIdle}`}>
                <p className={`text-[14px] font-black ${side === "short" ? "text-white" : "text-red-300"}`}>▼ Short</p>
                <p className={`text-[10px] font-black ${side === "short" ? "text-red-100/80" : "text-red-400/70"}`}>{shortMult.toFixed(2)}x</p>
              </motion.button>
            </div>

            {/* Pool bar */}
            {activeMarket && (
              <div className="mb-3">
                <div className="flex h-1 rounded-full overflow-hidden gap-0.5 mb-1">
                  <motion.div animate={{ width: `${longPct}%` }} className="h-full bg-emerald-500 rounded-l-full" />
                  <motion.div animate={{ width: `${100 - longPct}%` }} className="h-full bg-red-500 rounded-r-full" />
                </div>
                <div className={`flex justify-between text-[9px] font-bold ${muted}`}>
                  <span className="text-emerald-400/60">${longPool.toFixed(0)}</span>
                  <span>{totalOrders} open</span>
                  <span className="text-red-400/60">${shortPool.toFixed(0)}</span>
                </div>
              </div>
            )}

            {/* Duration (only for Trade, not Sweep) */}
            {tradeTab === "trade" && (
              <div className="mb-3">
                <p className={`text-[8px] font-black uppercase tracking-widest mb-1.5 ${T.sectionLbl}`}>Duration</p>
                <div className="flex flex-wrap gap-1">
                  {TIMEFRAMES.map(tf => (
                    <button key={tf} onClick={() => setTimeframe(tf)}
                      className={`text-[10px] font-black px-2.5 py-1 rounded-full border transition-all ${timeframe === tf ? T.durActive : T.durIdle}`}>
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {tradeTab === "sweep" && (
              <p className={`text-[8px] font-black uppercase tracking-widest mb-3 ${T.sectionLbl} opacity-50`}>Sweeps all open timeframes</p>
            )}

            {/* Amount */}
            <div className="mb-3">
              <p className={`text-[8px] font-black uppercase tracking-widest mb-1.5 ${T.sectionLbl}`}>Amount</p>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {presets.map(a => (
                  <button key={a} onClick={() => { setAmount(a); setCustomAmt(String(a)); }}
                    className={`py-1.5 rounded-lg text-[10px] font-black transition-all ${amount === a && customAmt === String(a)
                      ? side === "long" ? "bg-emerald-500 text-white" : side === "short" ? "bg-red-500 text-white" : dk ? "bg-white text-black" : "bg-gray-900 text-white"
                      : T.amtIdle}`}>
                    ${a}
                  </button>
                ))}
              </div>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${muted}`}>$</span>
                <input type="number" placeholder="custom" value={customAmt}
                  onChange={e => { setCustomAmt(e.target.value); setAmount(null); }}
                  className={`w-full border text-[11px] font-bold pl-6 pr-3 py-1.5 rounded-lg outline-none transition-all ${T.input}`} />
              </div>
            </div>

            {/* Message (Trade only) */}
            {tradeTab === "trade" && (
              <div className="mb-3">
                <textarea value={tagline} onChange={e => setTagline(e.target.value)}
                  maxLength={60} placeholder={`${token?.symbol ?? ""} to the moon!`} rows={1}
                  className={`w-full border text-[10px] font-bold p-2 rounded-lg outline-none resize-none transition-all ${T.input} placeholder:opacity-30`} />
              </div>
            )}

            {betError && <p className="text-[10px] font-bold text-red-400 mb-2">{betError}</p>}

            <motion.button whileTap={{ scale: 0.97 }} onClick={handleExecute}
              disabled={!isReady || betLoading}
              className={`w-full py-3 rounded-xl text-[12px] font-black uppercase tracking-widest transition-all ${
                betLoading ? dk ? "bg-white/8 text-white/30" : "bg-gray-100 text-gray-400"
                : isReady
                  ? side === "long" ? "bg-emerald-500 text-white hover:bg-emerald-400" : "bg-red-500 text-white hover:bg-red-400"
                  : dk ? "bg-white/10 text-white/40 cursor-not-allowed" : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}>
              {betLoading ? "Placing..." : tradeTab === "sweep" ? "Sweep" : activeMarket ? "Trade" : "Open Market"}
            </motion.button>
          </div>
        </div>

        {/* Bottom: Order Book + Your Positions + Recent Calls — horizontal */}
        <div className={`grid grid-cols-3 gap-0`}>
          {/* Order Book */}
          <div className={`px-4 pt-3 pb-3 border-r ${border}`}>
            <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${T.sectionLbl}`}>Order Book</p>
            {/* Shorts */}
            <div className="mb-2">
              <span className="text-[8px] font-black uppercase text-red-400/50">Shorts</span>
              {bookShorts.length === 0
                ? <p className={`text-[10px] ${muted} py-1`}>—</p>
                : bookShorts.slice(0, 5).map(o => (
                  <div key={o.id} className={`flex items-center justify-between py-1 text-[10px] border-b ${dk ? "border-white/4" : "border-gray-50"}`}>
                    <span className={`font-bold ${dk ? "text-white/60" : "text-gray-600"}`}>{o.username}</span>
                    <span className="font-black text-red-400">${o.remaining_amount.toFixed(0)}</span>
                  </div>
                ))
              }
            </div>
            <div className={`my-2 border-t ${dk ? "border-white/6" : "border-gray-100"}`} />
            {/* Longs */}
            <div className="mb-3">
              <span className="text-[8px] font-black uppercase text-emerald-400/50">Longs</span>
              {bookLongs.length === 0
                ? <p className={`text-[10px] ${muted} py-1`}>—</p>
                : bookLongs.slice(0, 5).map(o => (
                  <div key={o.id} className={`flex items-center justify-between py-1 text-[10px] border-b ${dk ? "border-white/4" : "border-gray-50"}`}>
                    <span className={`font-bold ${dk ? "text-white/60" : "text-gray-600"}`}>{o.username}</span>
                    <span className="font-black text-emerald-400">${o.remaining_amount.toFixed(0)}</span>
                  </div>
                ))
              }
            </div>

          </div>

          {/* Your Positions */}
          <div className={`px-4 pt-3 pb-3 border-r ${border}`}>
            <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${T.sectionLbl}`}>Your Positions</p>
            {myPositions.length === 0
              ? <p className={`text-[10px] ${muted}`}>No open positions</p>
              : myPositions.map(p => {
                const msLeft = Math.max(0, new Date(p.closes_at).getTime() - Date.now());
                const countdown = msLeft <= 0 ? "settling" : msLeft < 60000 ? `${Math.floor(msLeft/1000)}s` : msLeft < 3600000 ? `${Math.floor(msLeft/60000)}m` : `${Math.floor(msLeft/3600000)}h`;
                return (
                  <div key={p.id} className={`flex items-center justify-between py-1.5 text-[10px] border-b ${dk ? "border-white/4" : "border-gray-50"}`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-black ${p.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
                        {p.side === "long" ? "▲" : "▼"}
                      </span>
                      <span className={`font-black ${strong}`}>${parseFloat(p.amount).toFixed(0)}</span>
                      <span className={`font-bold ${muted}`}>{p.timeframe}</span>
                    </div>
                    <span className={`font-bold tabular-nums ${msLeft < 60000 ? "text-red-400" : muted}`}>{countdown}</span>
                  </div>
                );
              })
            }
          </div>

          {/* Recent Calls — social feed */}
          <div className="px-4 pt-3 pb-3">
            <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${T.sectionLbl}`}>Recent Calls</p>
            {positions.length === 0
              ? <p className={`text-[10px] ${muted}`}>No calls yet</p>
              : positions.slice(0, 6).map(p => (
                <div key={p.id} className={`flex items-start gap-2 py-2 border-b ${dk ? "border-white/4" : "border-gray-50"}`}>
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover shrink-0 mt-0.5" />
                  ) : (
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black shrink-0 mt-0.5 ${dk ? "bg-white/8 text-white/40" : "bg-gray-100 text-gray-500"}`}>
                      {p.username.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span className={`font-black ${strong}`}>{p.username}</span>
                      <span className={`font-black ${p.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
                        {p.side === "long" ? "▲" : "▼"} ${parseFloat(p.amount).toFixed(0)}
                      </span>
                      <span className={`font-bold ${muted}`}>{p.timeframe}</span>
                    </div>
                    {p.message && (
                      <p className={`text-[10px] mt-0.5 leading-snug ${dk ? "text-white/50" : "text-gray-500"}`}>&ldquo;{p.message}&rdquo;</p>
                    )}
                  </div>
                </div>
              ))
            }
          </div>
        </div>

        {/* Token Profile button */}
        <div className={`px-5 py-3 border-t ${border}`}>
          <button onClick={onViewProfile}
            className={`w-full py-2 rounded-xl text-[11px] font-bold transition-all ${dk ? "bg-white/5 text-white/50 hover:bg-white/10" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}>
            Token Profile →
          </button>
        </div>
      </motion.div>
    </div>
  );
}
