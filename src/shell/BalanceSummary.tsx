"use client";

import type { TradingMode } from "@/hooks/useTradingMode";

interface BalanceSummaryProps {
  dk:           boolean;
  tradingMode:  TradingMode;
  paperBalance: number;
  realBalance:  number;
  walletAddr:   string | null;
  genBalance:   number;
}

/**
 * Right-aligned balance display in the header.
 *
 * Mode-aware: shows GEN + truncated address for testnet, USD + address for real,
 * paper/real balance otherwise. Hidden on small screens.
 */
export default function BalanceSummary({
  dk,
  tradingMode,
  paperBalance,
  realBalance,
  walletAddr,
  genBalance,
}: BalanceSummaryProps) {
  const paperMode = tradingMode === "paper";
  const isTestnet = tradingMode === "testnet";
  const isReal    = tradingMode === "real";

  const labelCls = `text-[9px] font-black uppercase tracking-widest ${dk ? "text-white/25" : "text-gray-400"}`;

  // Testnet with wallet → GEN balance + address
  if (isTestnet && walletAddr) {
    return (
      <div className="hidden sm:flex flex-col items-end gap-0.5">
        <span className={labelCls}>{walletAddr.slice(0, 6)}...{walletAddr.slice(-4)}</span>
        <span className="text-[13px] font-black tabular-nums text-purple-400">{genBalance.toFixed(2)} GEN</span>
      </div>
    );
  }

  // Real with wallet → USD balance + address
  if (isReal && walletAddr) {
    return (
      <div className="hidden sm:flex flex-col items-end gap-0.5">
        <span className={labelCls}>{walletAddr.slice(0, 6)}...{walletAddr.slice(-4)}</span>
        <span className="text-[13px] font-black tabular-nums text-emerald-400">${realBalance.toFixed(2)}</span>
      </div>
    );
  }

  // Default: paper/real label + balance
  const n = paperMode ? paperBalance : realBalance;
  const formatted = n >= 10000 ? `$${(n/1000).toFixed(1)}K` : n >= 1000 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;

  return (
    <div className="hidden sm:flex flex-col items-end gap-0.5">
      <span className={labelCls}>
        {paperMode ? "Paper" : isReal ? "Balance" : "Testnet"}
      </span>
      <span className={`text-[13px] font-black tabular-nums ${paperMode ? "text-yellow-400" : "text-emerald-400"}`}>
        {formatted}
      </span>
    </div>
  );
}
