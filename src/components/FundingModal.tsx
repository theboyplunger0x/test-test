"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface FundingModalProps {
  dk: boolean;
  onClose: () => void;
  mainWalletAddress: string;
  vaultBalance: string;
  /** The vault contract address where USDC should be sent */
  depositAddress: string;
}

/**
 * Funding modal — shows the user how to deposit USDC to their FUD account.
 *
 * The user sends USDC on Base to the deposit address. The backend/operator
 * detects the transfer and credits their Main Wallet via depositFor().
 * The user never needs gas.
 */
export default function FundingModal({
  dk,
  onClose,
  mainWalletAddress,
  vaultBalance,
  depositAddress,
}: FundingModalProps) {
  const [copied, setCopied] = useState(false);

  const bg = dk ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const cardBg = dk ? "bg-white/[0.03] border-white/8" : "bg-gray-50 border-gray-200";
  const label = dk ? "text-white/30" : "text-gray-400";
  const strong = dk ? "text-white" : "text-gray-900";
  const muted = dk ? "text-white/50" : "text-gray-500";

  function copyAddress() {
    navigator.clipboard.writeText(depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 340, damping: 28 }}
        className={`relative w-[400px] max-w-full rounded-2xl border p-6 shadow-2xl z-10 ${bg}`}
      >
        <button onClick={onClose} className={`absolute top-4 right-4 text-[18px] font-bold transition-colors ${dk ? "text-white/20 hover:text-white/50" : "text-gray-300 hover:text-gray-600"}`}>✕</button>

        {/* Header */}
        <div className="mb-5">
          <h2 className={`text-[20px] font-black ${strong}`}>Add Funds</h2>
          <p className={`text-[12px] font-bold mt-1 ${muted}`}>
            Send USDC on Base to start trading.
          </p>
        </div>

        {/* Current balance */}
        <div className={`rounded-xl border p-3 mb-4 ${cardBg}`}>
          <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${label}`}>Current Balance</p>
          <p className={`text-[20px] font-black ${strong}`}>${parseFloat(vaultBalance).toFixed(2)}</p>
        </div>

        {/* Deposit address */}
        <div className={`rounded-xl border p-4 mb-4 ${cardBg}`}>
          <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${label}`}>Send USDC to this address</p>
          <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg ${dk ? "bg-white/5" : "bg-gray-100"}`}>
            <span className={`text-[11px] font-mono flex-1 break-all ${dk ? "text-white/70" : "text-gray-700"}`}>
              {depositAddress}
            </span>
            <button onClick={copyAddress}
              className={`text-[10px] font-black px-2.5 py-1.5 rounded shrink-0 transition-all ${
                copied
                  ? "bg-emerald-500 text-white"
                  : dk ? "bg-white/10 text-white/60 hover:bg-white/20" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className={`w-2 h-2 rounded-full bg-blue-500 shrink-0`} />
            <p className={`text-[10px] font-bold ${dk ? "text-blue-300" : "text-blue-600"}`}>Base network only</p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2 h-2 rounded-full bg-emerald-500 shrink-0`} />
            <p className={`text-[10px] font-bold ${dk ? "text-emerald-300" : "text-emerald-600"}`}>USDC only</p>
          </div>
        </div>

        {/* How it works */}
        <div className={`space-y-2 mb-4`}>
          <p className={`text-[10px] font-black uppercase tracking-widest ${label}`}>How it works</p>
          <div className="flex items-start gap-2">
            <span className={`text-[12px] font-black w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${dk ? "bg-white/10 text-white/50" : "bg-gray-100 text-gray-500"}`}>1</span>
            <p className={`text-[11px] font-bold ${muted}`}>Send USDC on Base to the address above</p>
          </div>
          <div className="flex items-start gap-2">
            <span className={`text-[12px] font-black w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${dk ? "bg-white/10 text-white/50" : "bg-gray-100 text-gray-500"}`}>2</span>
            <p className={`text-[11px] font-bold ${muted}`}>Your balance updates automatically (no gas needed)</p>
          </div>
          <div className="flex items-start gap-2">
            <span className={`text-[12px] font-black w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${dk ? "bg-white/10 text-white/50" : "bg-gray-100 text-gray-500"}`}>3</span>
            <p className={`text-[11px] font-bold ${muted}`}>Start trading with your USDC balance</p>
          </div>
        </div>

        {/* Account info */}
        <div className={`text-[10px] ${label}`}>
          <p>Your FUD Wallet: {mainWalletAddress.slice(0, 6)}...{mainWalletAddress.slice(-4)}</p>
        </div>
      </motion.div>
    </div>
  );
}
