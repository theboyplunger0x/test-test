"use client";

import { motion } from "framer-motion";

interface FundingCTAProps {
  /** Single click handler — caller decides where to route based on context. */
  onClick: () => void;
}

/**
 * Header's primary action button — Polymarket-style "Deposit" CTA.
 *
 * Stable label, stable color. Routing logic lives in the parent so this
 * component never has to know about trading modes, wallets, auth, or modals.
 * If a new edge case appears, the parent handles it — this stays untouched.
 */
export default function FundingCTA({ onClick }: FundingCTAProps) {
  return (
    <motion.button whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className="px-4 py-2 rounded-xl text-[12px] font-black bg-blue-500 hover:bg-blue-400 text-white transition-all">
      Deposit
    </motion.button>
  );
}
