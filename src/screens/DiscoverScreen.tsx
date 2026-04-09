"use client";

import { motion } from "framer-motion";
import type { TokenInfo } from "@/lib/chartData";

type TrendingSort = "mcap-desc" | "mcap-asc" | "vol-desc" | "vol-asc" | null;

interface DiscoverScreenProps {
  dk:              boolean;
  trendingTokens:  TokenInfo[];
  trendingLoading: boolean;
  trendingChain:   string | null;
  trendingSort:    TrendingSort;
  setTrendingChain: (chain: string | null) => void;
  setTrendingSort:  (sort: TrendingSort) => void;
  onOpenMarket:    (token: TokenInfo) => void;
  onViewToken:     (token: TokenInfo) => void;
}

const filterActive   = (dk: boolean) => dk ? "bg-white/12 text-white"               : "bg-gray-200 text-gray-900";
const filterInactive = (dk: boolean) => dk ? "text-white/30 hover:text-white/60"    : "text-gray-400 hover:text-gray-700";
const navBorder      = (dk: boolean) => dk ? "border-white/6"                       : "border-gray-100";

/**
 * Discover screen — trending tokens with sub-filters and chain pills.
 */
export default function DiscoverScreen({
  dk,
  trendingTokens,
  trendingLoading,
  trendingChain,
  trendingSort,
  setTrendingChain,
  setTrendingSort,
  onOpenMarket,
  onViewToken,
}: DiscoverScreenProps) {
  let displayed = trendingTokens;
  if (trendingChain) displayed = displayed.filter(t => t.chainLabel === trendingChain);
  if (trendingSort === "mcap-desc")      displayed = [...displayed].sort((a, b) => b.marketCap - a.marketCap);
  else if (trendingSort === "mcap-asc")  displayed = [...displayed].sort((a, b) => a.marketCap - b.marketCap);
  else if (trendingSort === "vol-desc")  displayed = [...displayed].sort((a, b) => b.volume24h - a.volume24h);
  else if (trendingSort === "vol-asc")   displayed = [...displayed].sort((a, b) => a.volume24h - b.volume24h);

  return (
    <motion.div key="trending"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      className="flex-1 flex flex-col overflow-hidden">

      {/* Header: sub-filters + chain */}
      <div className={`flex items-center justify-between px-5 py-2 border-b shrink-0 ${navBorder(dk)}`}>
        <div className="flex items-center gap-1.5">
          {(["all", "new", "trending"] as const).map(f => (
            <button key={f} onClick={() => setTrendingSort(f === "all" ? null : f === "new" ? "vol-asc" : "mcap-desc")}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all ${
                (f === "all" && !trendingSort) || (f === "new" && trendingSort === "vol-asc") || (f === "trending" && trendingSort === "mcap-desc")
                  ? filterActive(dk) : filterInactive(dk)
              }`}>
              {f === "all" ? "All" : f === "new" ? "New Pairs" : "Trending"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {["SOL", "ETH", "BASE"].map(c => (
            <button key={c} onClick={() => setTrendingChain(trendingChain === c ? null : c)}
              className={`px-2 py-1 rounded-lg text-[10px] font-black transition-all ${
                trendingChain === c
                  ? c === "SOL" ? "bg-purple-500/20 text-purple-300" : c === "ETH" ? "bg-orange-500/20 text-orange-300" : "bg-blue-500/20 text-blue-300"
                  : dk ? "text-white/30 hover:text-white/50" : "text-gray-400 hover:text-gray-600"
              }`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {trendingLoading && trendingTokens.length === 0 ? (
          <div className={`flex items-center justify-center h-full ${dk ? "text-white/30" : "text-gray-400"}`}>
            <span className="text-[13px] font-bold">Loading…</span>
          </div>
        ) : displayed.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-full gap-3 ${dk ? "text-white/30" : "text-gray-400"}`}>
            <span className="text-[32px]">—</span>
            <p className="text-[13px] font-bold">{trendingTokens.length === 0 ? "No trending data" : "No results for this filter"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {displayed.map((token, i) => (
              <TrendingTokenCard
                key={token.address}
                token={token}
                rank={i + 1}
                dk={dk}
                onOpenMarket={() => onOpenMarket(token)}
                onViewCoin={() => onViewToken(token)}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── TrendingTokenCard ────────────────────────────────────────────────────────

function TrendingTokenCard({ token, rank, dk, onOpenMarket, onViewCoin }: {
  token: TokenInfo; rank: number; dk: boolean;
  onOpenMarket: () => void; onViewCoin: () => void;
}) {
  function chainPill(chain: string) {
    if (chain === "SOL")  return dk ? "text-purple-300 bg-purple-500/20" : "text-purple-700 bg-purple-100";
    if (chain === "BASE") return dk ? "text-blue-300 bg-blue-500/20"     : "text-blue-700 bg-blue-100";
    if (chain === "BSC")  return dk ? "text-yellow-300 bg-yellow-500/20" : "text-yellow-700 bg-yellow-100";
    return dk ? "text-orange-300 bg-orange-500/20" : "text-orange-700 bg-orange-100";
  }

  function fmtPrice(n: number): string {
    if (n >= 1) return `$${n.toFixed(4)}`;
    if (n >= 0.0001) return `$${n.toFixed(6)}`;
    return `$${n.toPrecision(4)}`;
  }

  function fmtNum(n: number): string {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  }

  const pos = "text-emerald-400";
  const neg = "text-red-400";
  const card = dk ? "border-white/8 bg-white/[0.03] hover:border-white/14" : "border-gray-200 bg-white hover:border-gray-300 shadow-sm";
  const label = dk ? "text-white/25" : "text-gray-400";
  const muted = dk ? "text-white/40" : "text-gray-500";
  const strong = dk ? "text-white" : "text-gray-900";
  const poolBox = dk ? "bg-white/4" : "bg-gray-50";
  const openBtn = dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-black";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.03 }}
      className={`rounded-2xl border-2 p-4 flex flex-col gap-3 transition-all ${card}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-black ${label}`}>#{rank}</span>
            <button onClick={onViewCoin} className={`text-[18px] font-black leading-none transition-colors hover:opacity-70 ${strong}`}>
              ${token.symbol}
            </button>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${chainPill(token.chainLabel)}`}>{token.chainLabel}</span>
            <span className={`text-[10px] font-mono ${muted}`}>{fmtPrice(token.price)}</span>
          </div>
        </div>
        <span className={`text-[13px] font-black ${token.change24h >= 0 ? pos : neg}`}>
          {token.change24h >= 0 ? "+" : ""}{token.change24h.toFixed(1)}%
        </span>
      </div>

      <div className={`rounded-xl px-3 py-2.5 flex justify-between ${poolBox}`}>
        <div>
          <p className={`text-[9px] font-black uppercase tracking-widest mb-0.5 ${label}`}>Mkt cap</p>
          <p className={`text-[12px] font-black ${muted}`}>{token.marketCap > 0 ? fmtNum(token.marketCap) : "—"}</p>
        </div>
        <div className="text-right">
          <p className={`text-[9px] font-black uppercase tracking-widest mb-0.5 ${label}`}>Vol 24h</p>
          <p className={`text-[12px] font-black ${muted}`}>{token.volume24h > 0 ? fmtNum(token.volume24h) : "—"}</p>
        </div>
      </div>

      <button onClick={onOpenMarket} className={`w-full py-2.5 rounded-xl text-[12px] font-black transition-all ${openBtn}`}>
        Open Market →
      </button>
    </motion.div>
  );
}
