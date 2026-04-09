"use client";

import type { TradingMode } from "@/hooks/useTradingMode";

interface TradingModeToggleProps {
  dk:           boolean;
  tradingMode:  TradingMode;
  onChange:     (mode: TradingMode) => void;
  /** Hide on mobile (md:flex). Defaults true. */
  hideOnMobile?: boolean;
}

/**
 * Compact Paper / Real toggle for the header.
 *
 * Visible for everyone (even logged out). Persists via useTradingMode hook
 * upstream. Testnet mode is intentionally not exposed in the UI but can
 * still be set programmatically.
 */
export default function TradingModeToggle({ dk, tradingMode, onChange, hideOnMobile = true }: TradingModeToggleProps) {
  const paperMode = tradingMode === "paper";
  const isReal    = tradingMode === "real";

  return (
    <div className={`${hideOnMobile ? "hidden md:flex" : "flex"} items-center rounded-lg p-0.5 border text-[10px] font-black ${dk ? "bg-white/5 border-white/10" : "bg-gray-100 border-gray-200"}`}>
      <button onClick={() => onChange("paper")}
        className={`px-2 py-1 rounded-md transition-all ${paperMode ? "bg-yellow-400 text-black" : (dk ? "text-white/30 hover:text-white/60" : "text-gray-400")}`}>
        Paper
      </button>
      <button onClick={() => onChange("real")}
        className={`px-2 py-1 rounded-md transition-all ${isReal ? "bg-emerald-500 text-white" : (dk ? "text-white/30 hover:text-white/60" : "text-gray-400")}`}>
        Real
      </button>
    </div>
  );
}
