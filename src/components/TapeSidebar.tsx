"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Challenge } from "@/lib/mockChallenges";
import { api } from "@/lib/api";

type TapeEntry = {
  uid: string; symbol: string; side: "short" | "long";
  amount: number; message: string; user: string; ts: number;
  isOpen: boolean; isOpener?: boolean;
};

export default function TapeSidebar({ challenges, onViewCoin, onViewToken, dk, tapeBorder, sidebarLabel, tapeColLabel, open, onToggle, onViewProfile, paperMode }: {
  challenges: Challenge[]; onViewCoin: (symbol: string) => void; onViewToken?: (symbol: string) => void; dk: boolean;
  tapeBorder: string; sidebarLabel: string; tapeColLabel: string; open: boolean; onToggle: () => void; paperMode?: boolean;
  onViewProfile?: (username: string) => void;
}) {
  const toEntries = (cs: Challenge[]) =>
    [...cs].reverse().slice(0, 40).map(c => ({
      uid: `init-${c.id}`,
      symbol: c.symbol,
      side: (c.longPool >= c.shortPool ? "long" : "short") as "long" | "short",
      amount: Math.round(c.longPool + c.shortPool),
      message: c.tagline,
      user: c.openerUsername ?? c.user,
      ts: Date.now() - c.openedAt * 1000,
      isOpen: c.status === "open",
      isOpener: true,
    }));

  const [entries, setEntries] = useState<TapeEntry[]>(() => toEntries(challenges));
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadPositions() {
      try {
        const recent = await api.getRecentPositions(paperMode);
        const posEntries: TapeEntry[] = recent.map(p => ({
          uid: `pos-${p.id}`,
          symbol: p.symbol,
          side: p.side,
          amount: Math.round(parseFloat(p.amount)),
          message: p.message ?? "",
          user: p.username,
          ts: new Date(p.placed_at).getTime(),
          isOpen: p.status === "open",
          isOpener: p.is_opener,
        }));
        const marketEntries = toEntries(challenges);
        const all = [...posEntries, ...marketEntries];
        const seen = new Set<string>();
        const deduped = all.filter(e => { if (seen.has(e.uid)) return false; seen.add(e.uid); return true; });
        setEntries(deduped.sort((a, b) => b.ts - a.ts).slice(0, 60));
      } catch {}
    }
    loadPositions();
    const iv = setInterval(loadPositions, 30_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    setEntries(toEntries(challenges));
  }, [challenges]);

  const rowBg  = dk ? "hover:bg-white/4" : "hover:bg-gray-100";
  const divider = dk ? "border-white/4" : "border-gray-200";
  const amtTxt = dk ? "text-white/50" : "text-gray-800 font-black";
  const msgTxt = dk ? "text-white/30" : "text-gray-700";
  const userTxt = dk ? "text-white/20" : "text-gray-600";

  if (entries.length === 0) return null;

  return (
    <div style={{ width: open ? "250px" : "32px", minWidth: open ? "250px" : "32px" }} className={`shrink-0 border-l ${tapeBorder} flex flex-col overflow-hidden transition-all duration-200`}>
      <div className="px-3 py-2.5 shrink-0 flex items-center justify-between">
        {open && (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <p className={`text-[9px] font-black tracking-widest uppercase ${sidebarLabel}`}>Tape</p>
          </div>
        )}
        <button onClick={onToggle}
          className={`${open ? "ml-auto" : "mx-auto"} flex items-center justify-center w-6 h-6 rounded-lg text-[12px] font-black transition-all ${dk ? "bg-white/6 hover:bg-white/12 text-white/40 hover:text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-700"}`}>
          {open ? "›" : "‹"}
        </button>
      </div>
      {!open && (
        <button onClick={onToggle} className={`mx-auto mt-4 flex flex-col items-center gap-1 ${dk ? "text-white/20 hover:text-white/40" : "text-gray-300 hover:text-gray-500"} transition-colors`}>
          {"TAPE".split("").map((c, i) => (
            <span key={i} className="text-[8px] font-black leading-none">{c}</span>
          ))}
        </button>
      )}

      {open && (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <AnimatePresence initial={false}>
            {entries.map(e => (
              <motion.div key={e.uid} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
                className={`px-4 py-3 border-b ${divider} ${rowBg} transition-colors cursor-pointer`}
                onClick={() => onViewCoin(e.symbol)}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[12px] font-black ${e.side === "long" ? "text-emerald-400" : "text-red-400"}`}>{e.side === "long" ? "▲" : "▼"}</span>
                  <button
                    onClick={ev => { ev.stopPropagation(); onViewToken?.(e.symbol); }}
                    className={`text-[13px] font-black ${dk ? "text-white" : "text-gray-900"} ${onViewToken ? "hover:opacity-60 transition-opacity" : ""}`}
                  >${e.symbol}</button>
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ml-0.5 ${
                    e.isOpen
                      ? dk ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                      : dk ? "bg-white/8 text-white/25"           : "bg-gray-100 text-gray-400"
                  }`}>{e.isOpen ? "open" : "closed"}</span>
                  <span className={`text-[12px] font-bold ml-auto ${amtTxt}`}>${e.amount}</span>
                </div>
                {e.message && (
                  <div className="flex items-center gap-2">
                    <p className={`text-[11px] italic line-clamp-2 leading-snug flex-1 ${e.isOpener ? (dk ? "text-yellow-400/70" : "text-yellow-600") : msgTxt}`}>&ldquo;{e.message}&rdquo;</p>
                    <span
                      className={`text-[10px] font-bold shrink-0 ${userTxt} ${onViewProfile ? "cursor-pointer hover:opacity-60 transition-opacity" : ""}`}
                      onClick={(ev) => { ev.stopPropagation(); if (onViewProfile && e.user) onViewProfile(e.user); }}
                    >{e.user}</span>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
