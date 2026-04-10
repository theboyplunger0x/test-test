"use client";

import { motion } from "framer-motion";

export type ConnectWalletMode = "add" | "reconnect";

interface ConnectWalletModalProps {
  onClose: () => void;
  dk:      boolean;
  /** "add" = no wallet ever; "reconnect" = had embedded, session ended. */
  mode:    ConnectWalletMode;
  /** Triggered by the primary CTA — Privy login (creates/recovers embedded). */
  onUseEmbedded:    () => void;
  /** Triggered by the secondary CTA — direct external wallet (MetaMask). */
  onConnectExternal: () => void;
}

/**
 * Focused modal for the "logged in but no wallet" case.
 *
 * Two intents, two clear paths. Keeps the user oriented around their original
 * intent (deposit) without dumping them into the AccountDrawer.
 *
 * Modes:
 * - "add"       → first time / never had wallet (C1, C3)
 * - "reconnect" → had a Privy embedded but the session ended (C2)
 */
export default function ConnectWalletModal({
  onClose,
  dk,
  mode,
  onUseEmbedded,
  onConnectExternal,
}: ConnectWalletModalProps) {
  const bg       = dk ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const closeCls = dk ? "text-white/40 hover:text-white" : "text-gray-400 hover:text-gray-900";
  const title    = dk ? "text-white" : "text-gray-900";
  const subtle   = dk ? "text-white/50" : "text-gray-500";
  const label    = dk ? "text-white/30" : "text-gray-400";
  const optionPrimary   = "bg-blue-500 hover:bg-blue-400 text-white";
  const optionSecondary = dk
    ? "bg-white/[0.06] hover:bg-white/[0.10] text-white border border-white/10"
    : "bg-gray-50 hover:bg-gray-100 text-gray-900 border border-gray-200";
  const linkBtn = dk ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-700";

  const headline = mode === "reconnect"
    ? "Reconnect your FUD wallet"
    : "Add a wallet to continue";

  const subhead = mode === "reconnect"
    ? "Sign back in with the email or social you used before — your wallet stays the same."
    : "You need a wallet to deposit funds in Real or Testnet mode.";

  const primaryLabel = mode === "reconnect"
    ? "Continue with email / social"
    : "Use embedded wallet";

  const primaryHint = mode === "reconnect"
    ? "Recovers your existing FUD wallet"
    : "Recommended · fastest · created for your FUD account";

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
        className={`relative w-[380px] rounded-2xl border p-6 shadow-2xl z-10 ${bg}`}
      >
        <button onClick={onClose} className={`absolute top-4 right-4 text-[18px] font-bold transition-colors ${closeCls}`}>✕</button>

        <div className="mb-5">
          <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${label}`}>Wallet</p>
          <h2 className={`text-[20px] font-black leading-tight ${title}`}>{headline}</h2>
          <p className={`text-[12px] font-bold mt-2 ${subtle}`}>{subhead}</p>
        </div>

        <div className="space-y-2.5">
          {/* Primary — embedded / reconnect */}
          <button
            onClick={onUseEmbedded}
            className={`w-full text-left px-4 py-3.5 rounded-xl text-[13px] font-black transition-all ${optionPrimary}`}>
            <div className="flex items-center gap-3">
              <span className="text-[18px]">⚡</span>
              <div className="flex-1">
                <div>{primaryLabel}</div>
                <div className="text-[10px] font-bold opacity-80 mt-0.5">{primaryHint}</div>
              </div>
            </div>
          </button>

          {/* Secondary — connect external */}
          <button
            onClick={onConnectExternal}
            className={`w-full text-left px-4 py-3.5 rounded-xl text-[13px] font-black transition-all ${optionSecondary}`}>
            <div className="flex items-center gap-3">
              <span className="text-[18px]">🦊</span>
              <div className="flex-1">
                <div>Connect external wallet</div>
                <div className={`text-[10px] font-bold mt-0.5 ${subtle}`}>MetaMask, Rainbow, and others</div>
              </div>
            </div>
          </button>
        </div>

        <div className="mt-5 text-center">
          <button
            onClick={onClose}
            className={`text-[11px] font-bold transition-colors ${linkBtn}`}>
            Not now
          </button>
        </div>
      </motion.div>
    </div>
  );
}
