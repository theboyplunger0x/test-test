"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, ReferralStats } from "@/lib/api";

const VerifiedBadge = ({ color }: { color: string }) => (
  <svg width="15" height="15" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline-block align-middle flex-shrink-0">
    <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.266.14-1.897-.131-.63-.437-1.208-.882-1.671-.445-.464-1.011-.79-1.638-.944-.627-.155-1.284-.127-1.895.082-.274-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.61-.209-1.265-.237-1.892-.082-.627.155-1.193.48-1.639.944-.445.463-.749 1.04-.878 1.671-.13.63-.083 1.29.141 1.897-.587.274-1.086.706-1.44 1.246-.354.54-.551 1.17-.569 1.816.018.647.215 1.276.57 1.817.354.54.852.972 1.438 1.245-.224.607-.27 1.266-.14 1.897.13.63.436 1.208.882 1.671.445.464 1.011.79 1.638.944.627.155 1.284.127 1.895-.082.274.587.704 1.086 1.245 1.44.54.354 1.17.551 1.816.569.647-.016 1.275-.213 1.815-.567s.969-.854 1.24-1.44c.61.21 1.266.238 1.893.083.626-.155 1.192-.48 1.637-.944.445-.463.749-1.041.879-1.672.13-.63.083-1.29-.141-1.896.587-.274 1.086-.706 1.44-1.246.354-.54.551-1.17.569-1.816z" fill={color}/>
    <path d="M9.611 12.851L7.29 10.53l-.927.948 3.248 3.2 6.912-6.83-.95-.943-5.962 5.946z" fill="white"/>
  </svg>
);

const TIERS = [
  {
    key: "basic",
    badge: <VerifiedBadge color="#6B7280" />,
    label: "Basic",
    cashback: "5%",
    referral: "5%",
    desc: "Connect Telegram to earn the badge",
    how: null,
  },
  {
    key: "pro",
    badge: <VerifiedBadge color="#1D9BF0" />,
    label: "Pro",
    cashback: "10%",
    referral: "10%",
    desc: "$500 volume or 3 referrals",
    how: "$500 in real bets or refer 3 people",
  },
  {
    key: "top",
    badge: <VerifiedBadge color="#F4C43B" />,
    label: "Top",
    cashback: "20%",
    referral: "20%",
    desc: "$5,000 volume or 10 referrals",
    how: "$5,000 in real bets or refer 10 people",
  },
];

export default function ReferralModal({
  dk,
  onClose,
  isLoggedIn,
  onSignIn,
}: {
  dk: boolean;
  onClose: () => void;
  isLoggedIn: boolean;
  onSignIn: () => void;
}) {
  const [stats, setStats]     = useState<ReferralStats | null>(null);
  const [copied, setCopied]   = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimDone, setClaimDone] = useState(false);

  useEffect(() => {
    if (isLoggedIn) api.getReferral().then(setStats).catch(() => {});
  }, [isLoggedIn]);

  const bg       = dk ? "bg-[#111] border-white/10"  : "bg-white border-gray-200";
  const sectionBg = dk ? "bg-white/[0.03] border-white/8" : "bg-gray-50 border-gray-200";
  const labelCls  = dk ? "text-white/30"              : "text-gray-400";
  const textCls   = dk ? "text-white"                 : "text-gray-900";
  const subCls    = dk ? "text-white/50"              : "text-gray-500";
  const divider   = dk ? "divide-white/6"             : "divide-gray-100";

  function copyLink() {
    if (!stats) return;
    navigator.clipboard.writeText(stats.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleClaim() {
    if (claiming || claimDone || !stats || Number(stats.claimable_usd) <= 0) return;
    setClaiming(true);
    try {
      await api.claimRewards();
      setClaimDone(true);
      const updated = await api.getReferral();
      setStats(updated);
      setTimeout(() => setClaimDone(false), 3000);
    } catch {}
    setClaiming(false);
  }

  const userTier = stats?.tier ?? "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 340, damping: 28 }}
        className={`relative w-full max-w-[420px] max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl z-10 ${bg}`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b backdrop-blur-sm"
          style={{ borderColor: dk ? "rgba(255,255,255,0.08)" : "#e5e7eb", background: dk ? "rgba(17,17,17,0.95)" : "rgba(255,255,255,0.95)" }}>
          <div>
            <p className={`text-[15px] font-black ${textCls}`}>Referrals & Cashback</p>
            <p className={`text-[11px] font-bold ${labelCls}`}>Earn on every trade</p>
          </div>
          <button onClick={onClose} className={`text-[18px] font-bold transition-colors ${dk ? "text-white/20 hover:text-white/60" : "text-gray-300 hover:text-gray-700"}`}>✕</button>
        </div>

        <div className="px-5 py-5 space-y-5">

          {/* How it works */}
          <div>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-3 ${labelCls}`}>How it works</p>
            <div className={`rounded-2xl border p-4 space-y-3 ${sectionBg}`}>
              <div className="flex gap-3">
                <span className="text-[18px]">💰</span>
                <div>
                  <p className={`text-[13px] font-black ${textCls}`}>Get up to 50% of fees back</p>
                  <p className={`text-[11px] font-bold ${subCls}`}>Every trade — win or lose — earns you a fee rebate based on your volume. Claim it whenever you want.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-[18px]">🔗</span>
                <div>
                  <p className={`text-[13px] font-black ${textCls}`}>Earn from referrals</p>
                  <p className={`text-[11px] font-bold ${subCls}`}>When someone signs up with your link and loses a real bet, you earn a % of their loss. Forever.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-[18px]">🏦</span>
                <div>
                  <p className={`text[13px] font-black ${textCls}`}>Credits = real money</p>
                  <p className={`text-[11px] font-bold ${subCls}`}>Cashback and referral rewards go to your real balance and can be withdrawn anytime.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Tier table */}
          <div>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-3 ${labelCls}`}>Tiers</p>
            <div className={`rounded-2xl border divide-y overflow-hidden ${sectionBg} ${divider}`}>
              {/* header */}
              <div className={`grid grid-cols-4 px-4 py-2`}>
                {["Tier", "Fee rebate", "Ref rebate", "How to reach"].map(h => (
                  <p key={h} className={`text-[10px] font-black uppercase tracking-widest ${labelCls}`}>{h}</p>
                ))}
              </div>
              {TIERS.map((t) => {
                const isActive = userTier === t.key;
                return (
                  <div key={t.key} className={`grid grid-cols-4 px-4 py-3 items-center ${isActive ? (dk ? "bg-white/5 border-l-2 border-white/25" : "bg-blue-50 border-l-2 border-blue-400") : "border-l-2 border-transparent"}`}>
                    <div className="flex items-center gap-1.5">
                      {t.badge}
                      <p className={`text-[12px] font-black ${isActive ? (dk ? "text-white" : "text-gray-900") : subCls}`}>{t.label}</p>
                    </div>
                    <p className={`text-[12px] font-black ${dk ? "text-emerald-400" : "text-emerald-600"}`}>{t.cashback}</p>
                    <p className={`text-[12px] font-black ${dk ? "text-blue-400" : "text-blue-600"}`}>{t.referral}</p>
                    <p className={`text-[11px] font-bold ${labelCls}`}>{t.how ?? "Default"}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Your stats / referral link */}
          {isLoggedIn ? (
            <div>
              <p className={`text-[10px] font-black uppercase tracking-widest mb-3 ${labelCls}`}>Your referral link</p>
              <div className={`rounded-2xl border p-4 space-y-4 ${sectionBg}`}>
                {/* Badge row */}
                <div className="flex items-center justify-between">
                  <p className={`text-[13px] font-black ${textCls}`}>Your tier</p>
                  <span className={`text-[11px] font-black px-2.5 py-1 rounded-lg flex items-center gap-1.5 ${
                    userTier === "top"    ? "bg-yellow-400 text-black" :
                    userTier === "normal" ? "bg-blue-500/20 text-blue-400" :
                    (dk ? "bg-white/10 text-white/50" : "bg-gray-200 text-gray-500")
                  }`}>
                    {userTier === "top" ? <VerifiedBadge color="#F4C43B" /> : userTier === "normal" ? <VerifiedBadge color="#1D9BF0" /> : null}
                    {userTier === "top" ? "TOP" : userTier === "normal" ? "NORMAL" : "NO TIER"}
                  </span>
                </div>

                {/* Stats row */}
                <div className={`grid grid-cols-3 divide-x rounded-xl border ${dk ? "border-white/6 divide-white/6" : "border-gray-100 divide-gray-100"}`}>
                  {[
                    { label: "Referred", value: stats ? String(stats.referred_count) : "—" },
                    { label: "Ref earned", value: stats ? `$${Number(stats.total_referral_usd).toFixed(2)}` : "—" },
                    { label: "Cashback", value: stats ? `$${Number(stats.total_cashback_usd).toFixed(2)}` : "—" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex flex-col items-center py-3">
                      <p className={`text-[14px] font-black ${textCls}`}>{value}</p>
                      <p className={`text-[10px] font-bold ${labelCls}`}>{label}</p>
                    </div>
                  ))}
                </div>

                {/* Claim button — always visible */}
                {(() => {
                  const claimable = stats ? Number(stats.claimable_usd) : 0;
                  const hasRewards = claimable > 0;
                  return (
                    <div className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-all ${
                      hasRewards
                        ? (dk ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200")
                        : (dk ? "bg-white/[0.02] border-white/6" : "bg-gray-50 border-gray-100")
                    }`}>
                      <div>
                        <p className={`text-[10px] font-black uppercase tracking-widest ${hasRewards ? (dk ? "text-emerald-400/70" : "text-emerald-600/70") : labelCls}`}>Pending rewards</p>
                        <p className={`text-[18px] font-black ${hasRewards ? (dk ? "text-emerald-400" : "text-emerald-600") : subCls}`}>
                          {stats ? `$${claimable.toFixed(2)}` : "—"}
                        </p>
                      </div>
                      <button onClick={handleClaim} disabled={claiming || !hasRewards}
                        className={`px-5 py-2.5 rounded-xl text-[13px] font-black transition-all ${
                          claimDone             ? "bg-emerald-500 text-white" :
                          claiming              ? "bg-emerald-500/40 text-white/50 cursor-not-allowed" :
                          hasRewards            ? "bg-emerald-500 text-white hover:bg-emerald-400" :
                          dk                    ? "bg-white/5 text-white/20 cursor-not-allowed" :
                                                  "bg-gray-100 text-gray-300 cursor-not-allowed"
                        }`}>
                        {claimDone ? "✓ Claimed!" : claiming ? "Claiming..." : "Claim"}
                      </button>
                    </div>
                  );
                })()}

                {/* Copy link */}
                <div>
                  <p className={`text-[11px] font-bold mb-1.5 ${labelCls}`}>Share your link</p>
                  <div className="flex gap-2">
                    <div className={`flex-1 px-3 py-2 rounded-xl text-[11px] font-bold truncate border ${dk ? "bg-white/5 border-white/8 text-white/40" : "bg-white border-gray-200 text-gray-400"}`}>
                      {stats?.link ?? "—"}
                    </div>
                    <button onClick={copyLink}
                      className={`px-4 py-2 rounded-xl text-[12px] font-black transition-all ${copied ? "bg-emerald-500 text-white" : (dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-black")}`}>
                      {copied ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className={`rounded-2xl border p-5 text-center ${sectionBg}`}>
              <p className={`text-[14px] font-black mb-1 ${textCls}`}>Sign in to get your link</p>
              <p className={`text-[12px] font-bold mb-4 ${labelCls}`}>Create an account to start earning cashback and referral rewards.</p>
              <button onClick={() => { onClose(); onSignIn(); }}
                className={`px-6 py-2.5 rounded-xl text-[13px] font-black transition-all ${dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-black"}`}>
                Sign In / Register
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
