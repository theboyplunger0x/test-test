"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { User } from "@/lib/api";
import type { usePrivyWallet } from "@/hooks/usePrivyWallet";

type Wallet = ReturnType<typeof usePrivyWallet>;

interface AccountDrawerProps {
  open:        boolean;
  onClose:     () => void;
  dk:          boolean;
  user:        User | null;
  wallet:      Wallet;
  tradingMode: "paper" | "real" | "testnet";
  onTradingModeChange: (mode: "paper" | "real" | "testnet") => void;
  notificationsEnabled: boolean;
  tradePresets: number[];
  onTradePresetsChange: (presets: number[]) => void;
  onToggleNotifications: () => void;
  onToggleDarkMode: () => void;
  onOpenReferrals: () => void;
  onLogout:    () => void;
  /** On-chain vault USDC balance (from useVault). */
  vaultBalance?: string;
}

/**
 * Account drawer (formerly Settings drawer).
 *
 * iOS-style drill-down navigation: main view shows sections (Earn / Wallet /
 * Preferences) and the Wallet row drills down to a dedicated Wallet panel
 * inside the same drawer with a back arrow.
 */
export default function AccountDrawer({
  open,
  onClose,
  dk,
  user,
  wallet,
  tradingMode,
  onTradingModeChange,
  notificationsEnabled,
  tradePresets,
  onTradePresetsChange,
  onToggleNotifications,
  onToggleDarkMode,
  onOpenReferrals,
  onLogout,
  vaultBalance,
}: AccountDrawerProps) {
  const [accountView, setAccountView] = useState<"main" | "wallet">("main");

  const drawerBg     = dk ? "bg-[#111] border-white/8" : "bg-white border-gray-100";
  const drawerHeader = dk ? "border-white/8"           : "border-gray-100";
  const drawerClose  = dk ? "text-white/40 hover:text-white" : "text-gray-400 hover:text-gray-900";

  const close = () => {
    onClose();
    setAccountView("main");
  };

  const { walletAddr, privyAuthenticated, isEmbeddedWallet } = wallet;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="settings-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 bg-black/60 z-40" />
          <motion.div key="settings-drawer"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={`fixed right-0 top-0 h-full w-full md:w-[320px] border-l z-50 flex flex-col overflow-hidden ${drawerBg}`}>

            {/* Header — adapts to current view */}
            <div className={`flex items-center justify-between px-5 py-4 border-b shrink-0 ${drawerHeader}`}>
              <div className="flex items-center gap-3">
                {accountView === "wallet" ? (
                  <>
                    <button onClick={() => setAccountView("main")}
                      className={`text-[18px] font-bold transition-colors ${dk ? "text-white/60 hover:text-white" : "text-gray-500 hover:text-gray-900"}`}>←</button>
                    <p className={`text-[15px] font-black ${dk ? "text-white" : "text-gray-900"}`}>Wallet</p>
                  </>
                ) : user ? (
                  <>
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-black ${dk ? "bg-white/10 text-white/60" : "bg-gray-200 text-gray-500"}`}>
                        {user.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className={`text-[14px] font-black ${dk ? "text-white" : "text-gray-900"}`}>{user.username}</p>
                      <p className={`text-[11px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>
                        ${Number(user.balance_usd).toFixed(2)} real · ${Number(user.paper_balance_usd ?? 0).toFixed(2)} paper
                      </p>
                    </div>
                  </>
                ) : (
                  <p className={`text-[15px] font-black ${dk ? "text-white" : "text-gray-900"}`}>Account</p>
                )}
              </div>
              <button onClick={close} className={`text-[18px] font-bold transition-colors ${drawerClose}`}>✕</button>
            </div>

            {/* Drill-down content area */}
            <div className="flex-1 overflow-hidden relative">
              <AnimatePresence initial={false} mode="wait">
                {accountView === "main" ? (
                  <motion.div key="account-main"
                    initial={{ x: "-30%", opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: "-30%", opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="absolute inset-0 overflow-y-auto">

                    <div className={`border-b ${dk ? "border-white/8" : "border-gray-100"}`}>

                      {/* Section: Trading Mode — mobile only (desktop has header toggle) */}
                      <div className="md:hidden">
                        <p className={`text-[10px] font-black uppercase tracking-widest px-5 pt-4 pb-2 ${dk ? "text-white/30" : "text-gray-400"}`}>Trading Mode</p>
                        <div className="px-5 pb-3">
                          <div className={`flex rounded-xl border overflow-hidden ${dk ? "border-white/10" : "border-gray-200"}`}>
                            {(["paper", "real"] as const).map(m => (
                              <button key={m} onClick={() => onTradingModeChange(m)}
                                className={`flex-1 py-2 text-[11px] font-black transition-all ${
                                  tradingMode === m
                                    ? m === "paper" ? "bg-yellow-400 text-black" : "bg-emerald-500 text-white"
                                    : dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700"
                                }`}>
                                {m === "paper" ? "Paper" : "Real"}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Section: Earn */}
                      <p className={`text-[10px] font-black uppercase tracking-widest px-5 pt-4 pb-2 ${dk ? "text-white/30" : "text-gray-400"}`}>Earn</p>
                      <button onClick={() => { onOpenReferrals(); close(); }}
                        className={`w-full flex items-center gap-3.5 px-5 py-3 transition-all ${dk ? "hover:bg-white/5" : "hover:bg-gray-50"}`}>
                        <span className="text-[20px] w-7 text-center">🎁</span>
                        <span className={`text-[14px] font-bold flex-1 text-left ${dk ? "text-white" : "text-gray-900"}`}>Referrals & Cashback</span>
                        <span className={`text-[14px] ${dk ? "text-white/30" : "text-gray-400"}`}>›</span>
                      </button>

                      {/* Section: Wallet */}
                      {user && (
                        <>
                          <p className={`text-[10px] font-black uppercase tracking-widest px-5 pt-4 pb-2 ${dk ? "text-white/30" : "text-gray-400"}`}>Wallet</p>
                          <button onClick={() => setAccountView("wallet")}
                            className={`w-full flex items-center gap-3.5 px-5 py-3 transition-all ${dk ? "hover:bg-white/5" : "hover:bg-gray-50"}`}>
                            <span className="text-[20px] w-7 text-center">🔐</span>
                            <span className={`text-[14px] font-bold flex-1 text-left ${dk ? "text-white" : "text-gray-900"}`}>
                              {walletAddr ? `${walletAddr.slice(0, 6)}...${walletAddr.slice(-4)}` : "Not connected"}
                            </span>
                            <span className={`text-[14px] ${dk ? "text-white/30" : "text-gray-400"}`}>›</span>
                          </button>
                        </>
                      )}

                      {/* Section: Preferences */}
                      <p className={`text-[10px] font-black uppercase tracking-widest px-5 pt-4 pb-2 ${dk ? "text-white/30" : "text-gray-400"}`}>Preferences</p>
                      <div className={`flex items-center gap-3.5 px-5 py-3`}>
                        <span className="text-[20px] w-7 text-center">🔔</span>
                        <span className={`text-[14px] font-bold flex-1 ${dk ? "text-white" : "text-gray-900"}`}>Position alerts</span>
                        <button
                          onClick={onToggleNotifications}
                          className={`relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 ${notificationsEnabled ? "bg-emerald-500" : (dk ? "bg-white/10" : "bg-gray-200")}`}>
                          <motion.span
                            animate={{ x: notificationsEnabled ? 20 : 2 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white shadow block" />
                        </button>
                      </div>
                      {typeof window !== "undefined" && Notification.permission === "denied" && (
                        <p className="text-[11px] font-bold px-5 pb-2 text-amber-400">Notifications blocked — enable in browser settings.</p>
                      )}

                      <div className={`flex items-center gap-3.5 px-5 py-3`}>
                        <span className="text-[20px] w-7 text-center">🌙</span>
                        <span className={`text-[14px] font-bold flex-1 ${dk ? "text-white" : "text-gray-900"}`}>Dark mode</span>
                        <button
                          onClick={onToggleDarkMode}
                          className={`relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 ${dk ? "bg-emerald-500" : "bg-gray-200"}`}>
                          <motion.span
                            animate={{ x: dk ? 20 : 2 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white shadow block" />
                        </button>
                      </div>

                      {/* Quick bet amounts */}
                      <div className="px-5 py-3 pb-4">
                        <div className="flex items-center gap-3.5 mb-2.5">
                          <span className="text-[20px] w-7 text-center">⚡</span>
                          <span className={`text-[14px] font-bold ${dk ? "text-white" : "text-gray-900"}`}>Quick bet amounts</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5 ml-[calc(1.75rem+0.875rem)]">
                          {tradePresets.map((val, i) => (
                            <div key={i} className="relative">
                              <span className={`absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>$</span>
                              <input
                                type="number"
                                value={val}
                                min={1}
                                max={10000}
                                onChange={e => {
                                  const next = [...tradePresets];
                                  next[i] = Math.max(1, Number(e.target.value) || 1);
                                  onTradePresetsChange(next);
                                }}
                                className={`w-full pl-5 pr-1.5 py-2 rounded-lg text-[12px] font-bold text-center outline-none transition-all ${
                                  dk
                                    ? "bg-white/[0.06] border border-white/10 text-white focus:border-white/30"
                                    : "bg-gray-50 border border-gray-200 text-gray-900 focus:border-gray-400"
                                }`}
                              />
                            </div>
                          ))}
                        </div>
                        <p className={`text-[10px] font-bold mt-1.5 ml-[calc(1.75rem+0.875rem)] ${dk ? "text-white/25" : "text-gray-400"}`}>
                          Preset buttons when placing trades.
                        </p>
                      </div>
                    </div>

                    {/* Sign out */}
                    {user && (
                      <button
                        onClick={() => { onLogout(); close(); }}
                        className={`w-full flex items-center gap-3.5 px-5 py-4 transition-all ${dk ? "hover:bg-red-500/8" : "hover:bg-red-50"}`}>
                        <span className="text-[20px] w-7 text-center">↩</span>
                        <span className="text-[14px] font-bold text-red-500">Sign out</span>
                      </button>
                    )}
                  </motion.div>
                ) : (
                  <motion.div key="account-wallet"
                    initial={{ x: "30%", opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: "30%", opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="absolute inset-0 overflow-y-auto px-5 py-4 space-y-4">

                    {walletAddr ? (
                      <>
                        {/* Address display + copy */}
                        <div>
                          <p className={`text-[10px] font-black uppercase tracking-widest pb-2 ${dk ? "text-white/30" : "text-gray-400"}`}>Address</p>
                          <div className={`flex items-center gap-2 px-3 py-3 rounded-lg ${dk ? "bg-white/5" : "bg-gray-100"}`}>
                            <span className={`text-[11px] font-mono flex-1 break-all ${dk ? "text-white/70" : "text-gray-700"}`}>
                              {walletAddr}
                            </span>
                            <button onClick={() => { navigator.clipboard.writeText(walletAddr); }}
                              className={`text-[10px] font-black px-2.5 py-1.5 rounded shrink-0 ${dk ? "bg-white/10 text-white/60 hover:bg-white/20" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                              COPY
                            </button>
                          </div>
                        </div>

                        {/* On-chain Vault Balance (Real mode) */}
                        {vaultBalance && parseFloat(vaultBalance) >= 0 && (
                          <div>
                            <p className={`text-[10px] font-black uppercase tracking-widest pb-2 ${dk ? "text-white/30" : "text-gray-400"}`}>Vault Balance (USDC)</p>
                            <div className={`flex items-center justify-between px-3 py-3 rounded-lg ${dk ? "bg-white/5" : "bg-gray-100"}`}>
                              <span className={`text-[16px] font-black ${dk ? "text-white" : "text-gray-900"}`}>
                                ${parseFloat(vaultBalance).toFixed(2)}
                              </span>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${dk ? "bg-blue-500/20 text-blue-300" : "bg-blue-50 text-blue-600"}`}>
                                On-chain
                              </span>
                            </div>
                            <p className={`text-[10px] mt-1.5 ${dk ? "text-white/25" : "text-gray-400"}`}>
                              Deposit USDC to the FUDVault contract to bet in Real mode. Withdraw anytime.
                            </p>
                          </div>
                        )}

                        {/* Funds */}
                        {privyAuthenticated && (
                          <div>
                            <p className={`text-[10px] font-black uppercase tracking-widest pb-2 ${dk ? "text-white/30" : "text-gray-400"}`}>Funds</p>
                            <div className="grid grid-cols-2 gap-2">
                              <button onClick={() => wallet.fund()}
                                className="px-3 py-2.5 rounded-lg text-[11px] font-black bg-emerald-500 hover:bg-emerald-400 text-white transition-all">
                                + Add funds
                              </button>
                              <button onClick={() => wallet.exportKey()}
                                className={`px-3 py-2.5 rounded-lg text-[11px] font-black transition-all ${dk ? "bg-white/10 hover:bg-white/20 text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-900"}`}>
                                Export key
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Manage */}
                        <div>
                          <p className={`text-[10px] font-black uppercase tracking-widest pb-2 ${dk ? "text-white/30" : "text-gray-400"}`}>Manage</p>
                          <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => wallet.linkAnother()}
                              className={`px-3 py-2.5 rounded-lg text-[11px] font-black transition-all ${dk ? "bg-white/10 hover:bg-white/20 text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-900"}`}>
                              Link another
                            </button>
                            {isEmbeddedWallet ? (
                              // Embedded wallet is bound to the user's identity — you don't
                              // "disconnect" it, you end the session. It returns on re-login.
                              <button onClick={() => wallet.logoutPrivy()}
                                className="px-3 py-2.5 rounded-lg text-[11px] font-black bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 transition-all">
                                Sign out of wallet
                              </button>
                            ) : (
                              <button onClick={() => wallet.disconnect()}
                                className="px-3 py-2.5 rounded-lg text-[11px] font-black bg-red-500/20 hover:bg-red-500/40 text-red-400 transition-all">
                                Disconnect
                              </button>
                            )}
                          </div>
                          {isEmbeddedWallet && (
                            <p className={`text-[10px] mt-2 ${dk ? "text-white/30" : "text-gray-400"}`}>
                              Your embedded wallet stays linked to your account. Sign back in any time to recover it.
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="space-y-3">
                        <p className={`text-[12px] ${dk ? "text-white/50" : "text-gray-500"}`}>
                          No wallet connected. Connect MetaMask or login with Privy to create an embedded wallet automatically.
                        </p>
                        <button onClick={() => { wallet.connect().catch(() => {}); }}
                          className="w-full px-3 py-2.5 rounded-lg text-[12px] font-black bg-purple-500 hover:bg-purple-400 text-white transition-all">
                          Connect Wallet
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
