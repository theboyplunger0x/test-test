"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";

type Chain = "base" | "sol";
type Step  = "address" | "confirm" | "done";

const TREASURY = {
  base: "0x1e85ce8815414Fc03f0CA30AE17e0BaEC0b1d0C5",
  sol:  "4z527x94wVuiMRuA15pqRKLvuF871iud6usTGDgA8W5c",
};

export default function DepositModal({
  dk,
  onClose,
  onDeposited,
}: {
  dk: boolean;
  onClose: () => void;
  onDeposited: (newBalance: string) => void;
}) {
  const [chain, setChain]       = useState<Chain>("base");
  const [step, setStep]         = useState<Step>("address");
  const [copied, setCopied]     = useState(false);
  const [txHash, setTxHash]     = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [newBalance, setNewBalance] = useState<string | null>(null);
  const [credited, setCredited] = useState<string | null>(null);

  // ── Theme ────────────────────────────────────────────────────────────────
  const bg       = dk ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const lbl      = dk ? "text-white/40"  : "text-gray-500";
  const strong   = dk ? "text-white"     : "text-gray-900";
  const muted    = dk ? "text-white/30"  : "text-gray-400";
  const closeCls = dk ? "text-white/20 hover:text-white/50" : "text-gray-300 hover:text-gray-600";
  const addrBox  = dk ? "bg-white/5 border border-white/8 text-white/70" : "bg-gray-50 border border-gray-200 text-gray-700";
  const inputCls = dk
    ? "bg-white/6 border border-white/10 text-white placeholder:text-white/20 focus:border-white/30"
    : "bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-300 focus:border-gray-400";
  const tabActive   = dk ? "bg-white text-black" : "bg-gray-900 text-white";
  const tabInactive = dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700";
  const btnPrimary  = `w-full py-3 rounded-xl text-[13px] font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
    dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-black"
  }`;
  const errorCls = dk ? "text-red-400 bg-red-500/10 border border-red-500/20" : "text-red-600 bg-red-50 border border-red-200";

  function copy() {
    navigator.clipboard.writeText(TREASURY[chain]);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!txHash.trim()) return;
    setError("");
    setLoading(true);
    try {
      const result = await api.confirmDeposit(txHash.trim(), chain);
      const dep = result.deposit as any;
      const prev = dep?.amount_usd ?? null;
      setCredited(prev ? String(Number(prev).toFixed(2)) : null);
      setNewBalance(String(result.new_balance));
      setStep("done");
      onDeposited(String(result.new_balance));
    } catch (err: any) {
      setError(err.message ?? "Could not verify transaction");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
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
        className={`relative w-[420px] rounded-2xl border p-6 shadow-2xl z-10 ${bg}`}
      >
        <button onClick={onClose} className={`absolute top-4 right-4 text-[18px] font-bold transition-colors ${closeCls}`}>✕</button>

        <AnimatePresence mode="wait">

          {/* ── Step 1: show treasury address ── */}
          {step === "address" && (
            <motion.div key="address" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="mb-5">
                <p className={`text-[18px] font-black tracking-tight ${strong}`}>Deposit USDC</p>
                <p className={`text-[12px] mt-0.5 ${lbl}`}>Send USDC to the address below, then confirm with your tx hash.</p>
              </div>

              {/* Chain tabs */}
              <div className={`flex rounded-xl p-0.5 mb-4 ${dk ? "bg-white/5" : "bg-gray-100"}`}>
                {(["base", "sol"] as Chain[]).map((c) => (
                  <button key={c} onClick={() => { setChain(c); setCopied(false); }}
                    className={`flex-1 py-2 rounded-[10px] text-[12px] font-black transition-all uppercase tracking-wide ${chain === c ? tabActive : tabInactive}`}>
                    {c === "base" ? "Base (USDC)" : "Solana (USDC)"}
                  </button>
                ))}
              </div>

              <div>
                <p className={`text-[10px] font-black uppercase tracking-widest mb-1.5 ${lbl}`}>
                  {chain === "base" ? "Base" : "Solana"} deposit address
                </p>
                <div className="flex gap-2">
                  <div className={`flex-1 px-3 py-2.5 rounded-xl text-[11px] font-mono break-all leading-relaxed ${addrBox}`}>
                    {TREASURY[chain]}
                  </div>
                  <button onClick={copy}
                    className={`px-3 rounded-xl text-[11px] font-black shrink-0 transition-all ${
                      dk ? "bg-white/8 hover:bg-white/15 text-white/50 hover:text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-500"
                    }`}>
                    {copied ? "✓" : "Copy"}
                  </button>
                </div>
                <p className={`text-[10px] mt-1 ${muted}`}>Send only USDC · {chain === "base" ? "Base network" : "Solana mainnet"}</p>
              </div>

              <button onClick={() => setStep("confirm")} className={`mt-4 ${btnPrimary}`}>
                I've sent USDC →
              </button>

              <p className={`text-[11px] text-center mt-3 ${muted}`}>1:1 credit · no fees</p>
            </motion.div>
          )}

          {/* ── Step 2: enter tx hash ── */}
          {step === "confirm" && (
            <motion.div key="confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="mb-5">
                <p className={`text-[18px] font-black tracking-tight ${strong}`}>Confirm deposit</p>
                <p className={`text-[12px] mt-0.5 ${lbl}`}>Paste your transaction hash to verify and credit your balance.</p>
              </div>

              {/* Address reminder */}
              <div className="mb-4">
                <p className={`text-[10px] font-black uppercase tracking-widest mb-1.5 ${lbl}`}>
                  You sent to ({chain === "base" ? "Base" : "Solana"})
                </p>
                <div className={`px-3 py-2 rounded-xl text-[11px] font-mono break-all ${addrBox}`}>
                  {TREASURY[chain]}
                </div>
              </div>

              <form onSubmit={handleConfirm} className="space-y-3">
                <div>
                  <p className={`text-[10px] font-black uppercase tracking-widest mb-1.5 ${lbl}`}>Transaction hash</p>
                  <input
                    type="text"
                    placeholder={chain === "base" ? "0xabc123…" : "5xyz789…"}
                    value={txHash}
                    onChange={(e) => { setTxHash(e.target.value); setError(""); }}
                    className={`w-full px-3 py-2.5 rounded-xl text-[12px] font-mono outline-none transition-all ${inputCls}`}
                    autoFocus
                  />
                </div>

                {error && (
                  <p className={`text-[11px] font-bold px-3 py-2 rounded-xl ${errorCls}`}>{error}</p>
                )}

                <button type="submit" disabled={loading || !txHash.trim()} className={btnPrimary}>
                  {loading ? "Verifying…" : "Verify & credit →"}
                </button>
              </form>

              <button onClick={() => { setStep("address"); setError(""); setTxHash(""); }}
                className={`mt-3 text-[11px] font-bold block mx-auto ${muted} hover:opacity-70 transition-opacity`}>
                ← Back
              </button>
            </motion.div>
          )}

          {/* ── Step 3: success ── */}
          {step === "done" && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-4 py-6">
              <div className="text-[44px]">✓</div>
              <div>
                <p className={`text-[20px] font-black ${strong}`}>
                  {credited ? `+$${credited} credited!` : "Deposit confirmed!"}
                </p>
                {newBalance && (
                  <p className={`text-[13px] mt-1 ${lbl}`}>
                    Balance: <span className="text-emerald-400 font-black">${Number(newBalance).toFixed(2)}</span>
                  </p>
                )}
              </div>
              <p className={`text-[11px] ${muted}`}>Available immediately. Withdrawals processed manually during beta.</p>
              <button onClick={onClose} className={btnPrimary}>Let's trade →</button>
            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
    </div>
  );
}
