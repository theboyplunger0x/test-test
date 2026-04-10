"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Challenge, formatAgo, formatPrice } from "@/lib/mockChallenges";
import { api } from "@/lib/api";

const QUICK_AMOUNTS = [10, 25, 50, 100];
const FEE = 0.05;

function multiplier(myPool: number, otherPool: number): number {
  if (myPool === 0) return 0;
  return 1 + (otherPool * (1 - FEE)) / myPool;
}

function formatMsLeft(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (ms < 60_000)          return `${s}s`;
  if (ms < 60 * 60_000)     return `${m}m`;
  if (d > 0)                return `${d}d`;
  return `${h}h`;
}

export default function ChallengeCard({ challenge: c, index, onAdd, onViewCoin, onViewProfile, dk, livePrice, paperMode, shaking }: {
  challenge: Challenge;
  index: number;
  onAdd: (id: string, side: "short" | "long", amount: number) => Promise<string | null>;
  onViewCoin: () => void;
  onViewProfile: (username: string) => void;
  dk: boolean;
  livePrice?: number;
  paperMode?: boolean;
  shaking?: boolean;
}) {
  const [activeSide, setActiveSide] = useState<"short" | "long" | null>(null);
  const [customAmt, setCustomAmt]   = useState("");
  const [betLoading, setBetLoading] = useState(false);
  const [betError, setBetError]     = useState("");

  // Rotating messages
  type CardMsg = { text: string; user: string; avatar?: string; isOpener: boolean };
  const [msgs, setMsgs]     = useState<CardMsg[]>(() =>
    c.tagline ? [{ text: c.tagline, user: c.openerUsername ?? c.user, avatar: c.openerAvatar, isOpener: true }] : []
  );
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    function load() {
      api.getMarketPositions(c.id).then((positions: any[]) => {
        const betMsgs: CardMsg[] = positions
          .filter(p => p.message)
          .map(p => ({ text: p.message, user: p.username ?? "", avatar: p.avatar_url ?? undefined, isOpener: p.is_opener ?? false }));
        const openerMsg: CardMsg[] = c.tagline
          ? [{ text: c.tagline, user: c.openerUsername ?? c.user, avatar: c.openerAvatar, isOpener: true }]
          : [];
        const seen = new Set<string>();
        const all = [...openerMsg, ...betMsgs].filter(m => { if (seen.has(m.text)) return false; seen.add(m.text); return true; });
        setMsgs(all);
      }).catch(() => {});
    }
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [c.id]);

  useEffect(() => {
    if (msgs.length <= 1) return;
    const iv = setInterval(() => setMsgIdx(i => (i + 1) % msgs.length), 3000);
    return () => clearInterval(iv);
  }, [msgs.length]);

  const currentMsg = msgs[msgIdx] ?? null;
  const [timeLeft, setTimeLeft]     = useState(() =>
    c.closesAt ? formatMsLeft(Math.max(0, c.closesAt - Date.now())) : c.expiresIn
  );

  useEffect(() => {
    if (!c.closesAt) return;
    let iv: ReturnType<typeof setInterval>;
    function tick() {
      const ms = Math.max(0, c.closesAt! - Date.now());
      setTimeLeft(formatMsLeft(ms));
      clearInterval(iv);
      const next = ms < 60_000 ? 1_000 : 60_000;
      iv = setInterval(tick, next);
    }
    tick();
    return () => clearInterval(iv);
  }, [c.closesAt]);

  const total      = c.shortPool + c.longPool;
  const shortPct   = total > 0 ? (c.shortPool / total) * 100 : 50;
  const longPct    = 100 - shortPct;
  const shortMult  = multiplier(c.shortPool, c.longPool);
  const longMult   = multiplier(c.longPool, c.shortPool);
  const shortIsJuicy = c.longPool > c.shortPool * 2;
  const longIsJuicy  = c.shortPool > c.longPool * 2;

  const handleQuick = async (amount: number) => {
    if (!activeSide) return;
    setCustomAmt("");
    setBetLoading(true);
    setBetError("");
    const err = await onAdd(c.id, activeSide, amount);
    setBetLoading(false);
    if (err) { setBetError(err); }
    else { setActiveSide(null); setCustomAmt(""); }
  };

  const handleCustom = async () => {
    const amt = parseFloat(customAmt);
    if (!activeSide || !amt || amt <= 0) return;
    setBetLoading(true);
    setBetError("");
    const err = await onAdd(c.id, activeSide, amt);
    setBetLoading(false);
    if (err) { setBetError(err); }
    else { setActiveSide(null); setCustomAmt(""); }
  };

  const card      = dk ? "border-white/8 bg-white/[0.03] hover:border-white/14"   : "border-gray-200 bg-white hover:border-gray-300 shadow-sm";
  const symBtn    = dk ? "text-white hover:text-white/60"                          : "text-gray-900 hover:text-gray-500";
  const chainPill = (chain: string) => {
    if (chain === "SOL")  return dk ? "text-purple-300 bg-purple-500/20" : "text-purple-700 bg-purple-100";
    if (chain === "BASE") return dk ? "text-blue-300 bg-blue-500/20"     : "text-blue-700 bg-blue-100";
    if (chain === "BSC")  return dk ? "text-yellow-300 bg-yellow-500/20" : "text-yellow-700 bg-yellow-100";
    return dk ? "text-orange-300 bg-orange-500/20" : "text-orange-700 bg-orange-100";
  };
  const priceTxt   = dk ? "text-white/30"  : "text-gray-400";
  const tfTxt      = dk ? "text-white/50"  : "text-gray-500";
  const expTxt     = dk ? "text-white/25"  : "text-gray-400";
  const poolBox    = dk ? "bg-white/4"     : "bg-gray-50";
  const multTxt    = dk ? "text-white/35"  : "text-gray-400";
  const metaTxt    = dk ? "text-white/25"  : "text-gray-400";
  const cancelBtn  = dk ? "text-white/25 hover:text-white/50" : "text-gray-400 hover:text-gray-600";
  const amtIdle    = dk ? "bg-white/6 text-white/50 hover:bg-white/12 hover:text-white" : "bg-blue-50 text-blue-600 hover:bg-blue-100";
  const inputCls   = dk ? "bg-white/6 text-white placeholder:text-white/20 focus:bg-white/10"
                        : "bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-300 focus:border-blue-300";
  const addBtnCls  = (side: "short" | "long") => side === "short"
    ? dk ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-50 text-red-600 hover:bg-red-100"
    : dk ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100";
  const sideLabelCls = (side: "short" | "long") => side === "short"
    ? dk ? "text-red-400" : "text-red-600"
    : dk ? "text-emerald-400" : "text-emerald-600";

  const isResolved  = c.status === "resolved";
  const isCancelled = c.status === "cancelled";
  const isDone      = isResolved || isCancelled;

  const priceChange = isResolved && c.exitPrice && c.entryPrice
    ? ((c.exitPrice - c.entryPrice) / c.entryPrice) * 100
    : null;

  const resolvedCard = c.winnerSide === "long"
    ? dk ? "border-emerald-500/30 bg-emerald-500/5" : "border-emerald-300 bg-emerald-50"
    : dk ? "border-red-500/30 bg-red-500/5" : "border-red-300 bg-red-50";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={shaking ? { x: [0, -6, 6, -4, 4, -2, 2, 0], opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
      transition={shaking ? { duration: 0.5, ease: "easeOut" } : { delay: index * 0.03 }}
      className={`flex flex-col gap-3 rounded-2xl border-2 transition-all p-4 ${isDone ? resolvedCard : card}`}>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <button onClick={onViewCoin} className={`text-[18px] font-black transition-colors leading-none ${symBtn}`}>
              ${c.symbol}
            </button>
            {isResolved && (
              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                c.winnerSide === "long"
                  ? dk ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-700"
                  : dk ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-700"
              }`}>
                {c.winnerSide === "long" ? "LONG WON" : "SHORT WON"}
              </span>
            )}
            {isCancelled && (
              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${dk ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-500"}`}>
                CANCELLED
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${chainPill(c.chain)}`}>{c.chain}</span>
            <span className={`text-[10px] font-mono ${priceTxt}`}>@ ${formatPrice(c.entryPrice)}</span>
            {!isDone && livePrice && (() => {
              const pct = ((livePrice - c.entryPrice) / c.entryPrice) * 100;
              const up = pct >= 0;
              return (
                <span className={`text-[10px] font-mono font-bold ${up ? (dk ? "text-emerald-400" : "text-emerald-600") : (dk ? "text-red-400" : "text-red-600")}`}>
                  {up ? "▲" : "▼"} ${formatPrice(livePrice)} ({up ? "+" : ""}{pct.toFixed(2)}%)
                </span>
              );
            })()}
            {isResolved && c.exitPrice && (
              <>
                <span className={`text-[10px] ${priceTxt}`}>→</span>
                <span className={`text-[10px] font-mono font-bold ${
                  priceChange !== null && priceChange >= 0
                    ? dk ? "text-emerald-400" : "text-emerald-600"
                    : dk ? "text-red-400" : "text-red-600"
                }`}>
                  ${formatPrice(c.exitPrice)}
                  {priceChange !== null && ` (${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}%)`}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="text-right">
          <span className={`text-[12px] font-bold ${tfTxt}`}>{c.timeframe}</span>
          <p className={`text-[10px] mt-0.5 tabular-nums ${expTxt}`}>
            {isDone ? "closed" : `${timeLeft} left`}
          </p>
        </div>
      </div>

      {currentMsg && (
        <div className="flex items-start gap-2 min-h-[22px]">
          {currentMsg.avatar ? (
            <img src={currentMsg.avatar} alt="" className="w-5 h-5 rounded-full object-cover shrink-0 mt-0.5" />
          ) : (
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black shrink-0 mt-0.5 ${
              currentMsg.isOpener
                ? dk ? "bg-yellow-500/20 text-yellow-400" : "bg-yellow-100 text-yellow-600"
                : dk ? "bg-white/8 text-white/40" : "bg-gray-100 text-gray-500"
            }`}>
              {currentMsg.user.charAt(0).toUpperCase()}
            </span>
          )}
          <AnimatePresence mode="wait">
            <motion.p
              key={msgIdx}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3 }}
              className={`text-[12px] leading-snug font-bold ${
                currentMsg.isOpener
                  ? dk ? "text-yellow-400/80" : "text-yellow-600"
                  : dk ? "text-white/60" : "text-gray-700"
              }`}
            >
              &ldquo;{currentMsg.text}&rdquo;
              {!currentMsg.isOpener && (
                <span className={`not-italic font-normal ml-1.5 text-[10px] ${dk ? "text-white/25" : "text-gray-400"}`}>— {currentMsg.user}</span>
              )}
            </motion.p>
          </AnimatePresence>
        </div>
      )}

      <div className={`rounded-xl p-3 space-y-2.5 ${poolBox}`}>
        <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
          <motion.div animate={{ width: `${shortPct}%` }} transition={{ type: "spring", stiffness: 180, damping: 22 }}
            className={`h-full rounded-l-full ${isResolved && c.winnerSide === "short" ? "bg-red-500" : isResolved ? "bg-red-500/30" : "bg-red-500"}`} />
          <motion.div animate={{ width: `${longPct}%` }}  transition={{ type: "spring", stiffness: 180, damping: 22 }}
            className={`h-full rounded-r-full ${isResolved && c.winnerSide === "long" ? "bg-emerald-500" : isResolved ? "bg-emerald-500/30" : "bg-emerald-500"}`} />
        </div>
        <div className="flex justify-between items-end">
          <div className={isResolved && c.winnerSide === "long" ? "opacity-40" : ""}>
            <div className="flex items-center gap-1">
              <span className={`text-[11px] font-black ${isResolved && c.winnerSide === "short" ? "text-red-400" : "text-red-400"}`}>▼ SHORT</span>
              {!isDone && shortIsJuicy && <span className="text-[9px] font-bold text-yellow-500 bg-yellow-400/15 px-1.5 rounded-full">juicy</span>}
              {isResolved && c.winnerSide === "short" && <span className="text-[9px] font-bold text-red-400 bg-red-500/15 px-1.5 rounded-full">winner</span>}
            </div>
            <span className={`text-[16px] font-black ${dk ? "text-white" : "text-gray-900"}`}>${c.shortPool >= 1000 ? `${(c.shortPool/1000).toFixed(1)}k` : c.shortPool}</span>
            {!isDone && <p className={`text-[10px] font-bold ${multTxt}`}>→ {shortMult.toFixed(2)}x if right</p>}
            {isResolved && c.winnerSide === "short" && <p className={`text-[10px] font-bold ${dk ? "text-emerald-400" : "text-emerald-600"}`}>{shortMult.toFixed(2)}x payout</p>}
          </div>
          <div className={`text-right ${isResolved && c.winnerSide === "short" ? "opacity-40" : ""}`}>
            <div className="flex items-center gap-1 justify-end">
              {!isDone && longIsJuicy && <span className="text-[9px] font-bold text-yellow-500 bg-yellow-400/15 px-1.5 rounded-full">juicy</span>}
              {isResolved && c.winnerSide === "long" && <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/15 px-1.5 rounded-full">winner</span>}
              <span className="text-[11px] font-black text-emerald-400">LONG ▲</span>
            </div>
            <span className={`text-[16px] font-black ${dk ? "text-white" : "text-gray-900"}`}>${c.longPool >= 1000 ? `${(c.longPool/1000).toFixed(1)}k` : c.longPool}</span>
            {!isDone && <p className={`text-[10px] font-bold ${multTxt}`}>{longMult.toFixed(2)}x if right ←</p>}
            {isResolved && c.winnerSide === "long" && <p className={`text-[10px] font-bold ${dk ? "text-emerald-400" : "text-emerald-600"}`}>{longMult.toFixed(2)}x payout</p>}
          </div>
        </div>
      </div>

      <div className={`flex justify-between text-[10px] font-bold ${metaTxt}`}>
        <button
          onClick={(e) => { e.stopPropagation(); if (c.openerUsername) onViewProfile(c.openerUsername); }}
          className={`flex items-center gap-1.5 hover:opacity-70 transition-opacity ${c.openerUsername ? "cursor-pointer" : "cursor-default"}`}
        >
          {c.openerAvatar ? (
            <img src={c.openerAvatar} alt="" className="w-4 h-4 rounded-full object-cover" />
          ) : (
            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black ${dk ? "bg-white/10 text-white/50" : "bg-gray-200 text-gray-500"}`}>
              {(c.openerUsername ?? c.user).charAt(0).toUpperCase()}
            </span>
          )}
          <span>{c.user}</span>
        </button>
        <span>{formatAgo(c.openedAt)}</span>
      </div>

      {!isDone && (
        <AnimatePresence mode="wait">
          {activeSide === null ? (
            <motion.div key="btns" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1.5">
              {paperMode && (
                <div className="flex items-center gap-1.5 px-0.5">
                  <span className="text-[10px] font-black text-yellow-500 bg-yellow-400/15 px-2 py-0.5 rounded-full">PAPER</span>
                  <span className={`text-[10px] font-bold ${dk ? "text-white/25" : "text-gray-400"}`}>simulated bet — no real money</span>
                </div>
              )}
              <div className="flex gap-2">
                <motion.button whileTap={{ scale: 0.94 }} onClick={() => { setActiveSide("short"); setBetError(""); }}
                  className={`flex-1 py-2.5 rounded-xl text-[12px] font-black transition-all border ${
                    dk ? "bg-red-500/15 text-red-400 hover:bg-red-500/25 border-red-500/20"
                       : "bg-red-50 text-red-600 hover:bg-red-100 border-red-200"
                  }`}>▼ Short</motion.button>
                <motion.button whileTap={{ scale: 0.94 }} onClick={() => { setActiveSide("long"); setBetError(""); }}
                  className={`flex-1 py-2.5 rounded-xl text-[12px] font-black transition-all border ${
                    dk ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border-emerald-500/20"
                       : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-200"
                  }`}>Long ▲</motion.button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="picker" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[12px] font-black ${sideLabelCls(activeSide)}`}>
                    {activeSide === "short" ? "▼ Short" : "Long ▲"} · {activeSide === "short" ? shortMult.toFixed(2) : longMult.toFixed(2)}x
                  </span>
                  {paperMode && <span className="text-[9px] font-black text-yellow-500 bg-yellow-400/15 px-1.5 py-0.5 rounded-full">PAPER</span>}
                </div>
                <button onClick={() => { setActiveSide(null); setCustomAmt(""); setBetError(""); }} className={`text-[11px] font-bold ${cancelBtn}`}>✕</button>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {QUICK_AMOUNTS.map(a => (
                  <button key={a} onClick={() => handleQuick(a)} disabled={betLoading}
                    className={`py-2 rounded-xl text-[11px] font-black transition-all disabled:opacity-50 ${amtIdle}`}>${a}</button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>$</span>
                  <input autoFocus type="number" placeholder="custom" value={customAmt}
                    onChange={e => setCustomAmt(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleCustom()}
                    className={`w-full text-[12px] font-bold pl-6 pr-3 py-2 rounded-xl outline-none ${inputCls}`} />
                </div>
                <button onClick={handleCustom} disabled={betLoading}
                  className={`px-4 py-2 rounded-xl text-[12px] font-black transition-all disabled:opacity-50 ${addBtnCls(activeSide)}`}>
                  {betLoading ? "…" : "Add"}
                </button>
              </div>
              {betError && (
                <p className={`text-[11px] font-bold px-2 py-1.5 rounded-lg ${dk ? "text-red-400 bg-red-500/10" : "text-red-600 bg-red-50"}`}>
                  {betError}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {isCancelled && (
        <p className={`text-[11px] font-bold text-center py-1 ${dk ? "text-white/30" : "text-gray-400"}`}>
          Market cancelled — all positions refunded
        </p>
      )}
    </motion.div>
  );
}
