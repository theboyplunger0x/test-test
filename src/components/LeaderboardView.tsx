"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api, LeaderboardEntry } from "../lib/api";

type Period = "week" | "month" | "all";

export default function LeaderboardView({ dk, onViewProfile, paperMode = false }: { dk: boolean; onViewProfile?: (username: string) => void; paperMode?: boolean }) {
  const [period, setPeriod]   = useState<Period>("week");
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

  const sorted = (dir: "asc" | "desc") =>
    [...rows].sort((a, b) =>
      dir === "desc"
        ? parseFloat(b.pnl) - parseFloat(a.pnl)
        : parseFloat(a.pnl) - parseFloat(b.pnl)
    ).slice(0, 5);

  const gainers = sorted("desc");
  const losers  = sorted("asc");
  const maxPnl  = rows.length > 0 ? Math.max(...rows.map(r => Math.abs(parseFloat(r.pnl)))) : 1;

  const renderRow = (row: LeaderboardEntry, i: number, isGainers: boolean) => {
    const pnl     = parseFloat(row.pnl);
    const winRate = row.total_bets > 0 ? Math.round((row.wins / row.total_bets) * 100) : 0;
    const barW    = maxPnl > 0 ? Math.abs(pnl) / maxPnl : 0;
    const emoji   = isGainers
      ? ["🥇","🥈","🥉"][i]
      : ["💀","😬","😭"][i];

    return (
      <motion.div key={row.username} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
        className={`rounded-2xl border p-3.5 space-y-2 ${i === 0 ? T.cardTop : T.card}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-5 text-center text-[14px]">
              {i < 3 ? emoji : <span className={`text-[11px] font-black tabular-nums ${T.muted}`}>{i + 1}</span>}
            </span>
            <div>
              <button onClick={() => onViewProfile?.(row.username)}
                className={`text-[13px] font-black ${T.strong} hover:opacity-70 transition-opacity`}>
                {row.username}
              </button>
              <p className={`text-[10px] font-bold ${T.muted}`}>
                {row.wins}W/{row.total_bets - row.wins}L · {winRate}%
              </p>
            </div>
          </div>
          <p className={`text-[15px] font-black tabular-nums ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toFixed(0)}
          </p>
        </div>
        <div className={`h-0.5 rounded-full overflow-hidden ${T.bar}`}>
          <motion.div initial={{ width: 0 }} animate={{ width: `${barW * 100}%` }} transition={{ duration: 0.5, delay: i * 0.04 }}
            className={`h-full rounded-full ${isGainers ? T.barFill : T.barFillNeg}`} />
        </div>
      </motion.div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className={`text-[11px] font-black uppercase tracking-widest ${T.label}`}>Leaderboard</p>
        <div className={`flex rounded-xl p-0.5 gap-0.5 ${T.pillGroup}`}>
          {(["week", "month", "all"] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded-[9px] text-[10px] font-black transition-all ${period === p ? T.pillActive : T.pillInact}`}>
              {p === "week" ? "Week" : p === "month" ? "Month" : "All"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className={`rounded-2xl border h-[64px] animate-pulse ${T.card}`} />)}</div>
      ) : error ? (
        <p className={`text-[13px] font-bold ${T.muted}`}>{error}</p>
      ) : rows.length === 0 ? (
        <div className="pt-8 text-center space-y-2">
          <p className="text-[28px]">🏆</p>
          <p className={`text-[14px] font-black ${T.strong}`}>No trades yet this period.</p>
          <p className={`text-[12px] font-bold ${T.muted}`}>Make some calls and get on the board.</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <p className={`text-[10px] font-black uppercase tracking-widest ${T.label}`}>🔥 Top Gainers</p>
            {gainers.map((row, i) => renderRow(row, i, true))}
          </div>
          <div className="space-y-2">
            <p className={`text-[10px] font-black uppercase tracking-widest ${T.label}`}>📉 Top Losers</p>
            {losers.map((row, i) => renderRow(row, i, false))}
          </div>
        </>
      )}
    </div>
  );
}
