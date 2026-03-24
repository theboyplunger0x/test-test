"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Challenge, formatAgo, formatPrice } from "@/lib/mockChallenges";

interface Props {
  challenges: Challenge[];
  onAdd: (id: string, side: "short" | "long", amount: number) => void;
  onViewCoin: (symbol: string) => void;
}

// Simulated incoming activity feed entries
type Activity = {
  uid: string;
  type: "new" | "join";
  challenge: Challenge;
  side?: "short" | "long";
  amount?: number;
  user: string;
  ts: number;
};

export default function LiveView({ challenges, onAdd, onViewCoin }: Props) {
  const [activity, setActivity] = useState<Activity[]>(() =>
    [...challenges].reverse().map((c) => ({
      uid: `init-${c.id}`,
      type: "new" as const,
      challenge: c,
      user: c.openerUsername ?? c.user,
      ts: Date.now() - c.openedAt * 1000,
    }))
  );

  // Update activity when new challenges come in
  useEffect(() => {
    setActivity(
      [...challenges].reverse().map((c) => ({
        uid: `init-${c.id}`,
        type: "new" as const,
        challenge: c,
        user: c.openerUsername ?? c.user,
        ts: Date.now() - c.openedAt * 1000,
      }))
    );
  }, [challenges]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
      <AnimatePresence initial={false}>
        {activity.map((a) => {
          const isShort = a.type === "new"
            ? a.challenge.shortPool >= a.challenge.longPool
            : a.side === "short";
          const total = a.challenge.shortPool + a.challenge.longPool;

          return (
            <motion.div
              key={a.uid}
              layout
              initial={{ opacity: 0, x: -12, height: 0 }}
              animate={{ opacity: 1, x: 0, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-white/[0.03] transition-colors group cursor-default border border-transparent hover:border-white/5"
            >
              {/* Direction */}
              <span className={`text-[13px] w-4 shrink-0 ${isShort ? "text-red-400" : "text-emerald-400"}`}>
                {isShort ? "↓" : "↑"}
              </span>

              {/* Type badge */}
              <span className={`text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded shrink-0 ${
                a.type === "new"
                  ? "bg-white/8 text-white/40"
                  : isShort
                  ? "bg-red-500/10 text-red-400/70"
                  : "bg-emerald-500/10 text-emerald-400/70"
              }`}>
                {a.type === "new" ? "new" : "join"}
              </span>

              {/* Coin */}
              <span
                className="text-[13px] font-bold text-white/90 w-20 shrink-0 cursor-pointer hover:text-white/60 transition-colors"
                onClick={() => onViewCoin(a.challenge.symbol)}
              >
                ${a.challenge.symbol}
              </span>

              {/* Amount */}
              <span className="text-[13px] font-mono text-white/60 w-16 shrink-0">
                ${a.type === "new" ? total.toLocaleString() : a.amount}
              </span>

              {/* Timeframe */}
              <span className="text-[11px] font-mono text-white/25 w-8 shrink-0">
                {a.challenge.timeframe}
              </span>

              {/* Tagline */}
              <span className={`text-[11px] italic flex-1 truncate ${isShort ? "text-red-400/40" : "text-emerald-400/40"}`}>
                "{a.challenge.tagline}"
              </span>

              {/* User + time */}
              <span className="text-[10px] font-mono text-white/20 shrink-0">{a.user}</span>
              <span className="text-[10px] font-mono text-white/15 shrink-0 w-14 text-right">
                {formatAgo(Math.floor((Date.now() - a.ts) / 1000) || 1)}
              </span>

              {/* Quick action - appears on hover */}
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={() => onAdd(a.challenge.id, "short", 25)}
                  className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-bold"
                >
                  ↓
                </button>
                <button
                  onClick={() => onAdd(a.challenge.id, "long", 25)}
                  className="text-[10px] px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors font-bold"
                >
                  ↑
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
