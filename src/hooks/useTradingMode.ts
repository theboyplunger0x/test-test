import { useState, useEffect } from "react";

export type TradingMode = "paper" | "real" | "testnet";

const STORAGE_KEY = "fud_mode";

/**
 * Global trading mode (paper / real / testnet) persisted in localStorage.
 *
 * Returns the current mode, setter, and boolean helpers.
 */
export function useTradingMode() {
  const [tradingMode, setTradingMode] = useState<TradingMode>(() => {
    if (typeof window === "undefined") return "paper";
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "real" || saved === "testnet" || saved === "paper") return saved;
    return "paper";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, tradingMode);
  }, [tradingMode]);

  return {
    tradingMode,
    setTradingMode,
    paperMode: tradingMode === "paper",
    isTestnet: tradingMode === "testnet",
    isReal: tradingMode === "real",
  };
}
