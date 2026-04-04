"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api, LeaderboardEntry } from "../lib/api";

type Period = "week" | "month" | "all";

export default function LeaderboardView({ dk, onViewProfile, paperMode = false }: { dk: boolean; onViewProfile?: (username: string) => void; paperMode?: boolean }) {
  const [period, setPeriod]   = useState<Period>("week");
  const [dir, setDir]         = useState<"desc" | "asc">("desc");
  const [rows, setRows]       = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.leaderboard(period, paperMode)
      .then(setRows)
      .catch((e) => setError(e.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, [period, paperMode]);

  const T = {
    muted:      dk ? "text-white/30"  : "text-gray-400",
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

  const sorted = (d: "asc" | "desc") =>
    [...rows].sort((a, b) =>
      d === "desc"
        ? parseFloat(b.pnl) - parseFloat(a.pnl)
        : parseFloat(a.pnl) - parseFloat(b.pnl)
    ).slice(0, 10);

  const displayed = sorted(dir);
  const maxPnl  = rows.length > 0 ? Math.max(...rows.map(r => Math.abs(parseFloat(r.pnl)))) : 1;

  const medals = ["🥇","🥈","🥉"];

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className={`text-[11px] font-black uppercase tracking-widest ${T.label}`}>Leaderboard</p>
          <button onClick={() => setDir(d => d === "desc" ? "asc" : "desc")}
            className={`text-[13px] font-black transition-opacity hover:opacity-70 ${dir === "desc" ? "text-emerald-400" : "text-red-400"}`}>
            {dir === "desc" ? "▲ Top Winners" : "▼ Top Losers"}
          </button>
        </div>
        <div className={`flex rounded-xl p-0.5 gap-0.5 ${T.pillGroup}`}>
          {(["week", "month", "all"] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`flex-1 py-1.5 rounded-[9px] text-[10px] font-black transition-all ${period === p ? T.pillActive : T.pillInact}`}>
              {p === "week" ? "Week" : p === "month" ? "Month" : "All"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className={`rounded-2xl border h-[80px] animate-pulse ${T.card}`} />)}</div>
      ) : error ? (
        <p className={`text-[13px] font-bold ${T.muted}`}>{error}</p>
      ) : rows.length === 0 ? (
        <div className="pt-8 text-center space-y-2">
          <p className="text-[28px]">🏆</p>
          <p className={`text-[14px] font-black ${T.strong}`}>No trades yet this period.</p>
          <p className={`text-[12px] font-bold ${T.muted}`}>Make some calls and get on the board.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map((row, i) => {
            const pnl     = parseFloat(row.pnl);
            const winRate = row.total_bets > 0 ? Math.round((row.wins / row.total_bets) * 100) : 0;
            const barW    = maxPnl > 0 ? Math.abs(pnl) / maxPnl : 0;
            const isTop3  = i < 3;
            const isGainer = dir === "desc";

            return (
              <motion.div key={row.username} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                onClick={() => onViewProfile?.(row.username)}
                className={`rounded-2xl border p-4 cursor-pointer transition-all hover:scale-[1.01] ${isTop3 ? T.cardTop : T.card}`}>

                {/* Top row: rank + avatar + name + bio + pnl */}
                <div className="flex items-center gap-3">
                  {/* Rank */}
                  <span className="w-6 text-center shrink-0">
                    {isTop3 ? <span className="text-[18px]">{medals[i]}</span> : <span className={`text-[13px] font-black tabular-nums ${T.muted}`}>{i + 1}</span>}
                  </span>

                  {/* Avatar */}
                  {row.avatar_url ? (
                    <img src={row.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                  ) : (
                    <span className={`w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-black shrink-0 ${dk ? "bg-white/10 text-white/50" : "bg-gray-200 text-gray-500"}`}>
                      {row.username.charAt(0).toUpperCase()}
                    </span>
                  )}

                  {/* Name + stats */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[14px] font-black truncate ${T.strong}`}>{row.username}</span>
                      {row.tier && row.tier !== "" && row.tier !== "basic" && (
                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${
                          row.tier === "elite" ? "bg-zinc-800 text-white" :
                          row.tier === "top" ? "bg-yellow-500/20 text-yellow-400" :
                          "bg-blue-500/20 text-blue-400"
                        }`}>{row.tier.toUpperCase()}</span>
                      )}
                    </div>
                    {row.bio && <p className={`text-[10px] font-bold ${T.muted} truncate`}>{row.bio}</p>}
                    <p className={`text-[10px] font-bold ${T.muted}`}>{row.wins}W/{row.total_bets - row.wins}L · {winRate}%</p>
                  </div>

                  {/* PnL */}
                  <div className="text-right shrink-0">
                    <p className={`text-[18px] font-black tabular-nums leading-none ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toFixed(0)}
                    </p>
                    <p className={`text-[10px] font-bold mt-0.5 ${T.muted}`}>
                      {row.wins}W/{row.total_bets - row.wins}L · {winRate}%
                    </p>
                  </div>
                </div>

                {/* Bar */}
                <div className={`h-1 rounded-full overflow-hidden mt-3 ${T.bar}`}>
                  <motion.div initial={{ width: 0 }} animate={{ width: `${barW * 100}%` }} transition={{ duration: 0.6, delay: i * 0.04 }}
                    className={`h-full rounded-full ${isGainer ? T.barFill : T.barFillNeg}`} />
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
