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
 * Header's primary action button — Polymarket-style "Deposit" CTA.
 *
 * Always shows "Deposit" label. The action behind it routes by context:
 * - Paper mode → opens paper credits modal
 * - Real/Testnet without wallet → triggers connect flow (Privy auth)
 * - Real/Testnet with wallet → opens Privy fund flow
 *
 * One stable label, one stable color, three contextual destinations.
 * No more polymorphic labels confusing the user.
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
      className="px-4 py-2 rounded-xl text-[12px] font-black bg-blue-500 hover:bg-blue-400 text-white transition-all">
      Deposit
    </motion.button>
  );
}
