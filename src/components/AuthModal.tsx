"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, AuthResponse } from "@/lib/api";
import { usePrivy, useWallets } from "@privy-io/react-auth";

type Tab  = "login" | "register";
type View = "auth" | "forgot" | "forgot-sent";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function AuthModal({
  dk,
  onSuccess,
  onClose,
}: {
  dk: boolean;
  onSuccess: (data: AuthResponse) => void;
  onClose: () => void;
}) {
  const [tab,      setTab]      = useState<Tab>("login");
  const [view,     setView]     = useState<View>("auth");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm,    setConfirm]    = useState("");
  const [email,      setEmail]      = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [referralFromUrl, setReferralFromUrl] = useState(false);
  const [forgotInput, setForgotInput] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  // Load pending referral from localStorage (captured from ?ref= URL)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("pending_referral");
      if (!raw) return;
      const { code, capturedAt } = JSON.parse(raw);
      // Expire after 30 days
      const daysSince = (Date.now() - new Date(capturedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 30) { localStorage.removeItem("pending_referral"); return; }
      setReferralCode(code);
      setReferralFromUrl(true);
      // If arriving via referral link, default to Register tab
      setTab("register");
    } catch { /* ignore corrupt data */ }
  }, []);

  // ── styles ────────────────────────────────────────────────────────────────
  const bg        = dk ? "bg-[#111] border-white/10"        : "bg-white border-gray-200";
  const inputCls  = dk
    ? "bg-white/6 border border-white/10 text-white placeholder:text-white/20 focus:border-white/30 focus:bg-white/10"
    : "bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-300 focus:border-gray-400";
  const labelCls    = dk ? "text-white/40"                    : "text-gray-500";
  const tabActive   = dk ? "bg-white text-black"              : "bg-gray-900 text-white";
  const tabInactive = dk ? "text-white/30 hover:text-white/60": "text-gray-400 hover:text-gray-700";
  const tabGroup    = dk ? "bg-white/5"                       : "bg-gray-100";
  const submitCls   = `w-full py-3 rounded-xl text-[13px] font-black transition-all ${
    dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-black"
  }`;
  const errorCls  = dk
    ? "text-red-400 bg-red-500/10 border border-red-500/20"
    : "text-red-600 bg-red-50 border border-red-200";
  const closeCls  = dk ? "text-white/20 hover:text-white/50" : "text-gray-300 hover:text-gray-600";
  const dividerCls = dk ? "text-white/20 border-white/10"    : "text-gray-300 border-gray-200";
  const googleCls  = dk
    ? "w-full flex items-center justify-center gap-2.5 py-3 rounded-xl text-[13px] font-bold border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-all"
    : "w-full flex items-center justify-center gap-2.5 py-3 rounded-xl text-[13px] font-bold border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 transition-all";
  const backCls   = dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700";

  // ── handlers ──────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (tab === "register") {
      if (!email) { setError("Email is required for account recovery"); return; }
      if (password !== confirm) { setError("Passwords do not match"); return; }
    }
    setLoading(true);
    try {
      const data = tab === "login"
        ? await api.login(username, password)
        : await api.register(username, password, email, referralCode.trim() || undefined);
      // Clear pending referral on successful register
      if (tab === "register") localStorage.removeItem("pending_referral");
      onSuccess(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    // Detect if input looks like an email or a username
    const isEmail = forgotInput.includes("@");
    try {
      await api.forgotPassword(isEmail ? forgotInput : undefined, !isEmail ? forgotInput : undefined);
      setView("forgot-sent");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleGoogleLogin() {
    window.location.href = `${BASE}/auth/google`;
  }

  // Privy integration
  const { login: privyLogin, logout: privyLogout, authenticated: privyAuthenticated, user: privyUser, ready: privyReady } = usePrivy();
  const { wallets: privyWallets } = useWallets();

  // When Privy authenticates, bootstrap user on our backend
  useEffect(() => {
    if (!privyReady || !privyAuthenticated || !privyUser) return;
    (async () => {
      try {
        const externalWallet = privyWallets.find(w => w.walletClientType !== "privy");
        const embeddedWallet = privyWallets.find(w => w.walletClientType === "privy");
        const email = privyUser.email?.address;

        // Build wallets array for bootstrap
        const walletList: { address: string; type: string; is_embedded: boolean }[] = [];
        if (embeddedWallet?.address) {
          walletList.push({ address: embeddedWallet.address, type: "embedded", is_embedded: true });
        }
        if (externalWallet?.address) {
          walletList.push({ address: externalWallet.address, type: "external", is_embedded: false });
        }
        // Fallback to Privy's reported wallet
        if (walletList.length === 0 && privyUser.wallet?.address) {
          walletList.push({ address: privyUser.wallet.address, type: "external", is_embedded: false });
        }

        // Read pending referral code
        let refCode: string | undefined;
        try {
          const raw = localStorage.getItem("pending_referral");
          if (raw) {
            const { code, capturedAt } = JSON.parse(raw);
            const days = (Date.now() - new Date(capturedAt).getTime()) / (1000 * 60 * 60 * 24);
            if (days <= 30) refCode = code;
            else localStorage.removeItem("pending_referral");
          }
        } catch {}

        const result = await api.bootstrap({
          privy_user_id: privyUser.id,
          auth_method: privyUser.google ? "google" : privyUser.email ? "email" : "wallet",
          email: email ?? undefined,
          wallets: walletList.length > 0 ? walletList : undefined,
          referral_code: refCode,
        });

        // Clear pending referral on success
        if (result.referral?.applied) localStorage.removeItem("pending_referral");

        localStorage.setItem("token", result.token);
        onSuccess(result as unknown as AuthResponse);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Login failed");
        privyLogout().catch(() => {});
      }
    })();
  }, [privyReady, privyAuthenticated, privyUser, privyWallets]);

  function switchTab(t: Tab) {
    setTab(t);
    setError("");
    setEmail("");
    setConfirm("");
  }

  function openForgot() {
    setView("forgot");
    setForgotInput("");
    setEmail("");
    setError("");
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 340, damping: 28 }}
        className={`relative w-[360px] rounded-2xl border p-6 shadow-2xl z-10 ${bg}`}
      >
        {/* Close */}
        <button onClick={onClose} className={`absolute top-4 right-4 text-[18px] font-bold transition-colors ${closeCls}`}>✕</button>

        {/* ── FORGOT PASSWORD VIEW ── */}
        <AnimatePresence mode="wait">
          {view === "forgot" && (
            <motion.div key="forgot" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
              <button onClick={() => setView("auth")} className={`flex items-center gap-1 text-[12px] font-bold mb-5 transition-colors ${backCls}`}>
                ← Back
              </button>
              <div className="mb-5">
                <span className="text-[18px] font-black tracking-tight">FUD.markets</span>
                <p className={`text-[12px] mt-0.5 ${labelCls}`}>Reset your password</p>
              </div>
              <form onSubmit={handleForgot} className="space-y-3">
                <div>
                  <label className={`text-[10px] font-black uppercase tracking-widest mb-1.5 block ${labelCls}`}>Email or Username</label>
                  <input
                    type="text" autoFocus required
                    placeholder="you@email.com or degen_lord"
                    value={forgotInput}
                    onChange={(e) => setForgotInput(e.target.value)}
                    className={`w-full px-3 py-2.5 rounded-xl text-[13px] font-bold outline-none transition-all ${inputCls}`}
                  />
                  <p className={`text-[10px] mt-1.5 font-bold ${labelCls}`}>
                    We'll send the reset link to the email on your account.
                  </p>
                </div>
                <AnimatePresence>
                  {error && (
                    <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className={`text-[12px] font-bold px-3 py-2 rounded-xl ${errorCls}`}>
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>
                <button type="submit" disabled={loading || !forgotInput} className={`${submitCls} disabled:opacity-40 disabled:cursor-not-allowed mt-1`}>
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>
            </motion.div>
          )}

          {/* ── FORGOT SENT ── */}
          {view === "forgot-sent" && (
            <motion.div key="forgot-sent" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="text-center py-4">
              <div className="text-4xl mb-4">📬</div>
              <p className="text-[16px] font-black mb-1">Check your inbox</p>
              <p className={`text-[12px] mb-6 ${labelCls}`}>
                If <b>{forgotInput}</b> is registered and has an email, we sent a reset link. Check spam too.
              </p>
              <button onClick={() => { setView("auth"); setEmail(""); }} className={`text-[12px] font-bold transition-colors ${backCls}`}>
                ← Back to sign in
              </button>
            </motion.div>
          )}

          {/* ── MAIN AUTH VIEW — Privy-only ── */}
          {view === "auth" && (
            <motion.div key="auth" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
              {/* Logo */}
              <div className="mb-6">
                <span className="text-[20px] font-black tracking-tight">Welcome to FUD</span>
                <p className={`text-[12px] mt-1 ${labelCls}`}>
                  Trade prediction markets on Base with USDC.
                </p>
              </div>

              {/* Google */}
              <button onClick={() => privyLogin()} className={googleCls}>
                <svg width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                Continue with Google
              </button>

              {/* Divider */}
              <div className={`flex items-center gap-3 my-4 ${dividerCls}`}>
                <div className={`flex-1 h-px border-t ${dk ? "border-white/10" : "border-gray-200"}`} />
                <span className="text-[11px] font-bold">OR</span>
                <div className={`flex-1 h-px border-t ${dk ? "border-white/10" : "border-gray-200"}`} />
              </div>

              {/* Email — triggers Privy email magic link */}
              <button onClick={() => privyLogin()} className={`w-full py-3 rounded-xl text-[13px] font-black flex items-center justify-center gap-2 transition-all ${dk ? "bg-white/[0.06] hover:bg-white/10 text-white border border-white/10" : "bg-gray-50 hover:bg-gray-100 text-gray-900 border border-gray-200"}`}>
                Continue with Email
              </button>

              {/* Wallet options */}
              <button onClick={() => privyLogin()} className={`w-full mt-2 py-3 rounded-xl text-[13px] font-black flex items-center justify-center gap-2 transition-all ${dk ? "bg-purple-600 hover:bg-purple-500 text-white" : "bg-purple-500 hover:bg-purple-400 text-white"}`}>
                Continue with Wallet
              </button>

              {/* Referral hint */}
              {referralFromUrl && referralCode && (
                <p className={`text-[11px] font-bold text-center mt-3 ${dk ? "text-emerald-400/60" : "text-emerald-600/60"}`}>
                  Referral code {referralCode} will be applied
                </p>
              )}

              {/* Error display */}
              <AnimatePresence>
                {error && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className={`text-[12px] font-bold px-3 py-2 rounded-xl mt-3 ${errorCls}`}>
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <p className={`text-[10px] text-center mt-5 ${labelCls}`}>
                By continuing, you agree to the Terms. Confirm you're in a supported region.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
