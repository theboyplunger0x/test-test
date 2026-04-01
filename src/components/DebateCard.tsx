"use client";

import { motion } from "framer-motion";
import type { Market } from "@/lib/api";

type DebatePosition = {
  username: string;
  avatar_url: string | null;
  side: "long" | "short";
  amount: string;
  message: string | null;
};

export type Debate = {
  market: Market;
  shortCaller: DebatePosition;
  longCaller: DebatePosition;
  totalPool: number;
  ratio: number; // 0-1, short share
};

function timeLeft(closesAt: string): string {
  const ms = Math.max(0, new Date(closesAt).getTime() - Date.now());
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (ms < 60_000) return `${s}s`;
  if (ms < 60 * 60_000) return `${m}m`;
  return `${h}h`;
}

export default function DebateCard({
  debate,
  dk,
  onFade,
  onViewProfile,
  onViewToken,
  index = 0,
}: {
  debate: Debate;
  dk: boolean;
  onFade?: (marketId: string, side: "long" | "short") => void;
  onViewProfile?: (username: string) => void;
  onViewToken?: (symbol: string, chain: string) => void;
  index?: number;
}) {
  const { market: m, shortCaller, longCaller, totalPool, ratio } = debate;
  const shortPct = Math.round(ratio * 100);
  const longPct = 100 - shortPct;
  const isResolved = m.status === "resolved";

  const border = dk
    ? "border-yellow-500/30 bg-yellow-500/[0.03]"
    : "border-yellow-300 bg-yellow-50/50";

  const Avatar = ({ pos }: { pos: DebatePosition }) => (
    <button onClick={() => onViewProfile?.(pos.username)} className="shrink-0">
      {pos.avatar_url ? (
        <img src={pos.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
      ) : (
        <span className={`w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-black ${dk ? "bg-white/10 text-white/50" : "bg-gray-200 text-gray-500"}`}>
          {pos.username.charAt(0).toUpperCase()}
        </span>
      )}
    </button>
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={`rounded-2xl border-2 p-4 transition-all ${border}`}
    >
      {/* Header: token + contested badge + time */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onViewToken?.(m.symbol, m.chain)}
            className={`text-[16px] font-black ${dk ? "text-white hover:text-white/70" : "text-gray-900 hover:text-gray-600"} transition-colors`}
          >
            ${m.symbol}
          </button>
          <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${dk ? "bg-yellow-500/20 text-yellow-400" : "bg-yellow-100 text-yellow-700"}`}>
            CONTESTED
          </span>
          <span className={`text-[10px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>{m.timeframe}</span>
        </div>
        <span className={`text-[10px] font-bold tabular-nums ${dk ? "text-white/25" : "text-gray-400"}`}>
          {isResolved ? "closed" : `${timeLeft(m.closes_at)} left`}
        </span>
      </div>

      {/* Duel layout: short caller vs long caller */}
      <div className="flex items-start gap-3">
        {/* Short side */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Avatar pos={shortCaller} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] font-black ${dk ? "text-red-400" : "text-red-600"}`}>▼ SHORT</span>
              </div>
              <button onClick={() => onViewProfile?.(shortCaller.username)}
                className={`text-[12px] font-black truncate block ${dk ? "text-white/70 hover:text-white" : "text-gray-700 hover:text-gray-900"}`}>
                {shortCaller.username}
              </button>
            </div>
          </div>
          {shortCaller.message && (
            <p className={`text-[12px] font-bold leading-snug ${dk ? "text-red-400/70" : "text-red-700/80"}`}>
              &ldquo;{shortCaller.message}&rdquo;
            </p>
          )}
          <p className={`text-[14px] font-black mt-1 tabular-nums ${dk ? "text-white" : "text-gray-900"}`}>
            ${parseFloat(shortCaller.amount).toFixed(0)}
          </p>
        </div>

        {/* VS divider */}
        <div className="flex flex-col items-center justify-center shrink-0 pt-2">
          <span className={`text-[10px] font-black ${dk ? "text-yellow-400/60" : "text-yellow-600"}`}>VS</span>
          <span className={`text-[18px] font-black mt-0.5 tabular-nums ${dk ? "text-white/70" : "text-gray-700"}`}>
            ${totalPool >= 1000 ? `${(totalPool / 1000).toFixed(1)}k` : totalPool.toFixed(0)}
          </span>
        </div>

        {/* Long side */}
        <div className="flex-1 min-w-0 text-right">
          <div className="flex items-center gap-2 mb-1.5 justify-end">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 justify-end">
                <span className={`text-[10px] font-black ${dk ? "text-emerald-400" : "text-emerald-600"}`}>LONG ▲</span>
              </div>
              <button onClick={() => onViewProfile?.(longCaller.username)}
                className={`text-[12px] font-black truncate block ${dk ? "text-white/70 hover:text-white" : "text-gray-700 hover:text-gray-900"}`}>
                {longCaller.username}
              </button>
            </div>
            <Avatar pos={longCaller} />
          </div>
          {longCaller.message && (
            <p className={`text-[12px] font-bold leading-snug ${dk ? "text-emerald-400/70" : "text-emerald-700/80"}`}>
              &ldquo;{longCaller.message}&rdquo;
            </p>
          )}
          <p className={`text-[14px] font-black mt-1 tabular-nums ${dk ? "text-white" : "text-gray-900"}`}>
            ${parseFloat(longCaller.amount).toFixed(0)}
          </p>
        </div>
      </div>

      {/* Pool bar */}
      <div className="mt-3">
        <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
          <motion.div
            animate={{ width: `${shortPct}%` }}
            transition={{ type: "spring", stiffness: 180, damping: 22 }}
            className="h-full rounded-l-full bg-red-500"
          />
          <motion.div
            animate={{ width: `${longPct}%` }}
            transition={{ type: "spring", stiffness: 180, damping: 22 }}
            className="h-full rounded-r-full bg-emerald-500"
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className={`text-[10px] font-bold tabular-nums ${dk ? "text-red-400/60" : "text-red-500"}`}>{shortPct}%</span>
          <span className={`text-[10px] font-bold tabular-nums ${dk ? "text-emerald-400/60" : "text-emerald-500"}`}>{longPct}%</span>
        </div>
      </div>

      {/* Fade CTAs */}
      {!isResolved && onFade && (
        <div className="flex gap-2 mt-3">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => onFade(m.id, "short")}
            className={`flex-1 py-2 rounded-xl text-[11px] font-black border transition-all ${
              dk ? "bg-red-500/15 border-red-500/20 text-red-400 hover:bg-red-500/25"
                 : "bg-red-50 border-red-200 text-red-600 hover:bg-red-100"
            }`}
          >
            Back Short ▼
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => onFade(m.id, "long")}
            className={`flex-1 py-2 rounded-xl text-[11px] font-black border transition-all ${
              dk ? "bg-emerald-500/15 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/25"
                 : "bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100"
            }`}
          >
            Back Long ▲
          </motion.button>
        </div>
      )}
    </motion.div>
  );
}
