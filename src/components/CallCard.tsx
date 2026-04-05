"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export type Call = {
  id: string;
  side: "long" | "short";
  amount: string;
  message: string | null;
  placed_at: string;
  is_paper: boolean;
  username: string;
  avatar_url: string | null;
  tier: string;
  symbol: string;
  chain: string;
  timeframe: string;
  status: string;
  is_opener: boolean;
  // optional — present on symbol-level queries
  market_id?: string;
  winner_side?: "long" | "short" | null;
  closes_at?: string;
};

const QUICK_AMOUNTS = [10, 25, 50, 100];

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function CallCard({
  call,
  dk,
  onFade,
  onViewProfile,
  onViewToken,
  index = 0,
}: {
  call: Call;
  dk: boolean;
  onFade?: (call: Call, side: "long" | "short", amount: number) => Promise<string | null>;
  onViewProfile?: (username: string) => void;
  onViewToken?: (symbol: string, chain: string) => void;
  index?: number;
}) {
  const [fadeOpen, setFadeOpen] = useState(false);
  const [fadeLoading, setFadeLoading] = useState(false);
  const [fadeError, setFadeError] = useState("");
  const [customAmt, setCustomAmt] = useState("");

  const fadeSide: "long" | "short" = call.side === "long" ? "short" : "long";
  const amt = parseFloat(call.amount);
  const isResolved = call.status === "resolved";
  const won = isResolved && call.winner_side === call.side;
  const lost = isResolved && call.winner_side && call.winner_side !== call.side;

  const sideColor = call.side === "long"
    ? dk ? "text-emerald-400" : "text-emerald-600"
    : dk ? "text-red-400" : "text-red-600";

  const fadeSideColor = fadeSide === "long"
    ? dk ? "text-emerald-400" : "text-emerald-600"
    : dk ? "text-red-400" : "text-red-600";

  const fadeBg = fadeSide === "long"
    ? dk ? "bg-emerald-500/15 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/25"
         : "bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100"
    : dk ? "bg-red-500/15 border-red-500/20 text-red-400 hover:bg-red-500/25"
         : "bg-red-50 border-red-200 text-red-600 hover:bg-red-100";

  const cardBg = isResolved
    ? won
      ? dk ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "border-emerald-200 bg-emerald-50/50"
      : lost
        ? dk ? "border-red-500/20 bg-red-500/[0.03]" : "border-red-200 bg-red-50/50"
        : dk ? "border-white/6 bg-white/[0.02]" : "border-gray-200 bg-gray-50"
    : dk ? "border-white/8 bg-white/[0.03] hover:border-white/14" : "border-gray-200 bg-white hover:border-gray-300 shadow-sm";

  const chainPill = (chain: string) => {
    const c = chain.toUpperCase();
    if (c === "SOL") return dk ? "text-purple-300 bg-purple-500/20" : "text-purple-700 bg-purple-100";
    if (c === "BASE") return dk ? "text-blue-300 bg-blue-500/20" : "text-blue-700 bg-blue-100";
    if (c === "ETH") return dk ? "text-orange-300 bg-orange-500/20" : "text-orange-700 bg-orange-100";
    return dk ? "text-gray-300 bg-gray-500/20" : "text-gray-700 bg-gray-100";
  };

  async function handleFade(amount: number) {
    if (!onFade) return;
    setFadeLoading(true);
    setFadeError("");
    const err = await onFade(call, fadeSide, amount);
    setFadeLoading(false);
    if (err) setFadeError(err);
    else { setFadeOpen(false); setCustomAmt(""); }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
      className={`rounded-2xl border-2 p-4 transition-all h-full flex flex-col ${cardBg}`}
    >
      {/* Header: avatar + username + opener + time */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onViewProfile?.(call.username)}
          className="shrink-0"
        >
          {call.avatar_url ? (
            <img src={call.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black ${dk ? "bg-white/10 text-white/50" : "bg-gray-200 text-gray-500"}`}>
              {call.username.charAt(0).toUpperCase()}
            </span>
          )}
        </button>
        <button
          onClick={() => onViewProfile?.(call.username)}
          className={`text-[13px] font-black ${dk ? "text-white hover:text-white/70" : "text-gray-900 hover:text-gray-600"} transition-colors`}
        >
          {call.username}
        </button>
        {call.is_opener && (
          <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${dk ? "bg-yellow-500/20 text-yellow-400" : "bg-yellow-100 text-yellow-600"}`}>
            OPENER
          </span>
        )}
        {isResolved && won && (
          <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${dk ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"}`}>
            WON
          </span>
        )}
        {isResolved && lost && (
          <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${dk ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-700"}`}>
            LOST
          </span>
        )}
        <span className={`text-[10px] ${dk ? "text-white/25" : "text-gray-400"} ml-auto`}>{timeAgo(call.placed_at)}</span>
      </div>

      {/* Message + side badge */}
      {call.message ? (
        <div className="flex items-start gap-2 mt-2.5">
          <p className={`flex-1 text-[15px] font-bold leading-relaxed ${dk ? "text-white/90" : "text-gray-900"}`}>
            &ldquo;{call.message}&rdquo;
          </p>
          <span className={`text-[11px] font-black uppercase shrink-0 mt-1 ${sideColor}`}>
            {call.side === "long" ? "▲ LONG" : "▼ SHORT"}
          </span>
        </div>
      ) : (
        <div className="mt-2">
          <span className={`text-[11px] font-black uppercase ${sideColor}`}>
            {call.side === "long" ? "▲ LONG" : "▼ SHORT"}
          </span>
        </div>
      )}

      {/* Token + chain + timeframe + amount */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <button
          onClick={() => onViewToken?.(call.symbol, call.chain)}
          className={`text-[12px] font-black ${dk ? "text-white/70 hover:text-white" : "text-gray-700 hover:text-gray-900"} transition-colors`}
        >
          ${call.symbol}
        </button>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${chainPill(call.chain)}`}>{call.chain.toUpperCase()}</span>
        <span className={`text-[10px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>{call.timeframe}</span>
        <span className={`text-[13px] font-black tabular-nums ml-auto ${dk ? "text-white" : "text-gray-900"}`}>
          ${amt >= 1000 ? `${(amt / 1000).toFixed(1)}k` : amt.toFixed(0)}
        </span>
        {call.is_paper && (
          <span className="text-[8px] font-black text-yellow-500">PAPER</span>
        )}
      </div>

      <div className="flex-1" />
      {/* Fade CTA */}
      {!isResolved && onFade && (
        <AnimatePresence mode="wait">
          {!fadeOpen ? (
            <motion.button
              key="fade-btn"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setFadeOpen(true)}
              className={`mt-3 w-full py-2 rounded-xl text-[12px] font-black border transition-all ${fadeBg}`}
            >
              {fadeSide === "long" ? "Go Long ▲" : "Go Short ▼"}
            </motion.button>
          ) : (
            <motion.div
              key="fade-picker"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-3 space-y-2"
            >
              <div className="flex justify-between items-center">
                <span className={`text-[12px] font-black ${fadeSideColor}`}>
                  {fadeSide === "long" ? "Go Long ▲" : "Go Short ▼"}
                </span>
                <button onClick={() => { setFadeOpen(false); setCustomAmt(""); setFadeError(""); }}
                  className={`text-[11px] font-bold ${dk ? "text-white/25 hover:text-white/50" : "text-gray-400 hover:text-gray-600"}`}>✕</button>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {QUICK_AMOUNTS.map(a => (
                  <button key={a} onClick={() => handleFade(a)} disabled={fadeLoading}
                    className={`py-2 rounded-xl text-[11px] font-black transition-all disabled:opacity-50 ${dk ? "bg-white/6 text-white/50 hover:bg-white/12 hover:text-white" : "bg-blue-50 text-blue-600 hover:bg-blue-100"}`}>
                    ${a}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>$</span>
                  <input
                    autoFocus
                    type="number"
                    placeholder="custom"
                    value={customAmt}
                    onChange={e => setCustomAmt(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleFade(parseFloat(customAmt))}
                    className={`w-full text-[12px] font-bold pl-6 pr-3 py-2 rounded-xl outline-none ${dk ? "bg-white/6 text-white placeholder:text-white/20 focus:bg-white/10" : "bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-300 focus:border-blue-300"}`}
                  />
                </div>
                <button onClick={() => handleFade(parseFloat(customAmt))} disabled={fadeLoading}
                  className={`px-4 py-2 rounded-xl text-[12px] font-black transition-all disabled:opacity-50 border ${fadeBg}`}>
                  {fadeLoading ? "…" : "Fade"}
                </button>
              </div>
              {fadeError && (
                <p className={`text-[11px] font-bold px-2 py-1.5 rounded-lg ${dk ? "text-red-400 bg-red-500/10" : "text-red-600 bg-red-50"}`}>
                  {fadeError}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </motion.div>
  );
}
