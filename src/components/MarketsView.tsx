"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MOCK_MARKETS, CATEGORIES, PMMarket, formatVol } from "@/lib/mockMarkets";

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, positive, mini = false }: { data: number[]; positive: boolean; mini?: boolean }) {
  if (data.length < 2) return null;
  const W = 200; const H = mini ? 32 : 56;
  const min = Math.min(...data); const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H * 0.8) - H * 0.1}`
  ).join(" ");
  const color = positive ? "#10b981" : "#f87171";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Category pill ─────────────────────────────────────────────────────────────
function CatPill({ cat, dk }: { cat: string; dk: boolean }) {
  const colors: Record<string, string> = {
    BTC:        dk ? "bg-orange-500/15 text-orange-300" : "bg-orange-100 text-orange-700",
    ETH:        dk ? "bg-blue-500/15 text-blue-300"    : "bg-blue-100 text-blue-700",
    SOL:        dk ? "bg-purple-500/15 text-purple-300" : "bg-purple-100 text-purple-700",
    DeFi:       dk ? "bg-teal-500/15 text-teal-300"    : "bg-teal-100 text-teal-700",
    L2s:        dk ? "bg-indigo-500/15 text-indigo-300" : "bg-indigo-100 text-indigo-700",
    Memes:      dk ? "bg-pink-500/15 text-pink-300"    : "bg-pink-100 text-pink-700",
    XRP:        dk ? "bg-cyan-500/15 text-cyan-300"    : "bg-cyan-100 text-cyan-700",
    Regulation: dk ? "bg-red-500/15 text-red-300"      : "bg-red-100 text-red-700",
    Macro:      dk ? "bg-yellow-500/15 text-yellow-300" : "bg-yellow-100 text-yellow-700",
  };
  return (
    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wide ${colors[cat] ?? (dk ? "bg-white/8 text-white/50" : "bg-gray-100 text-gray-500")}`}>
      {cat}
    </span>
  );
}

// ── Hero Card ─────────────────────────────────────────────────────────────────
function HeroCard({ market, dk }: { market: PMMarket; dk: boolean }) {
  const yes = market.options[0];
  const no  = market.options[1];
  const border = dk ? "border-white/8" : "border-gray-200";
  const bg     = dk ? "bg-[#141414]"  : "bg-white";
  const strong = dk ? "text-white"    : "text-gray-900";
  const muted  = dk ? "text-white/35" : "text-gray-400";

  return (
    <div className={`rounded-2xl border ${border} ${bg} p-5 mb-4`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2 mb-2">
            <CatPill cat={market.category} dk={dk} />
            <span className={`text-[10px] font-bold ${muted}`}>Featured · {formatVol(market.volume)} vol</span>
          </div>
          <h2 className={`text-[20px] font-black leading-tight ${strong}`}>{market.question}</h2>
          <p className={`text-[11px] mt-1 ${muted}`}>Closes {market.closesAt}</p>
        </div>
        {/* Sparkline */}
        {market.sparkline && (
          <div className="w-32 h-14 shrink-0">
            <Sparkline data={market.sparkline} positive={yes.pct >= 50} />
          </div>
        )}
      </div>

      {/* Bars */}
      <div className="space-y-2 mb-4">
        <div>
          <div className="flex justify-between text-[11px] font-black mb-1">
            <span className="text-emerald-400">Yes</span>
            <span className="text-emerald-400">{yes.pct}%</span>
          </div>
          <div className={`h-2 rounded-full overflow-hidden ${dk ? "bg-white/6" : "bg-gray-100"}`}>
            <motion.div initial={{ width: 0 }} animate={{ width: `${yes.pct}%` }} transition={{ duration: 0.8, ease: "easeOut" }}
              className="h-full bg-emerald-500 rounded-full" />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[11px] font-black mb-1">
            <span className="text-red-400">No</span>
            <span className="text-red-400">{no.pct}%</span>
          </div>
          <div className={`h-2 rounded-full overflow-hidden ${dk ? "bg-white/6" : "bg-gray-100"}`}>
            <motion.div initial={{ width: 0 }} animate={{ width: `${no.pct}%` }} transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
              className="h-full bg-red-500 rounded-full" />
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-2">
        <button className={`flex-1 py-2.5 rounded-xl text-[13px] font-black border-2 transition-all hover:bg-emerald-500/20 ${dk ? "border-emerald-500/40 text-emerald-300" : "border-emerald-500 text-emerald-600"}`}>
          Yes {yes.pct}%
        </button>
        <button className={`flex-1 py-2.5 rounded-xl text-[13px] font-black border-2 transition-all hover:bg-red-500/20 ${dk ? "border-red-500/40 text-red-300" : "border-red-500 text-red-600"}`}>
          No {no.pct}%
        </button>
      </div>
    </div>
  );
}

// ── Binary Card ───────────────────────────────────────────────────────────────
function BinaryCard({ market, dk }: { market: PMMarket; dk: boolean }) {
  const yes = market.options[0];
  const no  = market.options[1];
  const border = dk ? "border-white/6" : "border-gray-200";
  const bg     = dk ? "bg-[#141414]"  : "bg-white";
  const strong = dk ? "text-white"    : "text-gray-900";
  const muted  = dk ? "text-white/35" : "text-gray-400";
  const barBg  = dk ? "bg-white/6"    : "bg-gray-100";

  return (
    <div className={`rounded-2xl border ${border} ${bg} p-4 flex flex-col gap-3`}>
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <CatPill cat={market.category} dk={dk} />
        </div>
        <p className={`text-[13px] font-black leading-snug ${strong}`}>{market.question}</p>
      </div>

      {/* Bars */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-emerald-400 w-6">Yes</span>
          <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${barBg}`}>
            <motion.div initial={{ width: 0 }} animate={{ width: `${yes.pct}%` }} transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-full bg-emerald-500 rounded-full" />
          </div>
          <span className="text-[10px] font-black text-emerald-400 w-7 text-right">{yes.pct}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-red-400 w-6">No</span>
          <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${barBg}`}>
            <motion.div initial={{ width: 0 }} animate={{ width: `${no.pct}%` }} transition={{ duration: 0.6, ease: "easeOut", delay: 0.05 }}
              className="h-full bg-red-500 rounded-full" />
          </div>
          <span className="text-[10px] font-black text-red-400 w-7 text-right">{no.pct}%</span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-bold ${muted}`}>{formatVol(market.volume)} · {market.closesAt}</span>
      </div>

      {/* Buttons */}
      <div className="flex gap-1.5">
        <button className={`flex-1 py-2 rounded-xl text-[11px] font-black transition-all ${dk ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20" : "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100"}`}>
          Yes
        </button>
        <button className={`flex-1 py-2 rounded-xl text-[11px] font-black transition-all ${dk ? "bg-red-500/10 border border-red-500/25 text-red-300 hover:bg-red-500/20" : "bg-red-50 border border-red-200 text-red-700 hover:bg-red-100"}`}>
          No
        </button>
      </div>
    </div>
  );
}

// ── Multi-outcome Card ────────────────────────────────────────────────────────
function MultiCard({ market, dk }: { market: PMMarket; dk: boolean }) {
  const border = dk ? "border-white/6" : "border-gray-200";
  const bg     = dk ? "bg-[#141414]"  : "bg-white";
  const strong = dk ? "text-white"    : "text-gray-900";
  const muted  = dk ? "text-white/35" : "text-gray-400";
  const barBg  = dk ? "bg-white/6"    : "bg-gray-100";
  const rowHov = dk ? "hover:bg-white/4" : "hover:bg-gray-50";

  const OPTION_COLORS = [
    "bg-blue-500",
    "bg-purple-500",
    "bg-orange-500",
    "bg-teal-500",
  ];

  return (
    <div className={`rounded-2xl border ${border} ${bg} p-4 flex flex-col gap-3`}>
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <CatPill cat={market.category} dk={dk} />
          <span className={`text-[9px] font-bold ${muted}`}>multi</span>
        </div>
        <p className={`text-[13px] font-black leading-snug ${strong}`}>{market.question}</p>
      </div>

      {/* Options */}
      <div className="space-y-1.5">
        {market.options.map((opt, i) => (
          <div key={opt.label} className={`flex items-center gap-2 px-1 py-0.5 rounded-lg transition-colors cursor-pointer ${rowHov}`}>
            <span className={`text-[10px] font-black ${strong} w-20 truncate`}>{opt.label}</span>
            <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${barBg}`}>
              <motion.div initial={{ width: 0 }} animate={{ width: `${opt.pct}%` }} transition={{ duration: 0.6, ease: "easeOut", delay: i * 0.05 }}
                className={`h-full rounded-full ${OPTION_COLORS[i % OPTION_COLORS.length]}`} />
            </div>
            <span className={`text-[10px] font-black ${muted} w-8 text-right`}>{opt.pct}%</span>
          </div>
        ))}
      </div>

      <span className={`text-[10px] font-bold ${muted}`}>{formatVol(market.volume)} · {market.closesAt}</span>
    </div>
  );
}

// ── Main MarketsView ──────────────────────────────────────────────────────────
export default function MarketsView({ dk }: { dk: boolean }) {
  const [cat, setCat] = useState<string>("All");

  const hero = MOCK_MARKETS.find(m => m.featured)!;
  const rest = MOCK_MARKETS.filter(m => !m.featured && (cat === "All" || m.category === cat));

  const muted  = dk ? "text-white/35" : "text-gray-400";
  const catActive   = dk ? "bg-white text-black" : "bg-gray-900 text-white";
  const catInactive = dk ? "text-white/40 hover:text-white/70" : "text-gray-500 hover:text-gray-800";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 md:px-5 py-4">

        {/* Hero */}
        <HeroCard market={hero} dk={dk} />

        {/* Category filter */}
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all ${cat === c ? catActive : catInactive}`}>
              {c}
            </button>
          ))}
        </div>

        {/* Grid */}
        <AnimatePresence mode="wait">
          <motion.div key={cat} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rest.length === 0 ? (
              <p className={`col-span-3 text-center py-12 text-[13px] ${muted}`}>No markets in this category yet.</p>
            ) : (
              rest.map(m => (
                <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                  {m.type === "binary"
                    ? <BinaryCard market={m} dk={dk} />
                    : <MultiCard  market={m} dk={dk} />
                  }
                </motion.div>
              ))
            )}
          </motion.div>
        </AnimatePresence>

      </div>
    </div>
  );
}
