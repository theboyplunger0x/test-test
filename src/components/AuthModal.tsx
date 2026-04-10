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

  // Privy integration — auto-trigger on mount
  const { login: privyLogin, logout: privyLogout, authenticated: privyAuthenticated, user: privyUser, ready: privyReady } = usePrivy();
  const { wallets: privyWallets } = useWallets();

  // Auto-open Privy modal when AuthModal mounts (if not already authenticated)
  useEffect(() => {
    if (privyReady && !privyAuthenticated) {
      privyLogin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privyReady]);

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
        console.error("[auth-bootstrap]", err);
        privyLogout().catch(() => {});
        onClose(); // this clears authOpen + authLoading via handleAuthClose
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

  // Privy handles the UI. This component is invisible but alive for the
  // bootstrap useEffect to fire when privyAuthenticated flips to true.
  // If something goes wrong, show an alert.
  return null;
}
