"use client";

import { Challenge } from "@/lib/mockChallenges";

interface Props {
  challenges: Challenge[];
  dk?: boolean;
}

export default function LiveTicker({ challenges, dk = true }: Props) {
  // Duplicate for seamless loop
  const items = [...challenges, ...challenges];

  const wrapCls = dk
    ? "relative border-b border-white/5 overflow-hidden bg-white/[0.015] shrink-0"
    : "relative border-b border-gray-200 overflow-hidden bg-gray-100 shrink-0";

  const symCls   = dk ? "font-semibold text-white/80"  : "font-semibold text-gray-900";
  const totalCls = dk ? "text-white/40"                 : "text-gray-600";
  const tfCls    = dk ? "text-white/25"                 : "text-gray-500";
  const sepCls   = dk ? "text-white/10 px-2"            : "text-gray-300 px-2";
  const fadeFrom = dk ? "from-[#080808]"                : "from-gray-100";

  return (
    <div className={wrapCls}>
      <div className="flex items-center gap-0 animate-ticker whitespace-nowrap py-2">
        {items.map((c, i) => {
          const isShort = c.shortPool > c.longPool;

          return (
            <span key={`${c.id}-${i}`} className="inline-flex items-center gap-2 px-5 text-[11px] font-mono">
              <span className={isShort ? "text-red-400" : "text-emerald-400"}>
                {isShort ? "↓" : "↑"}
              </span>
              <span className={symCls}>${c.symbol}</span>
              <span className={totalCls}>
                ${(c.shortPool + c.longPool).toLocaleString()}
              </span>
              <span className={tfCls}>{c.timeframe}</span>
              <span className={`italic ${isShort ? (dk ? "text-red-400/50" : "text-red-500") : (dk ? "text-emerald-400/50" : "text-emerald-600")}`}>
                "{c.tagline}"
              </span>
              <span className={sepCls}>·</span>
            </span>
          );
        })}
      </div>

      {/* Fade edges */}
      <div className={`absolute inset-y-0 left-0 w-16 bg-gradient-to-r ${fadeFrom} to-transparent pointer-events-none`} />
      <div className={`absolute inset-y-0 right-0 w-16 bg-gradient-to-l ${fadeFrom} to-transparent pointer-events-none`} />
    </div>
  );
}
