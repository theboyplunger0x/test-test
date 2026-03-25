"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { MOCK_MARKETS, CATEGORIES, PMMarket, formatVol } from "@/lib/mockMarkets";

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (data.length < 2) return null;
  const W = 300; const H = 100;
  const min = Math.min(...data); const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H * 0.8) - H * 0.1}`
  ).join(" ");
  const color = positive ? "#10b981" : "#f87171";
  const fillPts = `0,${H} ${pts} ${W},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill="url(#sg)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Category icon avatar ───────────────────────────────────────────────────────
function CatIcon({ cat, dk }: { cat: string; dk: boolean }) {
  const colors: Record<string, string> = {
    BTC:        "bg-orange-500/20 text-orange-400",
    ETH:        "bg-blue-500/20 text-blue-400",
    SOL:        "bg-purple-500/20 text-purple-400",
    DeFi:       "bg-teal-500/20 text-teal-400",
    L2s:        "bg-indigo-500/20 text-indigo-400",
    Memes:      "bg-pink-500/20 text-pink-400",
    XRP:        "bg-cyan-500/20 text-cyan-400",
    Regulation: "bg-red-500/20 text-red-400",
    Macro:      "bg-yellow-500/20 text-yellow-400",
  };
  return (
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[14px] font-black shrink-0 ${colors[cat] ?? (dk ? "bg-white/8 text-white/50" : "bg-gray-100 text-gray-500")}`}>
      {cat[0]}
    </div>
  );
}

// ── Mock breaking news ─────────────────────────────────────────────────────────
const BREAKING_NEWS = [
  { text: "Will MicroStrategy buy more BTC before April?", pct: 78, change: "+23%", up: true },
  { text: "Will Binance face new SEC action in 2025?",     pct: 31, change: "-12%", up: false },
  { text: "Will ETH reach $5k before BTC halving cycle?",  pct: 45, change: "+8%",  up: true },
];

const TRENDING_TOPICS = [
  { label: "Bitcoin",    vol: "$2.4M" },
  { label: "Ethereum",  vol: "$1.1M" },
  { label: "Solana",    vol: "$890K" },
  { label: "DeFi",      vol: "$650K" },
  { label: "Memecoins", vol: "$420K" },
];

// ── Right panel (News + Trending) ─────────────────────────────────────────────
function RightPanel({ dk }: { dk: boolean }) {
  const border  = dk ? "border-white/6"  : "border-gray-200";
  const bg      = dk ? "bg-[#141414]"    : "bg-white";
  const strong  = dk ? "text-white"      : "text-gray-900";
  const muted   = dk ? "text-white/35"   : "text-gray-400";
  const rowHov  = dk ? "hover:bg-white/4": "hover:bg-gray-50";

  return (
    <div className="w-[280px] shrink-0 flex flex-col gap-3">
      {/* Breaking News */}
      <div className={`rounded-2xl border ${border} ${bg} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`text-[12px] font-black uppercase tracking-widest ${muted}`}>Breaking News</h3>
          <span className={`text-[12px] font-bold ${muted}`}>›</span>
        </div>
        <div className="space-y-3.5">
          {BREAKING_NEWS.map((n, i) => (
            <div key={i} className={`flex items-start gap-2.5 pb-3.5 border-b last:border-0 last:pb-0 ${border}`}>
              <span className={`text-[11px] font-black ${muted} mt-0.5 shrink-0`}>{i + 1}</span>
              <p className={`text-[12px] font-bold ${strong} leading-snug flex-1`}>{n.text}</p>
              <div className="text-right shrink-0">
                <p className={`text-[15px] font-black ${strong}`}>{n.pct}%</p>
                <p className={`text-[10px] font-black ${n.up ? "text-emerald-400" : "text-red-400"}`}>{n.change}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Trending Topics */}
      <div className={`rounded-2xl border ${border} ${bg} p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`text-[12px] font-black uppercase tracking-widest ${muted}`}>Trending</h3>
          <span className={`text-[12px] font-bold ${muted}`}>›</span>
        </div>
        <div className="space-y-0.5">
          {TRENDING_TOPICS.map((t, i) => (
            <div key={t.label} className={`flex items-center justify-between px-2 py-2 rounded-xl transition-colors cursor-pointer ${rowHov}`}>
              <div className="flex items-center gap-2.5">
                <span className={`text-[11px] font-bold ${muted} w-4`}>{i + 1}</span>
                <span className={`text-[13px] font-black ${strong}`}>{t.label}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className={`text-[11px] font-bold ${muted}`}>{t.vol} today</span>
                <span className="text-[11px]">🔥</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Hero Card ─────────────────────────────────────────────────────────────────
function HeroCard({ market, dk }: { market: PMMarket; dk: boolean }) {
  const yes    = market.options[0];
  const no     = market.options[1];
  const border = dk ? "border-white/6"  : "border-gray-200";
  const bg     = dk ? "bg-[#141414]"    : "bg-white";
  const strong = dk ? "text-white"      : "text-gray-900";
  const muted  = dk ? "text-white/35"   : "text-gray-400";
  const divCls = dk ? "border-white/6"  : "border-gray-100";

  return (
    <div className={`flex-1 rounded-2xl border ${border} ${bg} p-5 flex flex-col min-h-[300px]`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <CatIcon cat={market.category} dk={dk} />
        <div>
          <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${muted}`}>{market.category} · Crypto Predictions</p>
          <h2 className={`text-[20px] font-black leading-tight ${strong}`}>{market.question}</h2>
        </div>
      </div>

      {/* Body: options left, chart right */}
      <div className="flex gap-5 flex-1">
        {/* Options */}
        <div className="flex flex-col justify-center flex-1 divide-y divide-white/6">
          {market.options.map(opt => (
            <div key={opt.label} className={`flex items-center justify-between py-3 border-b last:border-0 ${divCls}`}>
              <div className="flex items-center gap-2">
                <span className={`text-[15px] ${opt.label === "Yes" ? "text-emerald-400" : "text-red-400"}`}>
                  {opt.label === "Yes" ? "↑" : "↓"}
                </span>
                <span className={`text-[14px] font-black ${strong}`}>{opt.label}</span>
              </div>
              <span className={`text-[28px] font-black tabular-nums ${opt.label === "Yes" ? "text-emerald-400" : "text-red-400"}`}>
                {opt.pct}%
              </span>
            </div>
          ))}

          {/* Mock comments */}
          <div className={`pt-3 space-y-1.5 border-t ${divCls}`}>
            <p className={`text-[11px] ${muted}`}><span className={`font-black ${strong}`}>degen.sol</span> — "this is def hitting 100k fr"</p>
            <p className={`text-[11px] ${muted}`}><span className={`font-black ${strong}`}>bear420</span> — "mid. macro ruins everything"</p>
          </div>
        </div>

        {/* Sparkline */}
        {market.sparkline && (
          <div className="w-44 self-stretch flex items-center">
            <div className="w-full h-28">
              <Sparkline data={market.sparkline} positive={yes.pct >= 50} />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={`flex items-center justify-between mt-4 pt-3 border-t ${divCls}`}>
        <span className={`text-[12px] font-bold ${muted}`}>{formatVol(market.volume)} Vol</span>
        <span className={`text-[12px] font-bold ${muted}`}>Closes {market.closesAt}</span>
        <div className="flex gap-1.5">
          <button className={`px-4 py-1.5 rounded-lg text-[12px] font-black border transition-all ${dk ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/15" : "border-emerald-500 text-emerald-600 hover:bg-emerald-50"}`}>
            Yes {yes.pct}%
          </button>
          <button className={`px-4 py-1.5 rounded-lg text-[12px] font-black border transition-all ${dk ? "border-red-500/30 text-red-400 hover:bg-red-500/15" : "border-red-500 text-red-600 hover:bg-red-50"}`}>
            No {no.pct}%
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Binary market card ────────────────────────────────────────────────────────
function BinaryCard({ market, dk }: { market: PMMarket; dk: boolean }) {
  const yes    = market.options[0];
  const no     = market.options[1];
  const border = dk ? "border-white/6"  : "border-gray-200";
  const bg     = dk ? "bg-[#141414]"    : "bg-white";
  const strong = dk ? "text-white"      : "text-gray-900";
  const muted  = dk ? "text-white/35"   : "text-gray-400";
  const divCls = dk ? "border-white/5"  : "border-gray-100";
  const barBg  = dk ? "bg-white/6"      : "bg-gray-100";

  return (
    <div className={`rounded-2xl border ${border} ${bg} p-4 flex flex-col gap-3`}>
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <CatIcon cat={market.category} dk={dk} />
        <p className={`text-[13px] font-black leading-snug ${strong} pt-0.5`}>{market.question}</p>
      </div>

      {/* Options */}
      <div className={`space-y-2 pt-1 border-t ${divCls}`}>
        {[yes, no].map(opt => (
          <div key={opt.label} className="flex items-center gap-2.5">
            <span className={`text-[11px] font-black w-6 shrink-0 ${opt.label === "Yes" ? "text-emerald-400" : "text-red-400"}`}>
              {opt.label === "Yes" ? "↑" : "↓"} {opt.label}
            </span>
            <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${barBg}`}>
              <motion.div
                initial={{ width: 0 }} animate={{ width: `${opt.pct}%` }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className={`h-full rounded-full ${opt.label === "Yes" ? "bg-emerald-500" : "bg-red-500"}`}
              />
            </div>
            <span className={`text-[12px] font-black tabular-nums w-9 text-right ${opt.label === "Yes" ? "text-emerald-400" : "text-red-400"}`}>
              {opt.pct}%
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className={`flex items-center justify-between pt-2 border-t ${divCls}`}>
        <span className={`text-[10px] font-bold ${muted}`}>{formatVol(market.volume)} Vol · {market.closesAt}</span>
        <span className={`text-[14px] ${muted} cursor-pointer hover:opacity-60`}>🔖</span>
      </div>

      {/* Buttons */}
      <div className="flex gap-1.5">
        <button className={`flex-1 py-2 rounded-xl text-[12px] font-black transition-all ${dk ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20" : "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100"}`}>
          Yes ↑
        </button>
        <button className={`flex-1 py-2 rounded-xl text-[12px] font-black transition-all ${dk ? "bg-red-500/10 border border-red-500/25 text-red-300 hover:bg-red-500/20" : "bg-red-50 border border-red-200 text-red-700 hover:bg-red-100"}`}>
          No ↓
        </button>
      </div>
    </div>
  );
}

// ── Multi-outcome card ────────────────────────────────────────────────────────
function MultiCard({ market, dk }: { market: PMMarket; dk: boolean }) {
  const border  = dk ? "border-white/6"  : "border-gray-200";
  const bg      = dk ? "bg-[#141414]"    : "bg-white";
  const strong  = dk ? "text-white"      : "text-gray-900";
  const muted   = dk ? "text-white/35"   : "text-gray-400";
  const divCls  = dk ? "border-white/5"  : "border-gray-100";
  const barBg   = dk ? "bg-white/6"      : "bg-gray-100";
  const rowHov  = dk ? "hover:bg-white/4": "hover:bg-gray-50";

  const COLORS = ["bg-blue-500", "bg-purple-500", "bg-orange-500", "bg-teal-500"];
  const TEXT   = ["text-blue-400", "text-purple-400", "text-orange-400", "text-teal-400"];

  return (
    <div className={`rounded-2xl border ${border} ${bg} p-4 flex flex-col gap-3`}>
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <CatIcon cat={market.category} dk={dk} />
        <div className="flex-1 pt-0.5">
          <span className={`text-[9px] font-black uppercase tracking-wide ${muted}`}>multi</span>
          <p className={`text-[13px] font-black leading-snug ${strong}`}>{market.question}</p>
        </div>
      </div>

      {/* Options */}
      <div className={`space-y-1 pt-1 border-t ${divCls}`}>
        {market.options.map((opt, i) => (
          <div key={opt.label} className={`flex items-center gap-2 px-1 py-1.5 rounded-lg transition-colors cursor-pointer ${rowHov}`}>
            <span className={`text-[12px] font-black ${strong} w-20 truncate`}>{opt.label}</span>
            <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${barBg}`}>
              <motion.div
                initial={{ width: 0 }} animate={{ width: `${opt.pct}%` }}
                transition={{ duration: 0.7, ease: "easeOut", delay: i * 0.06 }}
                className={`h-full rounded-full ${COLORS[i % COLORS.length]}`}
              />
            </div>
            <span className={`text-[11px] font-black tabular-nums w-8 text-right ${TEXT[i % TEXT.length]}`}>{opt.pct}%</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className={`flex items-center justify-between pt-2 border-t ${divCls}`}>
        <span className={`text-[10px] font-bold ${muted}`}>{formatVol(market.volume)} Vol · {market.closesAt}</span>
        <span className={`text-[14px] ${muted} cursor-pointer hover:opacity-60`}>🔖</span>
      </div>
    </div>
  );
}

// ── Main MarketsView ──────────────────────────────────────────────────────────
export default function MarketsView({ dk }: { dk: boolean }) {
  const [cat, setCat] = useState<string>("All");

  const hero = MOCK_MARKETS.find(m => m.featured)!;
  const rest = MOCK_MARKETS.filter(m => !m.featured && (cat === "All" || m.category === cat));

  const strong      = dk ? "text-white"      : "text-gray-900";
  const muted       = dk ? "text-white/35"   : "text-gray-400";
  const catActive   = dk ? "bg-white text-black" : "bg-gray-900 text-white";
  const catInactive = dk ? "text-white/40 hover:text-white/80" : "text-gray-500 hover:text-gray-800";
  const divider     = dk ? "border-white/6"  : "border-gray-200";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 md:px-5 py-5 max-w-7xl mx-auto space-y-5">

        {/* Hero row: featured market + right panel */}
        <div className="flex gap-4 items-start">
          <HeroCard market={hero} dk={dk} />
          <div className="hidden lg:block">
            <RightPanel dk={dk} />
          </div>
        </div>

        {/* All markets header */}
        <div className={`flex items-center justify-between border-b ${divider} pb-3`}>
          <h2 className={`text-[18px] font-black ${strong}`}>All markets</h2>
          <div className={`flex items-center gap-3 ${muted}`}>
            <button className="hover:opacity-60 transition-opacity">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
            </button>
            <button className="hover:opacity-60 transition-opacity">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="10" y2="18"/>
              </svg>
            </button>
            <button className="hover:opacity-60 transition-opacity">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Category filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCat(c)}
              className={`px-3.5 py-1.5 rounded-full text-[11px] font-black whitespace-nowrap transition-all ${cat === c ? catActive : catInactive}`}>
              {c}
            </button>
          ))}
        </div>

        {/* Markets grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {rest.length === 0 ? (
            <p className={`col-span-4 text-center py-12 text-[13px] ${muted}`}>No markets in this category yet.</p>
          ) : (
            rest.map((m, i) => (
              <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: i * 0.03 }}>
                {m.type === "binary"
                  ? <BinaryCard  market={m} dk={dk} />
                  : <MultiCard   market={m} dk={dk} />
                }
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
