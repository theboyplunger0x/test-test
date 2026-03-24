"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { api, UserProfile } from "../lib/api";

const SEAL = "M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.233-.784.187-1.324.068-1.934-.234-1.173-1.044-2.053-2.176-2.413-.564-.18-1.167-.17-1.726.028-.56.197-1.053.556-1.411 1.032C12.56 3.09 11.68 2.595 10.75 2.5c-1.077-.109-2.096.41-2.698 1.332-.285.434-.431.942-.421 1.456.01.514.178 1.015.484 1.437-.634.2-1.204.571-1.648 1.072-.444.502-.74 1.11-.853 1.765-.138.78-.017 1.587.346 2.291.363.704.939 1.266 1.644 1.603-.12.59-.15 1.196-.086 1.796.113 1.065.565 2.067 1.287 2.854.722.787 1.685 1.32 2.738 1.52.488.092.99.1 1.485.023.447 1.017 1.275 1.835 2.311 2.299 1.037.465 2.208.538 3.296.203.548-.17 1.048-.466 1.461-.862.413-.395.728-.879.919-1.414.19-.534.249-1.106.172-1.669.577-.265 1.074-.675 1.44-1.19.366-.513.588-1.112.644-1.737.056-.625-.056-1.254-.325-1.82-.269-.565-.682-1.05-1.197-1.406z";
const CHECK = "M9.611 12.851L7.29 10.53l-.927.948 3.248 3.2 6.912-6.83-.95-.943-5.962 5.946z";

function TierBadge({ tier }: { tier?: string }) {
  if (tier === "top") return (
    <svg width="15" height="15" viewBox="0 0 22 22" fill="none">
      <path d={SEAL} fill="#F4C43B"/><path d={CHECK} fill="white"/>
    </svg>
  );
  if (tier === "normal") return (
    <svg width="15" height="15" viewBox="0 0 22 22" fill="none">
      <path d={SEAL} fill="#1D9BF0"/><path d={CHECK} fill="white"/>
    </svg>
  );
  return null;
}

export default function ProfileModal({ username, dk, onClose }: { username: string; dk: boolean; onClose: () => void }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getUserProfile(username)
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [username]);

  const pnl = profile ? parseFloat(profile.pnl) : 0;
  const winRate = profile && profile.total_bets > 0
    ? Math.round((profile.wins / profile.total_bets) * 100)
    : 0;

  const bg = dk ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const muted = dk ? "text-white/40" : "text-gray-400";
  const strong = dk ? "text-white" : "text-gray-900";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={`relative w-full max-w-sm rounded-3xl border p-5 ${bg} shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover" />
            ) : (
              <div className={`w-14 h-14 rounded-full flex items-center justify-center text-[22px] font-black ${dk ? "bg-white/10 text-white/60" : "bg-gray-100 text-gray-500"}`}>
                {username.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[16px] font-black ${strong}`}>{username}</span>
                <TierBadge tier={profile?.tier} />
              </div>
              {profile?.bio && (
                <p className={`text-[12px] mt-0.5 max-w-[180px] ${muted}`}>{profile.bio}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className={`text-[18px] font-bold ${muted} hover:opacity-60`}>✕</button>
        </div>

        {loading ? (
          <div className={`text-center py-8 text-[13px] ${muted}`}>Loading…</div>
        ) : !profile ? (
          <div className={`text-center py-8 text-[13px] ${muted}`}>User not found</div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className={`rounded-2xl px-3 py-2.5 text-center ${dk ? "bg-white/5" : "bg-gray-50"}`}>
                <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${muted}`}>Bets</p>
                <p className={`text-[18px] font-black ${strong}`}>{profile.total_bets}</p>
              </div>
              <div className={`rounded-2xl px-3 py-2.5 text-center ${dk ? "bg-white/5" : "bg-gray-50"}`}>
                <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${muted}`}>Win rate</p>
                <p className={`text-[18px] font-black ${strong}`}>{winRate}%</p>
              </div>
              <div className={`rounded-2xl px-3 py-2.5 text-center ${dk ? "bg-white/5" : "bg-gray-50"}`}>
                <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${muted}`}>PnL</p>
                <p className={`text-[18px] font-black ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toFixed(0)}
                </p>
              </div>
            </div>

            {/* Recent trades */}
            {profile.recent_trades.length > 0 && (
              <div>
                <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${muted}`}>Recent trades</p>
                <div className="space-y-1.5">
                  {profile.recent_trades.map((t, i) => {
                    const won = t.status === "resolved" && t.winner_side === t.side;
                    const lost = t.status === "resolved" && t.winner_side !== t.side;
                    return (
                      <div key={i} className={`flex items-center justify-between rounded-xl px-3 py-2 ${dk ? "bg-white/[0.03]" : "bg-gray-50"}`}>
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-black ${t.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
                            {t.side === "long" ? "▲" : "▼"}
                          </span>
                          <span className={`text-[12px] font-black ${strong}`}>{t.symbol}</span>
                          <span className={`text-[10px] ${muted}`}>{t.timeframe}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-bold ${muted}`}>${parseFloat(t.amount).toFixed(0)}</span>
                          {won && <span className="text-[10px] font-black text-emerald-400">W</span>}
                          {lost && <span className="text-[10px] font-black text-red-400">L</span>}
                          {t.status === "open" && <span className={`text-[10px] font-black ${muted}`}>open</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
