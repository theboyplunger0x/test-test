"use client";

import { motion } from "framer-motion";
import { Coin, formatPrice, formatMarketCap } from "@/lib/mockData";
import { Market } from "@/lib/api";

export default function NewPairsView({
  markets,
  dk,
  onOpenMarket,
  onViewCoin,
  loggedIn,
  onAuthRequired,
  chainFilter = null,
  liveCoins,
}: {
  markets: Market[];
  dk: boolean;
  onOpenMarket: (coin: Coin) => void;
  onViewCoin: (symbol: string) => void;
  loggedIn: boolean;
  onAuthRequired: () => void;
  chainFilter?: string | null;
  liveCoins: Coin[];
}) {
  const coins = chainFilter ? liveCoins.filter(c => c.chain === chainFilter) : liveCoins;
  const T = {
    card:     dk ? "border-white/8 bg-white/[0.03] hover:border-white/14" : "border-gray-200 bg-white hover:border-gray-300 shadow-sm",
    label:    dk ? "text-white/25" : "text-gray-400",
    strong:   dk ? "text-white" : "text-gray-900",
    muted:    dk ? "text-white/40" : "text-gray-500",
    poolBox:  dk ? "bg-white/4" : "bg-gray-50",
    pos:      "text-emerald-400",
    neg:      "text-red-400",
    openBtn:  dk
      ? "bg-white text-black hover:bg-white/90"
      : "bg-gray-900 text-white hover:bg-black",
    joinBtn:  dk
      ? "bg-white/8 border border-white/12 text-white/60 hover:bg-white/14 hover:text-white"
      : "bg-gray-100 border border-gray-200 text-gray-600 hover:bg-gray-200",
  };

  function chainPill(chain: string) {
    if (chain === "SOL")  return dk ? "text-purple-300 bg-purple-500/20" : "text-purple-700 bg-purple-100";
    if (chain === "BASE") return dk ? "text-blue-300 bg-blue-500/20"     : "text-blue-700 bg-blue-100";
    if (chain === "BSC")  return dk ? "text-yellow-300 bg-yellow-500/20" : "text-yellow-700 bg-yellow-100";
    return dk ? "text-orange-300 bg-orange-500/20" : "text-orange-700 bg-orange-100";
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5">
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {coins.map((coin, i) => {
          const coinMarkets = markets.filter(m => m.symbol === coin.symbol);
          const totalPool = coinMarkets.reduce(
            (s, m) => s + parseFloat(m.long_pool) + parseFloat(m.short_pool), 0
          );

          return (
            <motion.div
              key={coin.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className={`rounded-2xl border-2 p-4 flex flex-col gap-3 transition-all ${T.card}`}
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <button onClick={() => onViewCoin(coin.symbol)}
                    className={`text-[18px] font-black leading-none transition-colors hover:opacity-70 ${T.strong}`}>
                    ${coin.symbol}
                  </button>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${chainPill(coin.chain)}`}>{coin.chain}</span>
                    <span className={`text-[10px] font-mono ${T.muted}`}>${formatPrice(coin.price)}</span>
                  </div>
                </div>
                <span className={`text-[13px] font-black ${coin.change24h >= 0 ? T.pos : T.neg}`}>
                  {coin.change24h >= 0 ? "+" : ""}{coin.change24h.toFixed(1)}%
                </span>
              </div>

              {/* Stats */}
              <div className={`rounded-xl px-3 py-2.5 flex justify-between ${T.poolBox}`}>
                <div>
                  <p className={`text-[9px] font-black uppercase tracking-widest mb-0.5 ${T.label}`}>Mkt cap</p>
                  <p className={`text-[12px] font-black ${T.muted}`}>{formatMarketCap(coin.marketCap)}</p>
                </div>
                <div className="text-center">
                  <p className={`text-[9px] font-black uppercase tracking-widest mb-0.5 ${T.label}`}>Age</p>
                  <p className={`text-[12px] font-black ${T.muted}`}>{coin.age}</p>
                </div>
                <div className="text-right">
                  <p className={`text-[9px] font-black uppercase tracking-widest mb-0.5 ${T.label}`}>Open mkts</p>
                  <p className={`text-[12px] font-black ${coinMarkets.length > 0 ? T.pos : T.label}`}>
                    {coinMarkets.length > 0 ? `${coinMarkets.length} · $${totalPool.toFixed(0)}` : "—"}
                  </p>
                </div>
              </div>

              {/* CTA */}
              {coinMarkets.length === 0 ? (
                <button
                  onClick={() => { if (!loggedIn) { onAuthRequired(); return; } onOpenMarket(coin); }}
                  className={`w-full py-2.5 rounded-xl text-[12px] font-black transition-all ${T.openBtn}`}
                >
                  Be first — Open Market
                </button>
              ) : (
                <button
                  onClick={() => { if (!loggedIn) { onAuthRequired(); return; } onOpenMarket(coin); }}
                  className={`w-full py-2.5 rounded-xl text-[12px] font-black transition-all ${T.joinBtn}`}
                >
                  Trade →
                </button>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
