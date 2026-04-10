"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface WithdrawVaultModalProps {
  dk: boolean;
  onClose: () => void;
  vaultBalance: string;
  rewardBalance: string;
  walletAddr: string;
  onWithdraw: (amount: number) => Promise<void>;
  onClaimRewards: () => Promise<void>;
}

/**
 * Dedicated withdrawal modal for Real mode (on-chain vault).
 *
 * Shows trading balance + claimable rewards separately.
 * Withdraw = vault.withdraw(), Claim = vault.claimRewards().
 * No wallet address input, no chain selector — destination is
 * the connected wallet on Base.
 */
export default function WithdrawVaultModal({
  dk,
  onClose,
  vaultBalance,
  rewardBalance,
  walletAddr,
  onWithdraw,
  onClaimRewards,
}: WithdrawVaultModalProps) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const available = parseFloat(vaultBalance) || 0;
  const rewards = parseFloat(rewardBalance) || 0;
  const amtNum = parseFloat(amount) || 0;

  const bg = dk ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const cardBg = dk ? "bg-white/[0.03] border-white/8" : "bg-gray-50 border-gray-200";
  const label = dk ? "text-white/30" : "text-gray-400";
  const strong = dk ? "text-white" : "text-gray-900";
  const muted = dk ? "text-white/50" : "text-gray-500";
  const inputCls = dk
    ? "bg-white/[0.06] border-white/10 text-white placeholder:text-white/20 focus:border-white/30"
    : "bg-gray-50 border-gray-200 text-gray-900 focus:border-gray-400";
  const chipCls = (active: boolean) => active
    ? "bg-blue-500 text-white"
    : dk ? "bg-white/[0.06] text-white/40 hover:bg-white/10" : "bg-gray-100 text-gray-500 hover:bg-gray-200";

  async function handleWithdraw() {
    if (amtNum <= 0) { setError("Enter an amount"); return; }
    if (amtNum > available) { setError("Amount exceeds your available balance"); return; }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await onWithdraw(amtNum);
      setSuccess("Withdrawal complete — USDC sent to your wallet");
      setAmount("");
      setTimeout(() => setSuccess(""), 4000);
    } catch (e: any) {
      setError(e.message ?? "Withdrawal failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim() {
    setClaimLoading(true);
    setError("");
    setSuccess("");
    try {
      await onClaimRewards();
      setSuccess("Rewards claimed — USDC sent to your wallet");
      setTimeout(() => setSuccess(""), 4000);
    } catch (e: any) {
      setError(e.message ?? "Claim failed");
    } finally {
      setClaimLoading(false);
    }
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
          <h2 className={`text-[20px] font-black ${strong}`}>Withdraw USDC</h2>
          <p className={`text-[12px] font-bold mt-1 ${muted}`}>To your connected wallet on Base</p>
          <p className={`text-[10px] font-mono mt-1 ${label}`}>{walletAddr.slice(0, 6)}...{walletAddr.slice(-4)}</p>
        </div>

        {/* Balances */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className={`rounded-xl border p-3 ${cardBg}`}>
            <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${label}`}>Available to withdraw</p>
            <p className={`text-[18px] font-black ${strong}`}>${available.toFixed(2)}</p>
            <p className={`text-[10px] ${muted}`}>Trading funds</p>
          </div>
          <div className={`rounded-xl border p-3 ${cardBg}`}>
            <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${rewards > 0 ? (dk ? "text-emerald-400/70" : "text-emerald-600/70") : label}`}>Claimable rewards</p>
            <p className={`text-[18px] font-black ${rewards > 0 ? "text-emerald-400" : muted}`}>${rewards.toFixed(2)}</p>
            <p className={`text-[10px] ${muted}`}>Cashback & referral</p>
          </div>
        </div>

        {/* Amount input */}
        {available > 0 && (
          <div className="mb-4">
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1.5 ${label}`}>Amount</p>
            <div className="relative mb-2">
              <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[12px] font-bold ${label}`}>$</span>
              <input
                type="number" value={amount} onChange={e => { setAmount(e.target.value); setError(""); }}
                placeholder="0.00" min={0} step={0.01}
                className={`w-full pl-6 pr-3 py-2.5 rounded-xl text-[14px] font-bold outline-none border transition-all ${inputCls}`}
              />
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {[25, 50, 100].map(pct => {
                const val = (available * pct / 100).toFixed(2);
                return (
                  <button key={pct} onClick={() => { setAmount(val); setError(""); }}
                    className={`py-1.5 rounded-lg text-[11px] font-black transition-all ${chipCls(amount === val)}`}>
                    {pct === 100 ? "Max" : `${pct}%`}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* CTAs */}
        <div className="space-y-2">
          {available > 0 && (
            <button
              onClick={handleWithdraw}
              disabled={loading || amtNum <= 0}
              className="w-full py-3 rounded-xl text-[13px] font-black bg-blue-500 hover:bg-blue-400 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {loading ? "Preparing withdrawal..." : "Withdraw USDC"}
            </button>
          )}

          {rewards > 0 && (
            <button
              onClick={handleClaim}
              disabled={claimLoading}
              className="w-full py-3 rounded-xl text-[13px] font-black bg-emerald-500 hover:bg-emerald-400 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {claimLoading ? "Preparing claim..." : `Claim $${rewards.toFixed(2)} to balance`}
            </button>
          )}

          {available <= 0 && rewards <= 0 && (
            <div className="text-center py-4">
              <p className={`text-[13px] font-bold ${muted}`}>Nothing to withdraw yet.</p>
              <button onClick={onClose} className={`mt-2 text-[12px] font-black px-4 py-2 rounded-xl transition-all ${dk ? "bg-white/10 text-white hover:bg-white/20" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
                Close
              </button>
            </div>
          )}
        </div>

        {/* Feedback */}
        {error && (
          <p className={`text-[11px] font-bold mt-3 px-3 py-2 rounded-lg ${dk ? "text-red-400 bg-red-500/10" : "text-red-600 bg-red-50"}`}>
            {error}
          </p>
        )}
        {success && (
          <p className={`text-[11px] font-bold mt-3 px-3 py-2 rounded-lg ${dk ? "text-emerald-400 bg-emerald-500/10" : "text-emerald-600 bg-emerald-50"}`}>
            {success}
          </p>
        )}

        <p className={`text-[10px] mt-4 text-center ${label}`}>
          You'll confirm this in your wallet. Network fee applies.
        </p>
      </motion.div>
    </div>
  );
}
