"use client";
// v2 — HD wallet unique addresses
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";

type Chain = "base" | "sol";
type Step  = "address" | "waiting" | "done";

type Addresses = {
  evm: { address: string; note: string };
  sol: { address: string; note: string };
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
  const [addresses, setAddresses]   = useState<Addresses | null>(null);
  const [chain, setChain]           = useState<Chain>("base");
  const [step, setStep]             = useState<Step>("address");
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [copied, setCopied]         = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [txHash, setTxHash]         = useState("");
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError]     = useState("");
  const [credited, setCredited]     = useState<string | null>(null);
  const [newBalance, setNewBalance] = useState<string | null>(null);

  const pollRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevBalRef    = useRef<string | null>(null);

  // ── Theme ──────────────────────────────────────────────────────────────────
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
  const errorCls   = dk ? "text-red-400 bg-red-500/10 border border-red-500/20" : "text-red-600 bg-red-50 border border-red-200";

  useEffect(() => {
    api.depositAddress()
      .then((a) => { setAddresses(a); setLoading(false); })
      .catch(() => { setError("Could not load deposit address."); setLoading(false); });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function currentAddress() {
    if (!addresses) return "";
    return chain === "base" ? addresses.evm.address : addresses.sol.address;
  }

  function copyAddr() {
    navigator.clipboard.writeText(currentAddress());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function startWaiting() {
    setStep("waiting");
    // Poll /auth/me every 10s; detect balance increase
    api.me().then((u) => { prevBalRef.current = u.balance_usd; }).catch(() => {});
    pollRef.current = setInterval(async () => {
      try {
        const user = await api.me();
        const prev = prevBalRef.current;
        if (prev !== null && Number(user.balance_usd) > Number(prev)) {
          clearInterval(pollRef.current!);
          const diff = (Number(user.balance_usd) - Number(prev)).toFixed(2);
          setCredited(diff);
          setNewBalance(user.balance_usd);
          setStep("done");
          onDeposited(user.balance_usd);
        }
        prevBalRef.current = user.balance_usd;
      } catch {}
    }, 10_000);
  }

  async function handleManualConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!txHash.trim()) return;
    setManualError("");
    setManualLoading(true);
    try {
      const result = await api.confirmDeposit(txHash.trim(), chain);
      setNewBalance(String(result.new_balance));
      setCredited(null);
      setStep("done");
      if (pollRef.current) clearInterval(pollRef.current);
      onDeposited(String(result.new_balance));
    } catch (err: any) {
      setManualError(err.message ?? "Could not verify transaction");
    } finally {
      setManualLoading(false);
    }
  }

  function reset() {
    setStep("address");
    setCredited(null);
    setNewBalance(null);
    setError("");
    setShowManual(false);
    setTxHash("");
    if (pollRef.current) clearInterval(pollRef.current);
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

          {/* ── Step 1: show unique deposit address ──────────────── */}
          {step === "address" && (
            <motion.div key="address" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="mb-5">
                <p className={`text-[18px] font-black tracking-tight ${strong}`}>Deposit USDC</p>
                <p className={`text-[12px] mt-0.5 ${lbl}`}>Your unique deposit address — send USDC and we'll credit you automatically.</p>
              </div>

              {/* Chain */}
              <div className={`flex rounded-xl p-0.5 mb-4 ${dk ? "bg-white/5" : "bg-gray-100"}`}>
                {(["base", "sol"] as Chain[]).map((c) => (
                  <button key={c} onClick={() => { setChain(c); setCopied(false); }}
                    className={`flex-1 py-2 rounded-[10px] text-[12px] font-black transition-all uppercase tracking-wide ${chain === c ? tabActive : tabInactive}`}>
                    {c === "base" ? "Base (USDC)" : "Solana (USDC)"}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className={`text-[12px] text-center py-6 ${muted}`}>Loading your address…</div>
              ) : error ? (
                <p className={`text-[12px] font-bold px-3 py-2 rounded-xl ${errorCls}`}>{error}</p>
              ) : (
                <>
                  <div>
                    <p className={`text-[10px] font-black uppercase tracking-widest mb-1.5 ${lbl}`}>
                      Your {chain === "base" ? "Base" : "Solana"} deposit address
                    </p>
                    <div className="flex gap-2">
                      <div className={`flex-1 px-3 py-2.5 rounded-xl text-[11px] font-mono break-all leading-relaxed ${addrBox}`}>
                        {currentAddress()}
                      </div>
                      <button onClick={copyAddr}
                        className={`px-3 rounded-xl text-[11px] font-black shrink-0 transition-all ${
                          dk ? "bg-white/8 hover:bg-white/15 text-white/50 hover:text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-500"
                        }`}>
                        {copied ? "✓" : "Copy"}
                      </button>
                    </div>
                    <p className={`text-[10px] mt-1 ${muted}`}>This address is unique to your account. Send only USDC.</p>
                  </div>

                  <button onClick={startWaiting} className={`mt-4 ${btnPrimary}`}>
                    I've sent USDC →
                  </button>
                </>
              )}

              <p className={`text-[11px] text-center mt-4 ${lbl}`}>
                USDC only · {chain === "base" ? "Base network" : "Solana mainnet"} · 1:1 credit
              </p>
            </motion.div>
          )}

          {/* ── Step 2: waiting ───────────────────────────────────── */}
          {step === "waiting" && (
            <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                <p className={`text-[15px] font-black ${strong}`}>Watching for your deposit…</p>
              </div>

              <p className={`text-[12px] ${lbl}`}>
                Send USDC to your address on {chain === "base" ? "Base" : "Solana"}. We'll auto-credit within ~30s of confirmation.
              </p>

              {/* Address reminder */}
              <div>
                <p className={`text-[10px] font-black uppercase tracking-widest mb-1.5 ${lbl}`}>
                  Your deposit address ({chain === "base" ? "Base" : "Solana"})
                </p>
                <div className="flex gap-2">
                  <div className={`flex-1 px-3 py-2.5 rounded-xl text-[11px] font-mono break-all leading-relaxed ${addrBox}`}>
                    {currentAddress()}
                  </div>
                  <button onClick={copyAddr}
                    className={`px-3 rounded-xl text-[11px] font-black shrink-0 transition-all ${
                      dk ? "bg-white/8 hover:bg-white/15 text-white/50 hover:text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-500"
                    }`}>
                    {copied ? "✓" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Spinner */}
              <div className={`flex items-center gap-2 text-[11px] font-bold ${muted}`}>
                <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Checking every 10 seconds…
              </div>

              {/* Manual fallback */}
              <div>
                <button onClick={() => setShowManual(v => !v)}
                  className={`text-[11px] font-bold underline ${muted}`}>
                  Sent but not detected? Enter tx hash manually
                </button>
                <AnimatePresence>
                  {showManual && (
                    <motion.form
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      onSubmit={handleManualConfirm}
                      className="mt-2 space-y-2 overflow-hidden"
                    >
                      <input
                        type="text"
                        placeholder={chain === "base" ? "0xabc123…" : "5xyz789…"}
                        value={txHash}
                        onChange={(e) => { setTxHash(e.target.value); setManualError(""); }}
                        className={`w-full px-3 py-2 rounded-xl text-[12px] font-mono outline-none transition-all ${inputCls}`}
                      />
                      {manualError && (
                        <p className={`text-[11px] font-bold px-2 py-1.5 rounded-lg ${errorCls}`}>{manualError}</p>
                      )}
                      <button type="submit" disabled={manualLoading || !txHash.trim()}
                        className={`w-full py-2.5 rounded-xl text-[12px] font-black transition-all disabled:opacity-40 ${
                          dk ? "bg-white/10 text-white hover:bg-white/20" : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                        }`}>
                        {manualLoading ? "Verifying…" : "Verify tx hash"}
                      </button>
                    </motion.form>
                  )}
                </AnimatePresence>
              </div>

              <button onClick={reset} className={`text-[11px] font-bold ${muted} hover:opacity-70 transition-opacity`}>
                ← Back
              </button>
            </motion.div>
          )}

          {/* ── Step 3: success ────────────────────────────────────── */}
          {step === "done" && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-4 py-6">
              <div className="text-[44px]">✓</div>
              <div>
                <p className={`text-[20px] font-black ${strong}`}>
                  {credited ? `+$${Number(credited).toFixed(2)} credited!` : "Deposit confirmed!"}
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
