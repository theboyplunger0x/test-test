"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, Position, ReferralStats, Order as PendingOrder } from "../lib/api";

// ─── local display type ────────────────────────────────────────────────────────

type OrderStatus = "open" | "live" | "won" | "lost" | "cancelled";

type Order = {
  id: string;
  symbol: string;
  direction: "long" | "short";
  amount: number;
  timeframe: string;
  status: OrderStatus;
  myPool: number;
  otherPool: number;
  entryPrice: number;
  openedAt: number;
  expiresAt: number;
  isOpener: boolean;
  isPaper: boolean;
  sweepId: string | null;
};

// Sweep group — multiple positions from the same sweep_id shown as one row
type SweepGroup = {
  sweepId: string;
  symbol: string;
  timeframe: string;
  direction: "long" | "short";
  totalAmount: number;
  status: OrderStatus;
  expiresAt: number;
  isPaper: boolean;
  positions: Order[];
};

// ─── helpers ───────────────────────────────────────────────────────────────────

function positionToOrder(p: Position): Order {
  const myPool   = parseFloat(p.side === "long" ? p.long_pool  : p.short_pool);
  const otherPool = parseFloat(p.side === "long" ? p.short_pool : p.long_pool);

  let status: OrderStatus;
  if (p.market_status === "resolved") {
    status = p.winner_side === p.side ? "won" : "lost";
  } else if (p.market_status === "cancelled") {
    status = "cancelled";
  } else {
    status = p.market_status as "open" | "live";
  }

  return {
    id:         p.id,
    symbol:     p.symbol,
    direction:  p.side,
    amount:     parseFloat(p.amount_usd),
    timeframe:  p.timeframe,
    status,
    myPool,
    otherPool,
    entryPrice: parseFloat(p.entry_price),
    openedAt:   new Date(p.placed_at).getTime(),
    expiresAt:  new Date(p.closes_at).getTime(),
    isOpener:   p.opener_id === p.user_id,
    isPaper:    p.is_paper ?? false,
    sweepId:    p.sweep_id ?? null,
  };
}

function groupBySweep(orders: Order[]): { sweeps: SweepGroup[]; solo: Order[] } {
  // Group by sweep_id first, then by proximity (symbol+direction+paper within 60s) for multi-tf sweeps
  const sweepMap = new Map<string, Order[]>();
  const noSweep: Order[] = [];
  for (const o of orders) {
    if (o.sweepId) {
      const arr = sweepMap.get(o.sweepId) ?? [];
      arr.push(o);
      sweepMap.set(o.sweepId, arr);
    } else {
      noSweep.push(o);
    }
  }

  // Merge sweep groups that share symbol+direction+paper and were opened within 60s of each other
  const mergedGroups: Order[][] = [];
  for (const [, positions] of sweepMap) {
    const p = positions[0];
    const merged = mergedGroups.find(g => {
      const gp = g[0];
      if (gp.symbol !== p.symbol || gp.direction !== p.direction || gp.isPaper !== p.isPaper) return false;
      return positions.some(pos => g.some(ex => Math.abs(pos.openedAt - ex.openedAt) < 60_000));
    });
    if (merged) {
      merged.push(...positions);
    } else {
      mergedGroups.push([...positions]);
    }
  }

  const sweeps: SweepGroup[] = [];
  for (const positions of mergedGroups) {
    if (positions.length === 1) {
      noSweep.push(positions[0]);
      continue;
    }
    const latestExpiry = Math.max(...positions.map((p: Order) => p.expiresAt));
    const tfs = [...new Set(positions.map((p: Order) => p.timeframe))];
    sweeps.push({
      sweepId:     positions[0].sweepId ?? positions[0].id,
      symbol:      positions[0].symbol,
      timeframe:   tfs.length > 1 ? "multi-tf" : tfs[0],
      direction:   positions[0].direction,
      totalAmount: positions.reduce((s: number, p: Order) => s + p.amount, 0),
      status:      positions[0].status,
      expiresAt:   latestExpiry,
      isPaper:     positions[0].isPaper,
      positions,
    });
  }
  return { sweeps, solo: noSweep };
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function calcPayout(o: Order): number {
  if (o.otherPool === 0) return o.amount;
  return o.amount * (1 + (o.otherPool * 0.95) / o.myPool);
}

// ─── withdraw modal ────────────────────────────────────────────────────────────

function WithdrawModal({
  balance,
  dk,
  onClose,
  onSuccess,
}: {
  balance: number;
  dk: boolean;
  onClose: () => void;
  onSuccess: (newBalance: string) => void;
}) {
  const [amount, setAmount]     = useState("");
  const [address, setAddress]   = useState("");
  const [chain, setChain]       = useState<"base" | "sol">("base");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const inputCls = dk
    ? "bg-white/5 border-white/10 text-white placeholder:text-white/20"
    : "bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400";

  async function submit() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return setError("Enter a valid amount");
    if (amt < 5)          return setError("Minimum withdrawal is $5");
    if (amt > balance)    return setError("Insufficient balance");
    if (!address)         return setError("Enter a wallet address");

    setLoading(true);
    setError(null);
    try {
      const res = await api.withdraw(amt, chain, address);
      onSuccess(res.new_balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`absolute inset-0 ${dk ? "bg-black/60" : "bg-black/30"}`} onClick={onClose} />
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        className={`relative w-full max-w-md rounded-t-3xl p-6 space-y-4 ${dk ? "bg-[#0f0f0f] border-t border-white/8" : "bg-white border-t border-gray-200"}`}
      >
        <div className="flex items-center justify-between">
          <p className={`text-[15px] font-black ${dk ? "text-white" : "text-gray-900"}`}>Withdraw</p>
          <button onClick={onClose} className={`text-[11px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>✕ close</button>
        </div>

        {/* chain selector */}
        <div className="flex gap-2">
          {(["base", "sol"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setChain(c)}
              className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
                chain === c
                  ? dk ? "bg-white text-black" : "bg-gray-900 text-white"
                  : dk ? "bg-white/5 text-white/40" : "bg-gray-100 text-gray-400"
              }`}
            >
              {c === "base" ? "Base (USDC)" : "Solana (USDC)"}
            </button>
          ))}
        </div>

        {/* amount */}
        <div>
          <p className={`text-[10px] font-bold mb-1.5 ${dk ? "text-white/30" : "text-gray-400"}`}>Amount (USD)</p>
          <div className="relative">
            <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold ${dk ? "text-white/40" : "text-gray-400"}`}>$</span>
            <input
              type="number"
              min={5}
              max={balance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={`w-full pl-7 pr-16 py-3 rounded-xl border text-[14px] font-black outline-none ${inputCls}`}
            />
            <button
              onClick={() => setAmount(balance.toFixed(2))}
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black ${dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"}`}
            >
              MAX
            </button>
          </div>
          <p className={`text-[10px] mt-1 ${dk ? "text-white/20" : "text-gray-400"}`}>
            Available: ${balance.toFixed(2)} · Min $5
          </p>
        </div>

        {/* address */}
        <div>
          <p className={`text-[10px] font-bold mb-1.5 ${dk ? "text-white/30" : "text-gray-400"}`}>
            {chain === "base" ? "EVM Wallet Address" : "Solana Wallet Address"}
          </p>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={chain === "base" ? "0x..." : "So1..."}
            className={`w-full px-3 py-3 rounded-xl border text-[12px] font-mono outline-none ${inputCls}`}
          />
        </div>

        {error && (
          <p className="text-[11px] font-bold text-red-400">{error}</p>
        )}

        <button
          onClick={submit}
          disabled={loading}
          className={`w-full py-3.5 rounded-xl text-[13px] font-black transition-all ${
            loading
              ? dk ? "bg-white/10 text-white/30" : "bg-gray-100 text-gray-400"
              : dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-gray-700"
          }`}
        >
          {loading ? "Processing…" : "Request Withdrawal"}
        </button>
        <p className={`text-center text-[10px] ${dk ? "text-white/20" : "text-gray-400"}`}>
          Processed within 24h during beta.
        </p>
      </motion.div>
    </motion.div>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

function fireNotification(title: string, body: string) {
  if (typeof window === "undefined" || Notification.permission !== "granted") return;
  try { new Notification(title, { body, icon: "/favicon.ico" }); } catch {}
}

const SEAL = "M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.266.14-1.897-.131-.63-.437-1.208-.882-1.671-.445-.464-1.011-.79-1.638-.944-.627-.155-1.284-.127-1.895.082-.274-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.61-.209-1.265-.237-1.892-.082-.627.155-1.193.48-1.639.944-.445.463-.749 1.04-.878 1.671-.13.63-.083 1.29.141 1.897-.587.274-1.086.706-1.44 1.246-.354.54-.551 1.17-.569 1.816.018.647.215 1.276.57 1.817.354.54.852.972 1.438 1.245-.224.607-.27 1.266-.14 1.897.13.63.436 1.208.882 1.671.445.464 1.011.79 1.638.944.627.155 1.284.127 1.895-.082.274.587.704 1.086 1.245 1.44.54.354 1.17.551 1.816.569.647-.016 1.275-.213 1.815-.567s.969-.854 1.24-1.44c.61.21 1.266.238 1.893.083.626-.155 1.192-.48 1.637-.944.445-.463.749-1.041.879-1.672.13-.63.083-1.29-.141-1.896.587-.274 1.086-.706 1.44-1.246.354-.54.551-1.17.569-1.816z";
const CHECK = "M9.611 12.851L7.29 10.53l-.927.948 3.248 3.2 6.912-6.83-.95-.943-5.962 5.946z";

function TierBadge({ tier, tgUsername }: { tier: string; tgUsername?: string }) {
  const tip = (label: string) => (
    <span className="pointer-events-none absolute left-full ml-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/90 px-2 py-1 text-[10px] font-bold text-white opacity-0 group-hover/badge:opacity-100 transition-opacity duration-150 z-50">
      {label}
    </span>
  );
  if (tier === "elite") return (
    <span className="relative group/badge inline-flex items-center shrink-0">
      <svg width="14" height="14" viewBox="0 0 22 22" fill="none" className="inline-block align-middle"><path d={SEAL} fill="#27272A"/><path d={CHECK} fill="white"/></svg>
      {tip("Not for everyone.")}
    </span>
  );
  if (tier === "top") return (
    <span className="relative group/badge inline-flex items-center shrink-0">
      <svg width="14" height="14" viewBox="0 0 22 22" fill="none" className="inline-block align-middle"><path d={SEAL} fill="#F4C43B"/><path d={CHECK} fill="white"/></svg>
      {tip("Top · 20% fee rebate")}
    </span>
  );
  if (tier === "pro") return (
    <span className="relative group/badge inline-flex items-center shrink-0">
      <svg width="14" height="14" viewBox="0 0 22 22" fill="none" className="inline-block align-middle"><path d={SEAL} fill="#1D9BF0"/><path d={CHECK} fill="white"/></svg>
      {tip("Pro · 10% fee rebate")}
    </span>
  );
  if ((tier === "basic" || tier === "") && tgUsername) return (
    <span className="relative group/badge inline-flex items-center shrink-0">
      <svg width="14" height="14" viewBox="0 0 22 22" fill="none" className="inline-block align-middle"><path d={SEAL} fill="#6B7280"/><path d={CHECK} fill="white"/></svg>
      {tip("Basic · Telegram connected")}
    </span>
  );
  return null;
}

const PencilIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

function ProfileHeader({ dk, onViewProfile, onUserUpdate }: { dk: boolean; onViewProfile?: () => void; onUserUpdate?: () => void }) {
  const [username, setUsername]           = useState<string | null>(null);
  const [tier, setTier]                   = useState<string | undefined>(undefined);
  const [tgUsername, setTgUsername]       = useState<string | undefined>(undefined);
  const [avatar, setAvatar]               = useState("");
  const [bio, setBio]                     = useState("");
  const [editingBio, setEditingBio]       = useState(false);
  const [bioInput, setBioInput]           = useState("");
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput]   = useState("");
  const [usernameError, setUsernameError]   = useState("");
  const [saving, setSaving]               = useState(false);
  const fileInputRef                      = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    api.me().then(u => {
      setUsername(u.username);
      setTier(u.tier);
      setTgUsername(u.telegram_username);
      setAvatar(u.avatar_url ?? "");
      setBio(u.bio ?? "");
      setBioInput(u.bio ?? "");
    }).catch(() => {});
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("Image must be smaller than 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setSaving(true);
      try {
        await api.updateProfile(dataUrl, bio);
        setAvatar(dataUrl);
        onUserUpdate?.();
      } catch (err: any) {
        alert(err.message ?? "Failed to upload avatar");
      }
      setSaving(false);
    };
    reader.readAsDataURL(file);
  }

  async function saveBio() {
    setSaving(true);
    try {
      await api.updateProfile(avatar, bioInput);
      setBio(bioInput);
      setEditingBio(false);
    } catch (err: any) {
      alert(err.message ?? "Failed to save bio");
    }
    setSaving(false);
  }

  if (!username) return null;

  const muted    = dk ? "text-white/40"  : "text-gray-400";
  const strong   = dk ? "text-white"     : "text-gray-900";
  const inputCls = dk
    ? "bg-white/5 border-white/10 text-white placeholder:text-white/20"
    : "bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400";

  const SEAL  = "M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.266.14-1.897-.131-.63-.437-1.208-.882-1.671-.445-.464-1.011-.79-1.638-.944-.627-.155-1.284-.127-1.895.082-.274-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.61-.209-1.265-.237-1.892-.082-.627.155-1.193.48-1.639.944-.445.463-.749 1.04-.878 1.671-.13.63-.083 1.29.141 1.897-.587.274-1.086.706-1.44 1.246-.354.54-.551 1.17-.569 1.816.018.647.215 1.276.57 1.817.354.54.852.972 1.438 1.245-.224.607-.27 1.266-.14 1.897.13.63.436 1.208.882 1.671.445.464 1.011.79 1.638.944.627.155 1.284.127 1.895-.082.274.587.704 1.086 1.245 1.44.54.354 1.17.551 1.816.569.647-.016 1.275-.213 1.815-.567s.969-.854 1.24-1.44c.61.21 1.266.238 1.893.083.626-.155 1.192-.48 1.637-.944.445-.463.749-1.041.879-1.672.13-.63.083-1.29-.141-1.896.587-.274 1.086-.706 1.44-1.246.354-.54.551-1.17.569-1.816z";
  const CHECK = "M9.611 12.851L7.29 10.53l-.927.948 3.248 3.2 6.912-6.83-.95-.943-5.962 5.946z";

  return (
    <div className={`flex flex-col items-center pt-5 pb-4 px-5 border-b ${dk ? "border-white/5" : "border-gray-100"}`}>
      {/* Avatar — click to upload from computer */}
      <div className="relative group mb-3 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
        {avatar ? (
          <img src={avatar} alt="" className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className={`w-16 h-16 rounded-full flex items-center justify-center text-[26px] font-black ${dk ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-400"}`}>
            {saving ? "…" : username.charAt(0).toUpperCase()}
          </div>
        )}
        <div className={`absolute inset-0 rounded-full flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity ${muted}`}>
          {saving ? <span className="text-[11px]">…</span> : <PencilIcon />}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>

      {/* Username + tier */}
      <div className="flex items-center gap-1.5 mb-2">
        {editingUsername ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={usernameInput}
              onChange={e => { setUsernameInput(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "")); setUsernameError(""); }}
              maxLength={20}
              className={`text-[15px] font-black px-2 py-1 rounded-lg outline-none w-[160px] ${dk ? "bg-white/10 text-white" : "bg-gray-100 text-gray-900"}`}
              onKeyDown={async e => {
                if (e.key === "Enter") {
                  try {
                    const res = await api.updateUsername(usernameInput);
                    setUsername(res.username);
                    setEditingUsername(false);
                    onUserUpdate?.();
                  } catch (err: any) { setUsernameError(err.message); }
                }
                if (e.key === "Escape") setEditingUsername(false);
              }}
            />
            <button onClick={() => setEditingUsername(false)} className={`text-[11px] font-bold ${muted}`}>✕</button>
          </div>
        ) : (
          <button onClick={onViewProfile} className={`text-[15px] font-black ${strong} cursor-pointer hover:opacity-70 transition-opacity`}>{username}</button>
        )}
        {!editingUsername && (
          <button onClick={() => { setUsernameInput(username); setUsernameError(""); setEditingUsername(true); }}
            className={`${muted} hover:opacity-60 transition-opacity`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        )}
        {tier && <TierBadge tier={tier} tgUsername={tgUsername} />}
      </div>
      {usernameError && <p className={`text-[10px] font-bold mb-1 ${dk ? "text-red-400" : "text-red-500"}`}>{usernameError}</p>}

      {/* Bio */}
      {editingBio ? (
        <div className="w-full space-y-2">
          <textarea
            value={bioInput}
            onChange={e => setBioInput(e.target.value)}
            placeholder="Write a short bio..."
            maxLength={120}
            rows={2}
            autoFocus
            className={`w-full rounded-xl border px-3 py-2 text-[12px] outline-none resize-none text-center ${inputCls}`}
          />
          <div className="flex gap-2">
            <button onClick={saveBio} disabled={saving} className={`flex-1 py-1.5 rounded-lg text-[11px] font-black ${dk ? "bg-white text-black" : "bg-gray-900 text-white"}`}>
              {saving ? "…" : "Save"}
            </button>
            <button onClick={() => { setEditingBio(false); setBioInput(bio); }} className={`flex-1 py-1.5 rounded-lg text-[11px] font-black ${dk ? "bg-white/5 text-white/50" : "bg-gray-100 text-gray-500"}`}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="group flex items-center gap-1.5 cursor-pointer" onClick={() => setEditingBio(true)}>
          <span className={`text-[12px] text-center ${bio ? muted : (dk ? "text-white/20" : "text-gray-300")}`}>
            {bio || "Add a bio..."}
          </span>
          <span className={`opacity-0 group-hover:opacity-100 transition-opacity ${muted}`}><PencilIcon /></span>
        </div>
      )}
    </div>
  );
}

export default function OrdersView({ dk, balance: balanceProp, notificationsEnabled, xUsername, telegramUsername, onDisconnectX, onDisconnectTelegram, onTelegramConnect, onViewOwnProfile, onUserUpdate, onViewToken, paperMode = false, useExternalBalance = false, rewardBalance, onClaimOnChain, onOpenWalletDrawer }: { dk: boolean; balance?: string; notificationsEnabled?: boolean; xUsername?: string; telegramUsername?: string; onDisconnectX?: () => void; onDisconnectTelegram?: () => void; onTelegramConnect?: () => void; onViewOwnProfile?: () => void; onUserUpdate?: () => void; onViewToken?: (symbol: string) => void; paperMode?: boolean; useExternalBalance?: boolean; rewardBalance?: string; onClaimOnChain?: () => Promise<void>; /** Open the wallet drawer for vault deposit/withdraw. */ onOpenWalletDrawer?: () => void; }) {
  const [orders, setOrders]           = useState<Order[]>([]);
  const [balance, setBalance]         = useState<number>(parseFloat(balanceProp ?? "0") || 0);
  const [loading, setLoading]         = useState(true);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [tick, setTick]               = useState(0);
  const prevStatusRef                 = useRef<Map<string, OrderStatus>>(new Map());
  const [referral, setReferral]       = useState<ReferralStats | null>(null);
  const [claiming, setClaiming]       = useState(false);
  const [claimDone, setClaimDone]     = useState(false);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [cancellingOrder, setCancellingOrder] = useState<string | null>(null);
  const [orderHistory, setOrderHistory]   = useState<PendingOrder[]>([]);
  const [showOrderHistory, setShowOrderHistory] = useState(false);

  // sync balance prop changes (from parent auth refresh)
  useEffect(() => {
    const val = parseFloat(balanceProp ?? "0");
    if (!isNaN(val)) setBalance(val);
  }, [balanceProp]);

  const fetchPortfolio = useCallback(async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) { setLoading(false); return; }
    try {
      const data = await api.portfolio();
      if (!useExternalBalance) setBalance(parseFloat(data.balance) || 0);
      const newOrders = data.positions.map(positionToOrder);
      // Fire notifications for newly resolved positions
      if (notificationsEnabled) {
        for (const o of newOrders) {
          const prev = prevStatusRef.current.get(o.id);
          if (prev && prev !== o.status && (o.status === "won" || o.status === "lost")) {
            const payout = calcPayout(o);
            fireNotification(
              o.status === "won" ? `You won $${payout.toFixed(2)}! 🎉` : `Position closed ❌`,
              `$${o.symbol} ${o.direction.toUpperCase()} ${o.timeframe} — ${o.status === "won" ? `+$${(payout - o.amount).toFixed(2)} profit` : `-$${o.amount} loss`}`
            );
          }
        }
      }
      prevStatusRef.current = new Map(newOrders.map((o) => [o.id, o.status]));
      setOrders(newOrders);
    } catch {
      // not authed or network error — leave empty
    } finally {
      setLoading(false);
    }
  }, [notificationsEnabled]);

  // Smart polling: 5s when any active position has expired (awaiting resolution), else 30s
  const ordersRef = useRef<Order[]>([]);
  ordersRef.current = orders;

  useEffect(() => {
    fetchPortfolio();
    let timer: ReturnType<typeof setTimeout>;

    function schedule() {
      const hasPending = ordersRef.current.some(
        (o) => (o.status === "open" || o.status === "live") && o.expiresAt <= Date.now()
      );
      timer = setTimeout(async () => {
        await fetchPortfolio();
        schedule();
      }, hasPending ? 5_000 : 30_000);
    }

    schedule();
    return () => clearTimeout(timer);
  }, [fetchPortfolio]);

  // countdown ticker
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  // fetch referral/tier info
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    api.getReferral().then(setReferral).catch(() => {});
  }, []);

  // fetch pending orders from order book
  const fetchPendingOrders = useCallback(async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    api.getMyOrders().then(setPendingOrders).catch(() => {});
  }, []);

  useEffect(() => { fetchPendingOrders(); }, [fetchPendingOrders]);

  // lazy-load order history when section is opened
  useEffect(() => {
    if (!showOrderHistory) return;
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    api.getMyOrders(true).then(setOrderHistory).catch(() => {});
  }, [showOrderHistory]);

  async function cancelPendingOrder(id: string) {
    setCancellingOrder(id);
    try {
      await api.cancelOrder(id);
      setPendingOrders(prev => prev.filter(o => o.id !== id));
    } catch (e: any) {
      alert(e.message ?? "Cancel failed");
    } finally {
      setCancellingOrder(null);
    }
  }

  async function toggleAutoReopen(id: string, current: boolean) {
    try {
      const { auto_reopen } = await api.setOrderAutoReopen(id, !current);
      setPendingOrders(prev => prev.map(o => o.id === id ? { ...o, auto_reopen } : o));
    } catch { /* ignore */ }
  }

  async function handleClaim() {
    const onChainRewards = parseFloat(rewardBalance || "0");
    const offChainRewards = referral ? Number(referral.claimable_usd) : 0;
    const totalClaimable = onChainRewards + offChainRewards;
    if (claiming || claimDone || totalClaimable <= 0) return;
    setClaiming(true);
    try {
      // Claim on-chain rewards first (from vault contract)
      if (onChainRewards > 0 && onClaimOnChain) {
        await onClaimOnChain();
      }
      // Claim off-chain rewards (legacy DB system)
      if (offChainRewards > 0) {
        await api.claimRewards();
      }
      setClaimDone(true);
      const updated = await api.getReferral();
      setReferral(updated);
      if (!useExternalBalance) {
        const data = await api.portfolio();
        setBalance(parseFloat(data.balance) || 0);
      }
      setTimeout(() => setClaimDone(false), 3000);
    } catch (e: any) {
      alert(e.message ?? "Claim failed");
    }
    setClaiming(false);
  }

  const modeOrders = orders.filter((o) => o.isPaper === paperMode);

  const active  = modeOrders.filter((o) => o.status === "open" || o.status === "live");
  const settled = modeOrders.filter((o) => o.status === "won"  || o.status === "lost");

  const { sweeps: activeSweeps, solo: activeSolo } = groupBySweep(active);

  const grossWon    = settled.filter((o) => o.status === "won").reduce((s, o) => s + calcPayout(o), 0);
  const totalStaked = settled.reduce((s, o) => s + o.amount, 0);
  const pnl         = grossWon - totalStaked;

  // theme tokens
  const T = {
    muted:      dk ? "text-white/30"  : "text-gray-400",
    normal:     dk ? "text-white/70"  : "text-gray-700",
    strong:     dk ? "text-white"     : "text-gray-900",
    sectionLbl: dk ? "text-white/20"  : "text-gray-400",
    statBox:    dk ? "bg-white/4 border-white/6"   : "bg-gray-50 border-gray-200",
    cardBase:   dk ? "border-white/8 bg-white/[0.02]"  : "border-gray-200 bg-white",
    cardWon:    dk ? "border-emerald-500/20 bg-emerald-500/[0.04]" : "border-emerald-200 bg-emerald-50/50",
    cardLost:   dk ? "border-red-500/20 bg-red-500/[0.04]"        : "border-red-200 bg-red-50/50",
    poolTrack:  dk ? "bg-white/5" : "bg-gray-100",
    divider:    dk ? "border-white/5" : "border-gray-100",
  };

  return (
    <>
      <ProfileHeader dk={dk} onViewProfile={onViewOwnProfile} onUserUpdate={onUserUpdate} />
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

        {/* Balance + P&L */}
        <div className="flex gap-2">
          <div className={`flex-1 rounded-2xl border px-4 py-3 ${T.statBox}`}>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${T.sectionLbl}`}>Balance</p>
            <p className={`text-[22px] font-black ${T.strong}`}>
              ${balance.toFixed(2)}
            </p>
          </div>
          <div className={`flex-1 rounded-2xl border px-4 py-3 ${T.statBox}`}>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${T.sectionLbl}`}>All-time P&L</p>
            <p className={`text-[22px] font-black ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {settled.length === 0 ? "—" : `${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}`}
            </p>
          </div>
        </div>

        {/* Tier + Claim */}
        {referral && (() => {
          const offChain = Number(referral.claimable_usd);
          const onChain = parseFloat(rewardBalance || "0");
          const claimable = offChain + onChain;
          const hasRewards = claimable > 0;
          const tierLabel = referral.tier === "elite" ? "Elite" : referral.tier === "top" ? "Top" : referral.tier === "pro" ? "Pro" : "Basic";
          const rebate    = referral.tier === "elite" ? "25% fee rebate" : referral.tier === "top" ? "20% fee rebate" : referral.tier === "pro" ? "10% fee rebate" : "0% fee rebate";
          return (
            <div className={`rounded-2xl border px-4 py-3 transition-all ${
              hasRewards
                ? dk ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200"
                : T.statBox
            }`}>
              {/* tier row */}
              <div className="flex items-center gap-1.5 mb-3">
                <TierBadge tier={referral.tier} tgUsername={telegramUsername} />
                <span className={`text-[11px] font-black ${T.strong}`}>{tierLabel}</span>
                <span className={`text-[10px] ${T.muted}`}>· {rebate}</span>
              </div>
              {/* pending rewards + claim */}
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${
                    hasRewards ? dk ? "text-emerald-400/70" : "text-emerald-600/70" : T.muted
                  }`}>Pending rewards</p>
                  <p className={`text-[22px] font-black ${hasRewards ? dk ? "text-emerald-400" : "text-emerald-600" : T.muted}`}>
                    ${claimable.toFixed(2)}
                  </p>
                </div>
                <button
                  onClick={handleClaim}
                  disabled={claiming || !hasRewards}
                  className={`px-5 py-2.5 rounded-xl text-[13px] font-black transition-all ${
                    claimDone   ? "bg-emerald-500 text-white" :
                    claiming    ? "bg-emerald-500/40 text-white/50 cursor-not-allowed" :
                    hasRewards  ? "bg-emerald-500 hover:bg-emerald-400 text-white" :
                    dk          ? "bg-white/5 text-white/20 cursor-not-allowed" :
                                  "bg-gray-100 text-gray-300 cursor-not-allowed"
                  }`}
                >
                  {claimDone ? "✓ Claimed!" : claiming ? "Claiming..." : "Claim"}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Withdraw button */}
        <button
          onClick={() => {
            if (onOpenWalletDrawer && useExternalBalance) {
              // Real mode: open wallet drawer with vault withdraw
              onOpenWalletDrawer();
            } else {
              setShowWithdraw(true);
            }
          }}
          className={`w-full py-3 rounded-2xl text-[12px] font-black uppercase tracking-widest border transition-all ${
            dk
              ? "border-white/8 bg-white/[0.02] text-white/50 hover:bg-white/6 hover:text-white/80"
              : "border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100"
          }`}
        >
          Withdraw →
        </button>

        {/* Connect Telegram */}
        {telegramUsername ? (
          <div className={`group w-full py-3 px-4 rounded-2xl text-[12px] font-black border flex items-center justify-between cursor-pointer ${
            dk ? "border-white/8 bg-white/[0.02] text-white/60 hover:border-red-500/30 hover:bg-red-500/5" : "border-gray-200 bg-gray-50 text-gray-500 hover:border-red-200 hover:bg-red-50"
          }`} onClick={onDisconnectTelegram}>
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.247l-2.01 9.468c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.48 14.48l-2.95-.924c-.64-.203-.653-.64.136-.953l11.52-4.443c.537-.194 1.006.13.836.952l-.46-.865z"/>
              </svg>
              @{telegramUsername}
            </span>
            <span className={`text-[11px] font-bold transition-colors group-hover:text-red-400 ${dk ? "text-white/30" : "text-gray-400"}`}>
              <span className="group-hover:hidden">connected ✓</span>
              <span className="hidden group-hover:inline">disconnect</span>
            </span>
          </div>
        ) : (
          <button
            onClick={async () => {
              try {
                const { token } = await api.tgInitLink();
                window.open(`https://t.me/FUDmarkets_BOT?start=link_${token}`, "_blank");
                onTelegramConnect?.();
              } catch (e: any) {
                alert(e.message ?? "Error connecting Telegram");
              }
            }}
            className={`w-full py-3 rounded-2xl text-[12px] font-black uppercase tracking-widest border transition-all flex items-center justify-center gap-2 ${
              dk
                ? "border-sky-500/30 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20"
                : "border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.247l-2.01 9.468c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.48 14.48l-2.95-.924c-.64-.203-.653-.64.136-.953l11.52-4.443c.537-.194 1.006.13.836.952l-.46-.865z"/>
            </svg>
            Connect Telegram
          </button>
        )}

        {/* Connect X */}
        {xUsername ? (
          <div className={`group w-full py-3 px-4 rounded-2xl text-[12px] font-black border flex items-center justify-between cursor-pointer ${
            dk ? "border-white/8 bg-white/[0.02] text-white/60 hover:border-red-500/30 hover:bg-red-500/5" : "border-gray-200 bg-gray-50 text-gray-500 hover:border-red-200 hover:bg-red-50"
          }`} onClick={onDisconnectX}>
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              @{xUsername}
            </span>
            <span className={`text-[11px] font-bold transition-colors group-hover:text-red-400 ${dk ? "text-white/30" : "text-gray-400"}`}>
              <span className="group-hover:hidden">connected ✓</span>
              <span className="hidden group-hover:inline">disconnect</span>
            </span>
          </div>
        ) : (
          <button
            onClick={async () => {
              try {
                const { url } = await api.getXAuthUrl();
                window.location.href = url;
              } catch (e: any) {
                alert(e.message ?? "Error connecting X");
              }
            }}
            className={`w-full py-3 rounded-2xl text-[12px] font-black uppercase tracking-widest border transition-all flex items-center justify-center gap-2 ${
              dk
                ? "border-white/20 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                : "border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            Connect X
          </button>
        )}

        {/* Pending Orders (order book intents) */}
        {pendingOrders.length > 0 && (
          <div>
            <p className={`text-[10px] font-black tracking-widest uppercase mb-3 ${T.sectionLbl}`}>
              Pending Orders · <span className={T.muted}>{pendingOrders.length}</span>
            </p>
            <div className="space-y-2">
              {pendingOrders.map(o => (
                <div key={o.id} className={`flex items-center justify-between rounded-2xl border px-3 py-2.5 ${T.cardBase}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-[11px] font-black ${o.side === "short" ? "text-red-400" : "text-emerald-400"}`}>
                      {o.side.toUpperCase()}
                    </span>
                    <span className={`text-[12px] font-bold truncate ${T.strong}`}>{o.symbol}</span>
                    <span className={`text-[11px] font-mono ${T.muted}`}>{o.timeframe}</span>
                    {o.status === "partially_filled" && (
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${dk ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-600"}`}>
                        partial
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[12px] font-black ${T.normal}`}>
                      ${parseFloat(o.remaining_amount).toFixed(0)}
                    </span>
                    <button
                      onClick={() => toggleAutoReopen(o.id, o.auto_reopen)}
                      title={o.auto_reopen ? "Auto-reopen ON — click to disable" : "Auto-reopen OFF — click to enable"}
                      className={`text-[13px] px-1.5 py-0.5 rounded-lg transition-colors ${
                        o.auto_reopen
                          ? dk ? "text-white/70 bg-white/10 hover:bg-white/5" : "text-gray-700 bg-gray-200 hover:bg-gray-100"
                          : dk ? "text-white/20 bg-transparent hover:text-white/50" : "text-gray-300 bg-transparent hover:text-gray-500"
                      }`}
                    >↻</button>
                    <button
                      onClick={() => cancelPendingOrder(o.id)}
                      disabled={cancellingOrder === o.id}
                      className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-colors
                        ${dk ? "bg-white/6 text-white/40 hover:bg-red-500/15 hover:text-red-400"
                              : "bg-gray-100 text-gray-400 hover:bg-red-50 hover:text-red-500"}`}
                    >
                      {cancellingOrder === o.id ? "…" : "cancel"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Open positions */}
        <div>
          <p className={`text-[10px] font-black tracking-widest uppercase mb-3 ${T.sectionLbl}`}>
            Open Positions {active.length > 0 && <span className={`ml-1 ${T.muted}`}>· {active.length}</span>}
          </p>
          {loading ? (
            <p className={`text-[13px] font-bold ${T.muted}`}>Loading…</p>
          ) : active.length === 0 ? (
            <p className={`text-[13px] font-bold ${T.muted}`}>No open positions.</p>
          ) : (
            <div className="space-y-2">
              {activeSweeps.map(g => (
                <SweepGroupRow key={g.sweepId} group={g} tick={tick} dk={dk} T={T} />
              ))}
              {activeSolo.map((o) => <PositionRow key={o.id} order={o} tick={tick} dk={dk} T={T} onViewToken={onViewToken} />)}
            </div>
          )}
        </div>

        {/* History */}
        {settled.length > 0 && (
          <div>
            <p className={`text-[10px] font-black tracking-widest uppercase mb-3 ${T.sectionLbl}`}>History</p>
            <div className="space-y-2">
              {settled.map((o) => <PositionRow key={o.id} order={o} tick={tick} dk={dk} T={T} onViewToken={onViewToken} />)}
            </div>
          </div>
        )}


        {/* Empty state */}
        {!loading && orders.length === 0 && (
          <p className={`text-[13px] font-bold ${T.muted}`}>
            No bets yet. Head to the Feed and make your first call.
          </p>
        )}
      </div>

      <AnimatePresence>
        {showWithdraw && (
          <WithdrawModal
            balance={balance}
            dk={dk}
            onClose={() => setShowWithdraw(false)}
            onSuccess={(newBalance) => {
              setBalance(parseFloat(newBalance) || 0);
              setShowWithdraw(false);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ─── sweep group row ───────────────────────────────────────────────────────────

function SweepGroupRow({ group: g, tick, dk, T }: {
  group: SweepGroup;
  tick: number;
  dk: boolean;
  T: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const isShort  = g.direction === "short";
  const timeLeft = g.expiresAt - Date.now();
  const allSettled = g.positions.every(p => p.status === "won" || p.status === "lost");
  const someSettled = g.positions.some(p => p.status === "won" || p.status === "lost");

  // PnL from resolved fills only
  const resolvedPnl = g.positions
    .filter(p => p.status === "won" || p.status === "lost")
    .reduce((sum, p) => sum + (p.status === "won" ? calcPayout(p) - p.amount : -p.amount), 0);
  const openCount = g.positions.filter(p => p.status !== "won" && p.status !== "lost").length;

  const cardCls =
    g.status === "won"  ? T.cardWon  :
    g.status === "lost" ? T.cardLost :
    T.cardBase;

  return (
    <div className={`rounded-2xl border overflow-hidden ${cardCls}`}>
      {/* Summary row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className={`text-[11px] font-black ${isShort ? "text-red-400" : "text-emerald-400"}`}>
            {isShort ? "▼ SHORT" : "▲ LONG"}
          </span>
          <span className={`text-[13px] font-black ${T.strong}`}>${g.symbol}</span>
          <span className={`text-[9px] font-bold ${T.muted}`}>{g.timeframe}</span>
          {g.isPaper && (
            <span className="text-[8px] font-black px-1 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
              PAPER
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {allSettled ? (
            <span className={`text-[12px] font-black ${resolvedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {resolvedPnl >= 0 ? "+" : ""}{resolvedPnl.toFixed(2)}
            </span>
          ) : (
            <span className={`text-[10px] font-black tabular-nums ${timeLeft < 60000 ? "text-red-400" : T.muted}`}>
              {someSettled ? `${openCount}/${g.positions.length} open · ` : ""}{formatCountdown(timeLeft)}
            </span>
          )}
          <span className={`text-[13px] font-black ${T.strong}`}>${g.totalAmount.toFixed(0)}</span>
          <span className={`text-[10px] font-bold ${T.muted}`}>{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Expanded fills */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className={`border-t ${dk ? "border-white/6" : "border-gray-100"} divide-y ${dk ? "divide-white/6" : "divide-gray-100"}`}
          >
            {g.positions.map((o) => {
              const oMs = Math.max(0, o.expiresAt - Date.now());
              const oCountdown = oMs <= 0 ? "settling" : formatCountdown(oMs);
              return (
                <div key={o.id} className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-black ${T.muted}`}>{o.timeframe}</span>
                    <span className={`text-[11px] font-black ${T.normal}`}>${o.amount.toFixed(0)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(o.status === "won" || o.status === "lost") ? (
                      <span className={`text-[11px] font-black ${o.status === "won" ? "text-emerald-400" : "text-red-400"}`}>
                        {o.status === "won" ? `+$${(calcPayout(o) - o.amount).toFixed(2)}` : `-$${o.amount.toFixed(2)}`}
                      </span>
                    ) : (
                      <span className={`text-[10px] font-black tabular-nums ${oMs < 60000 ? "text-red-400" : T.muted}`}>{oCountdown}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── position row ──────────────────────────────────────────────────────────────

function PositionRow({ order: o, tick, dk, T, onViewToken }: {
  order: Order;
  tick: number;
  dk: boolean;
  T: Record<string, string>;
  onViewToken?: (symbol: string) => void;
}) {
  const isShort    = o.direction === "short";
  const timeLeft   = o.expiresAt - Date.now();
  const isSettled  = o.status === "won" || o.status === "lost";
  const totalPool  = o.myPool + o.otherPool;
  const myPct      = totalPool > 0 ? (o.myPool / totalPool) * 100 : 100;
  const mult       = o.otherPool > 0 ? (1 + (o.otherPool * 0.95) / o.myPool).toFixed(2) : null;
  const payout     = calcPayout(o);
  const profit     = payout - o.amount;

  const cardCls =
    o.status === "won"  ? T.cardWon  :
    o.status === "lost" ? T.cardLost :
    T.cardBase;

  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-2xl border overflow-hidden ${cardCls}`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className={`text-[11px] font-black ${isShort ? "text-red-400" : "text-emerald-400"}`}>
            {isShort ? "▼ SHORT" : "▲ LONG"}
          </span>
          <button onClick={(e) => { e.stopPropagation(); onViewToken?.(o.symbol); }} className={`text-[13px] font-black ${T.strong} hover:opacity-60 transition-opacity`}>${o.symbol}</button>
          <span className={`text-[9px] font-bold ${T.muted}`}>{o.timeframe}</span>
          {o.isPaper && (
            <span className="text-[8px] font-black px-1 py-0.5 rounded-full bg-purple-500/20 text-purple-400">PAPER</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isSettled ? (
            <span className={`text-[12px] font-black ${o.status === "won" ? "text-emerald-400" : "text-red-400"}`}>
              {o.status === "won" ? `+$${profit.toFixed(2)}` : `-$${o.amount.toFixed(0)}`}
            </span>
          ) : (
            <span className={`text-[10px] font-black tabular-nums ${timeLeft < 60000 ? "text-red-400" : T.muted}`}>
              {o.status === "open" && o.otherPool === 0 ? "waiting…" : formatCountdown(timeLeft)}
            </span>
          )}
          <span className={`text-[13px] font-black ${T.strong}`}>${o.amount.toFixed(0)}</span>
          <span className={`text-[10px] font-bold ${T.muted}`}>{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className={`border-t ${dk ? "border-white/6" : "border-gray-100"} px-4 py-3`}
          >
            <div className="flex justify-between items-end">
              <div>
                <p className={`text-[9px] font-bold mb-0.5 ${T.muted}`}>Stake</p>
                <p className={`text-[13px] font-black ${T.strong}`}>${o.amount.toFixed(0)}</p>
              </div>
              {mult && (
                <div className="text-center">
                  <p className={`text-[9px] font-bold mb-0.5 ${T.muted}`}>Mult</p>
                  <p className="text-[13px] font-black text-amber-400">{mult}x</p>
                </div>
              )}
              <div className="text-right">
                <p className={`text-[9px] font-bold mb-0.5 ${T.muted}`}>{isSettled ? "Payout" : "To win"}</p>
                <p className={`text-[13px] font-black ${isSettled ? (o.status === "won" ? "text-emerald-400" : T.muted) : "text-emerald-400"}`}>
                  {isSettled
                    ? o.status === "won" ? `$${payout.toFixed(2)}` : "—"
                    : mult ? `$${payout.toFixed(2)}` : "—"}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
