"use client";

interface HeaderSearchProps {
  dk:      boolean;
  onOpen:  () => void;
}

/**
 * Header search bar / button.
 *
 * Desktop: flexible-width bar that grows to fill available space between
 * the nav tabs and the right-side controls. No absolute positioning,
 * which prevents overlap with the trading mode toggle.
 *
 * Mobile: icon only, right-aligned (ml-auto), opens the same search modal.
 */
export default function HeaderSearch({ dk, onOpen }: HeaderSearchProps) {
  return (
    <button
      onClick={onOpen}
      className={`md:flex-1 md:max-w-[280px] md:mx-4 ml-auto md:ml-4 flex items-center gap-2 px-3 md:px-3.5 py-2 rounded-xl border text-left transition-all ${dk ? "bg-white/[0.03] border-white/10 hover:border-white/20" : "bg-gray-50 border-gray-200 hover:border-gray-300"}`}
    >
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className="shrink-0 opacity-40">
        <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.8"/>
        <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
      <span className={`hidden md:inline text-[12px] font-bold ${dk ? "text-white/25" : "text-gray-400"}`}>Drop a $ticker/CA</span>
      <span className={`hidden md:inline ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded border ${dk ? "border-white/10 text-white/20" : "border-gray-200 text-gray-400"}`}>/</span>
    </button>
  );
}
