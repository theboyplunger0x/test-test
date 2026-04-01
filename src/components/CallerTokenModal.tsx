"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";

interface Position {
  id: string;
  side: "long" | "short";
  amount: string;
  message: string | null;
  placed_at: string;
  timeframe: string;
  entry_price: string;
  status: string;
  winner_side: "long" | "short" | null;
  is_opener: boolean;
}

interface Props {
  username: string;
  symbol: string;
  dk: boolean;
  onClose: () => void;
  onViewProfile?: (username: string) => void;
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function CallerTokenModal({ username, symbol, dk, onClose, onViewProfile }: Props) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [stats, setStats]         = useState<{ total: number; wins: number } | null>(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    api.getSymbolPositions(symbol, false)
      .then(() => {}) // type compat — use raw fetch below
      .catch(() => {});

    // direct fetch with username filter
    const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    fetch(`${BASE}/positions/symbol/${encodeURIComponent(symbol)}?username=${encodeURIComponent(username)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(data => {
        setPositions(data.positions ?? []);
        setStats({ total: data.total ?? 0, wins: data.wins ?? 0 });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [username, symbol]);

  const winRate = stats && stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : null;

  const T = {
    bg:     dk ? "bg-[#111]"        : "bg-white",
    border: dk ? "border-white/10"  : "border-gray-200",
    muted:  dk ? "text-white/35"    : "text-gray-400",
    strong: dk ? "text-white"       : "text-gray-900",
    row:    dk ? "border-white/6"   : "border-gray-100",
    pill:   dk ? "bg-white/8 text-white/45" : "bg-gray-100 text-gray-500",
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        />
        <motion.div
          initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          className={`relative w-full max-w-lg ${T.bg} border-t ${T.border} rounded-t-2xl max-h-[70vh] flex flex-col`}
          onClick={e => e.stopPropagation()}
        >
          {/* drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className={`w-8 h-1 rounded-full ${dk ? "bg-white/15" : "bg-gray-200"}`} />
          </div>

          {/* header */}
          <div className="flex items-center justify-between px-5 py-3">
            <div>
              <p className={`text-[15px] font-black ${T.strong}`}>{username}</p>
              <p className={`text-[11px] font-bold ${T.muted}`}>on ${symbol}</p>
            </div>
            <div className="flex items-center gap-3">
              {stats && stats.total > 0 && (
                <div className="text-right">
                  <p className={`text-[13px] font-black ${winRate && winRate >= 50 ? "text-emerald-400" : "text-red-400"}`}>
                    {winRate}% win rate
                  </p>
                  <p className={`text-[10px] ${T.muted}`}>{stats.wins}W / {stats.total - stats.wins}L</p>
                </div>
              )}
              <button onClick={() => { onViewProfile?.(username); onClose(); }}
                className={`text-[11px] font-black px-3 py-1.5 rounded-xl border ${T.border} ${T.muted} hover:opacity-70 transition-opacity`}>
                Full profile
              </button>
            </div>
          </div>

          <div className={`border-t ${T.border}`} />

          {/* calls list */}
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="flex flex-col gap-2 p-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className={`h-14 rounded-xl animate-pulse ${dk ? "bg-white/5" : "bg-gray-100"}`} />
                ))}
              </div>
            ) : positions.length === 0 ? (
              <p className={`px-5 py-8 text-center text-[13px] ${T.muted}`}>No calls on ${symbol} yet.</p>
            ) : (
              positions.map(p => {
                const resolved  = !!p.winner_side;
                const won       = resolved && p.side === p.winner_side;
                const pending   = !resolved;
                const amt       = parseFloat(p.amount);
                const sideColor = p.side === "long" ? "text-emerald-400" : "text-red-400";
                const sideLabel = p.side === "long" ? "▲ LONG" : "▼ SHORT";

                return (
                  <div key={p.id} className={`flex items-start gap-3 px-5 py-3 border-b ${T.row}`}>
                    {/* side */}
                    <span className={`text-[10px] font-black shrink-0 mt-0.5 ${sideColor}`}>{sideLabel}</span>

                    {/* message + meta */}
                    <div className="flex-1 min-w-0">
                      {p.message ? (
                        <p className={`text-[12px] font-bold leading-snug ${T.strong}`}>"{p.message}"</p>
                      ) : p.is_opener ? (
                        <p className={`text-[12px] font-bold leading-snug ${T.muted} italic`}>opened the market</p>
                      ) : (
                        <p className={`text-[12px] ${T.muted} italic`}>no message</p>
                      )}
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`text-[9px] font-black px-1 py-0.5 rounded ${T.pill}`}>{p.timeframe}</span>
                        <span className={`text-[9px] ${T.muted}`}>{timeAgo(p.placed_at)}</span>
                      </div>
                    </div>

                    {/* amount + result */}
                    <div className="shrink-0 text-right">
                      <p className={`text-[13px] font-black ${T.strong}`}>${amt.toFixed(0)}</p>
                      {pending ? (
                        <span className={`text-[9px] font-bold ${T.muted}`}>open</span>
                      ) : won ? (
                        <span className="text-[9px] font-black text-emerald-400">✅ won</span>
                      ) : (
                        <span className="text-[9px] font-black text-red-400">❌ rekt</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
