"use client";

import { motion } from "framer-motion";
import type { TradingMode } from "@/hooks/useTradingMode";

interface FundingCTAProps {
  tradingMode: TradingMode;
  walletAddr:  string | null;
  /** Called when user wants to fund their wallet (testnet/real). */
  onFund:      () => void;
  /** Called when user needs to connect/login (testnet/real, no wallet). */
  onConnect:   () => void;
  /** Called when user wants paper credits. */
  onPaperCredits: () => void;
}

/**
 * The header's primary action button.
 *
 * Polymorphic by design — different jobs depending on trading mode and wallet
 * state. The variants are: + Fund / Connect / + Credits.
 */
export default function FundingCTA({
  tradingMode,
  walletAddr,
  onFund,
  onConnect,
  onPaperCredits,
}: FundingCTAProps) {
  const paperMode = tradingMode === "paper";
  const isTestnet = tradingMode === "testnet";
  const isReal    = tradingMode === "real";

  const label = isTestnet
    ? (walletAddr ? "+ Fund" : "Connect")
    : isReal
      ? (walletAddr ? "+ Fund" : "Connect")
      : paperMode
        ? "+ Credits"
        : "Deposit";

  const colorCls = isTestnet
    ? "bg-purple-500 hover:bg-purple-400 text-white"
    : isReal
      ? "bg-emerald-500 hover:bg-emerald-400 text-white"
      : "bg-blue-500 hover:bg-blue-400 text-white";

  return (
    <motion.button whileTap={{ scale: 0.96 }}
      onClick={() => {
        if (isTestnet || isReal) {
          if (walletAddr) onFund();
          else onConnect();
        } else if (paperMode) {
          onPaperCredits();
        }
      }}
      className={`px-3.5 py-2 rounded-xl text-[12px] font-black transition-all ${colorCls}`}>
      {label}
    </motion.button>
  );
}
