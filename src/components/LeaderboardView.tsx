"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api, LeaderboardEntry } from "../lib/api";

type Period = "week" | "month" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  week:  "This Week",
  month: "This Month",
  all:   "All Time",
};

const MEDALS = ["🥇", "🥈", "🥉"];

export default function LeaderboardView({ dk }: { dk: boolean }) {
  const [period, setPeriod]   = useState<Period>("week");
  const [rows, setRows]       = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.leaderboard(period)
      .then(setRows)
      .catch((e) => setError(e.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [period]);

  // ── theme tokens ────────────────────────────────────────────────────────────
  const T = {
    muted:      dk ? "text-white/30"  : "text-gray-400",
    normal:     dk ? "text-white/70"  : "text-gray-600",
    strong:     dk ? "text-white"     : "text-gray-900",
    label:      dk ? "text-white/20"  : "text-gray-400",
    card:       dk ? "border-white/8 bg-white/[0.02]" : "border-gray-200 bg-white",
    cardTop:    dk ? "border-amber-400/20 bg-amber-400/[0.04]" : "border-amber-200 bg-amber-50/60",
    pillGroup:  dk ? "bg-white/5"     : "bg-gray-100",
    pillActive: dk ? "bg-white text-black" : "bg-white text-gray-900 shadow-sm",
    pillInact:  dk ? "text-white/40 hover:text-white/70" : "text-gray-500 hover:text-gray-800",
    bar:        dk ? "bg-white/5"     : "bg-gray-100",
    barFill:    dk ? "bg-emerald-400" : "bg-emerald-500",
    barFillNeg: dk ? "bg-red-400"     : "bg-red-500",
  };

  const maxPnl = rows.length > 0 ? Math.max(...rows.map((r) => Math.abs(parseFloat(r.pnl)))) : 1;

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
      {/* Period picker */}
      <div className={`flex rounded-2xl p-1 gap-1 ${T.pillGroup}`}>
        {(["week", "month", "all"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
              period === p ? T.pillActive : T.pillInact
            }`}
          >
            {p === "week" ? "Week" : p === "month" ? "Month" : "All Time"}
          </button>
        ))}
      </div>

      {/* Header */}
      <div>
        <p className={`text-[10px] font-black uppercase tracking-widest ${T.label}`}>
          Top Traders · {PERIOD_LABELS[period]}
        </p>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className={`rounded-2xl border h-[72px] animate-pulse ${T.card}`} />
          ))}
        </div>
      ) : error ? (
        <p className={`text-[13px] font-bold ${T.muted}`}>{error}</p>
      ) : rows.length === 0 ? (
        <div className="pt-8 text-center space-y-2">
          <p className={`text-[28px]`}>🏆</p>
          <p className={`text-[14px] font-black ${T.strong}`}>No trades yet this period.</p>
          <p className={`text-[12px] font-bold ${T.muted}`}>Make some calls and get on the board.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const pnl      = parseFloat(row.pnl);
            const winRate  = row.total_bets > 0 ? Math.round((row.wins / row.total_bets) * 100) : 0;
            const barWidth = maxPnl > 0 ? Math.abs(pnl) / maxPnl : 0;
            const isTop3   = i < 3;

            return (
              <motion.div
                key={row.username}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`rounded-2xl border p-4 space-y-2.5 ${isTop3 ? T.cardTop : T.card}`}
              >
                {/* Row header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className={`text-[15px] ${isTop3 ? "" : "opacity-0 w-[18px]"}`}>
                      {isTop3 ? MEDALS[i] : ""}
                    </span>
                    {!isTop3 && (
                      <span className={`text-[12px] font-black tabular-nums w-[18px] text-center ${T.muted}`}>
                        {i + 1}
                      </span>
                    )}
                    <div>
                      <p className={`text-[14px] font-black ${T.strong}`}>{row.username}</p>
                      <p className={`text-[10px] font-bold ${T.muted}`}>
                        {row.wins}W / {row.total_bets - row.wins}L · {winRate}% win rate
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className={`text-[16px] font-black tabular-nums ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(2)}
                    </p>
                    <p className={`text-[10px] font-bold ${T.muted}`}>
                      ${parseFloat(row.volume).toFixed(0)} vol
                    </p>
                  </div>
                </div>

                {/* P&L bar */}
                <div className={`h-1 rounded-full overflow-hidden ${T.bar}`}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${barWidth * 100}%` }}
                    transition={{ duration: 0.5, delay: i * 0.03 }}
                    className={`h-full rounded-full ${pnl >= 0 ? T.barFill : T.barFillNeg}`}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
