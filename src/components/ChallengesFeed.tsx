"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Challenge = {
  id: string;
  user: string;
  symbol: string;
  direction: "long" | "short";
  amount: number;
  timeframe: string;
  ago: string;
  taken: boolean;
};

const MOCK_CHALLENGES: Challenge[] = [
  { id: "1", user: "0x7f…3a2", symbol: "WOJAK", direction: "short", amount: 500, timeframe: "24h", ago: "2m ago", taken: false },
  { id: "2", user: "degen.sol", symbol: "PEPE",  direction: "long",  amount: 100, timeframe: "48h", ago: "5m ago", taken: false },
  { id: "3", user: "0xc1…9f4", symbol: "FWOG",  direction: "short", amount: 50,  timeframe: "12h", ago: "11m ago", taken: false },
  { id: "4", user: "ape_lord",  symbol: "WIF",   direction: "short", amount: 250, timeframe: "24h", ago: "18m ago", taken: false },
  { id: "5", user: "0xb9…12c", symbol: "GIGA",  direction: "long",  amount: 200, timeframe: "4h",  ago: "31m ago", taken: false },
];

export default function ChallengesFeed() {
  const [challenges, setChallenges] = useState<Challenge[]>(MOCK_CHALLENGES);
  const [taking, setTaking] = useState<string | null>(null);

  const handleTake = (id: string) => {
    setTaking(id);
    setTimeout(() => {
      setChallenges((prev) =>
        prev.map((c) => (c.id === id ? { ...c, taken: true } : c))
      );
      setTaking(null);
    }, 800);
  };

  return (
    <div className="border-t border-white/5 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-widest text-white/25 uppercase">Open Challenges</span>
          <span className="text-[10px] font-mono bg-white/6 text-white/30 px-1.5 py-0.5 rounded-full">
            {challenges.filter((c) => !c.taken).length}
          </span>
        </div>
        <span className="text-[10px] text-white/20">Waiting for a match</span>
      </div>

      {/* Feed */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
        <AnimatePresence>
          {challenges.map((c) => {
            const isShort = c.direction === "short";
            const isTaking = taking === c.id;

            return (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: c.taken ? 0.35 : 1, x: 0 }}
                className={`flex-shrink-0 flex flex-col gap-2 border rounded-xl px-3 py-2.5 min-w-[160px] transition-colors ${
                  c.taken
                    ? "border-white/5 bg-transparent"
                    : isShort
                    ? "border-red-500/15 bg-red-500/5"
                    : "border-emerald-500/15 bg-emerald-500/5"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-bold ${isShort ? "text-red-400" : "text-emerald-400"}`}>
                      {isShort ? "▼ SHORT" : "▲ LONG"}
                    </span>
                    <span className="text-[11px] font-semibold text-white/80">${c.symbol}</span>
                  </div>
                  <span className="text-[10px] text-white/20">{c.ago}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[13px] font-mono font-bold text-white">${c.amount}</span>
                    <span className="text-[10px] text-white/30 ml-1">{c.timeframe}</span>
                  </div>
                  <span className="text-[10px] font-mono text-white/25">{c.user}</span>
                </div>

                {!c.taken ? (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleTake(c.id)}
                    disabled={isTaking}
                    className={`w-full py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-all ${
                      isShort
                        ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                        : "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                    }`}
                  >
                    {isTaking ? "Taking…" : isShort ? "Take Long" : "Take Short"}
                  </motion.button>
                ) : (
                  <span className="text-[10px] text-white/20 text-center py-1">Matched</span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}