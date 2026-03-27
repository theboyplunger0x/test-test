"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, UserProfile, FollowStatus, User } from "../lib/api";

const SEAL = "M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.266.14-1.897-.131-.63-.437-1.208-.882-1.671-.445-.464-1.011-.79-1.638-.944-.627-.155-1.284-.127-1.895.082-.274-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.61-.209-1.265-.237-1.892-.082-.627.155-1.193.48-1.639.944-.445.463-.749 1.04-.878 1.671-.13.63-.083 1.29.141 1.897-.587.274-1.086.706-1.44 1.246-.354.54-.551 1.17-.569 1.816.018.647.215 1.276.57 1.817.354.54.852.972 1.438 1.245-.224.607-.27 1.266-.14 1.897.13.63.436 1.208.882 1.671.445.464 1.011.79 1.638.944.627.155 1.284.127 1.895-.082.274.587.704 1.086 1.245 1.44.54.354 1.17.551 1.816.569.647-.016 1.275-.213 1.815-.567s.969-.854 1.24-1.44c.61.21 1.266.238 1.893.083.626-.155 1.192-.48 1.637-.944.445-.463.749-1.041.879-1.672.13-.63.083-1.29-.141-1.896.587-.274 1.086-.706 1.44-1.246.354-.54.551-1.17.569-1.816z";
const CHECK = "M9.611 12.851L7.29 10.53l-.927.948 3.248 3.2 6.912-6.83-.95-.943-5.962 5.946z";

type ChartPeriod = "1W" | "1M" | "ALL";

function PnlChart({ trades, period, dk }: {
  trades: UserProfile["recent_trades"];
  period: ChartPeriod;
  dk: boolean;
}) {
  // Build cumulative PnL series from trades
  const now = Date.now();
  const cutoff = period === "1W" ? now - 7 * 86400000
    : period === "1M" ? now - 30 * 86400000
    : 0;

  const filtered = trades
    .filter(t => new Date(t.placed_at).getTime() >= cutoff && t.status === "resolved")
    .sort((a, b) => new Date(a.placed_at).getTime() - new Date(b.placed_at).getTime());

  if (filtered.length < 2) {
    return (
      <div className={`flex items-center justify-center h-full text-[11px] ${dk ? "text-white/20" : "text-gray-400"}`}>
        Not enough data
      </div>
    );
  }

  let cum = 0;
  const points = filtered.map(t => {
    const amount = parseFloat(t.amount);
    const won = t.winner_side === t.side;
    cum += won ? amount * 0.95 : -amount;
    return cum;
  });

  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const range = max - min || 1;
  const W = 300, H = 80;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - ((p - min) / range) * H;
    return `${x},${y}`;
  });

  const polyline = coords.join(" ");
  const lastY = H - ((points[points.length - 1] - min) / range) * H;
  const positive = points[points.length - 1] >= 0;
  const color = positive ? "#34d399" : "#f87171";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${H} ${polyline} ${W},${H}`}
        fill="url(#chartGrad)"
      />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export default function ProfilePage({ username, dk, onClose, currentUser, currentUserObj, onUserUpdate }: {
  username: string;
  dk: boolean;
  onClose: () => void;
  currentUser?: string;
  currentUserObj?: User;
  onUserUpdate?: (u: User) => void;
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"positions" | "activity">("positions");
  const [period, setPeriod] = useState<ChartPeriod>("1M");
  const [posFilter, setPosFilter] = useState<"all" | "open" | "won" | "lost">("all");
  const [followStatus, setFollowStatus] = useState<FollowStatus>({ following: false, notify_trades: false });
  const [followLoading, setFollowLoading] = useState(false);
  const [followHovered, setFollowHovered] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editAvatar, setEditAvatar] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const isOwnProfile = currentUser === username;
  const loggedIn = typeof window !== "undefined" && !!localStorage.getItem("token");

  useEffect(() => {
    setLoading(true);
    setProfile(null);
    setFollowStatus({ following: false, notify_trades: false });
    api.getUserProfile(username)
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoading(false));

    if (loggedIn && !isOwnProfile) {
      api.getFollowStatus(username).then(setFollowStatus).catch(() => {});
    }
  }, [username]);

  const handleFollow = async () => {
    if (followLoading) return;
    setFollowLoading(true);
    try {
      if (followStatus?.following) {
        await api.unfollowUser(username);
        setFollowStatus({ following: false, notify_trades: false });
      } else {
        const result = await api.followUser(username);
        setFollowStatus(result);
        // Optimistically bump follower count
        setProfile(p => p ? { ...p, follower_count: (p.follower_count ?? 0) + 1 } : p);
      }
    } catch {} finally {
      setFollowLoading(false);
    }
  };

  const handleEditSave = async () => {
    setEditSaving(true);
    setEditError("");
    try {
      const updated = await api.updateProfile(editAvatar.trim(), editBio.trim());
      setProfile(p => p ? { ...p, avatar_url: updated.avatar_url, bio: updated.bio } : p);
      if (onUserUpdate) onUserUpdate(updated);
      setEditMode(false);
    } catch (e: any) {
      setEditError(e.message ?? "Failed to save");
    } finally {
      setEditSaving(false);
    }
  };

  const handleBell = async () => {
    if (!followStatus.following) return;
    const newVal = !followStatus.notify_trades;
    setFollowStatus(s => ({ ...s, notify_trades: newVal })); // optimistic
    try {
      const result = await api.setNotifyTrades(username, newVal);
      setFollowStatus(s => ({ ...s, notify_trades: result.notify_trades }));
    } catch (err: any) {
      setFollowStatus(s => ({ ...s, notify_trades: !newVal })); // revert
      alert(err?.message ?? "Failed to update notification setting");
    }
  };

  const pnl = profile ? parseFloat(profile.pnl) : 0;
  const winRate = profile && profile.total_bets > 0
    ? Math.round((profile.wins / profile.total_bets) * 100) : 0;
  const losses = profile ? profile.total_bets - profile.wins : 0;

  const joinDate = profile
    ? new Date(profile.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "";

  const bg      = dk ? "bg-[#0c0c0c]" : "bg-white";
  const border  = dk ? "border-white/8" : "border-gray-200";
  const card    = dk ? "bg-white/[0.03] border-white/8" : "bg-gray-50 border-gray-200";
  const muted   = dk ? "text-white/40" : "text-gray-400";
  const strong  = dk ? "text-white" : "text-gray-900";
  const sub     = dk ? "text-white/60" : "text-gray-600";

  const filteredTrades = profile?.recent_trades.filter(t => {
    if (posFilter === "open") return t.status === "open";
    if (posFilter === "won") return t.status === "resolved" && t.winner_side === t.side;
    if (posFilter === "lost") return t.status === "resolved" && t.winner_side !== t.side;
    return true;
  }) ?? [];

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={`fixed inset-0 z-[70] flex flex-col ${bg}`}
    >
      {/* Header */}
      <div className={`flex items-center gap-3 px-5 py-4 border-b shrink-0 ${border}`}>
        <button onClick={onClose} className={`text-[18px] font-bold ${muted} hover:opacity-60 transition-opacity`}>←</button>
        <span className={`text-[15px] font-black ${strong} flex-1`}>{username}</span>
        {/* Follow actions */}
        {loggedIn && !isOwnProfile && (
          <div className="flex items-center gap-1.5">
            {followStatus.following && (
              <button onClick={handleBell}
                title={followStatus.notify_trades ? "Mute trades" : "Notify on all trades"}
                className={`flex items-center justify-center w-8 h-8 rounded-xl border transition-all ${
                  followStatus.notify_trades
                    ? "bg-blue-500 border-blue-500 text-white"
                    : (dk ? "border-white/10 text-white/30 hover:text-white/60" : "border-gray-200 text-gray-400 hover:text-gray-600")
                }`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            <button
              onClick={handleFollow}
              disabled={followLoading}
              onMouseEnter={() => setFollowHovered(true)}
              onMouseLeave={() => setFollowHovered(false)}
              className={`px-4 py-1.5 rounded-xl text-[12px] font-black transition-all ${
                followStatus.following
                  ? followHovered
                    ? (dk ? "border border-red-400/40 text-red-400" : "border border-red-300 text-red-500")
                    : (dk ? "border border-white/10 text-white/50" : "border border-gray-200 text-gray-500")
                  : "bg-blue-500 hover:bg-blue-400 text-white"
              }`}>
              {followStatus.following
                ? followHovered ? "Unfollow" : "Following"
                : "Follow"}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className={`flex items-center justify-center h-40 text-[13px] ${muted}`}>Loading…</div>
        ) : !profile ? (
          <div className={`flex items-center justify-center h-40 text-[13px] ${muted}`}>User not found</div>
        ) : (
          <div className="px-5 py-5 space-y-4">

            {/* Top cards row */}
            <div className="flex gap-3">
              {/* Profile card */}
              <div className={`flex-1 rounded-2xl border p-4 ${card}`}>
                <div className="flex items-start gap-3 mb-4">
                  {/* Avatar — clickable for own profile edit */}
                  <div className="relative shrink-0 group">
                    {(editMode ? editAvatar : profile.avatar_url) ? (
                      <img src={editMode ? editAvatar : profile.avatar_url!} alt="" className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-[20px] font-black ${dk ? "bg-white/10 text-white/40" : "bg-gray-100 text-gray-400"}`}>
                        {username.charAt(0).toUpperCase()}
                      </div>
                    )}
                    {isOwnProfile && !editMode && (
                      <button onClick={() => { setEditAvatar(profile.avatar_url ?? ""); setEditBio(profile.bio ?? ""); setEditMode(true); setEditError(""); }}
                        className={`absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${dk ? "bg-black/60" : "bg-white/70"}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[14px] font-black ${strong}`}>{username}</span>
                      {profile.tier === "elite" && (
                        <svg width="13" height="13" viewBox="0 0 22 22" fill="none">
                          <path d={SEAL} fill="#8B5CF6"/><path d={CHECK} fill="white"/>
                        </svg>
                      )}
                      {profile.tier === "top" && (
                        <svg width="13" height="13" viewBox="0 0 22 22" fill="none">
                          <path d={SEAL} fill="#F4C43B"/><path d={CHECK} fill="white"/>
                        </svg>
                      )}
                      {(profile.tier === "pro" || profile.tier === "normal") && (
                        <svg width="13" height="13" viewBox="0 0 22 22" fill="none">
                          <path d={SEAL} fill="#1D9BF0"/><path d={CHECK} fill="white"/>
                        </svg>
                      )}
                      {(profile.tier === "basic" || profile.tier === "") && profile.telegram_username && (
                        <svg width="13" height="13" viewBox="0 0 22 22" fill="none">
                          <path d={SEAL} fill="#6B7280"/><path d={CHECK} fill="white"/>
                        </svg>
                      )}
                      {profile.x_username && (
                        <a href={`https://x.com/${profile.x_username}`} target="_blank" rel="noopener noreferrer"
                          className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black transition-opacity hover:opacity-70 ${dk ? "bg-white/10 text-white/60" : "bg-gray-100 text-gray-600"}`}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.741l7.73-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                          </svg>
                          @{profile.x_username}
                        </a>
                      )}
                    </div>
                    <p className={`text-[11px] mt-0.5 ${muted}`}>Joined {joinDate}</p>

                    {/* Bio — editable for own profile */}
                    {editMode ? (
                      <div className="mt-2 space-y-2">
                        <div>
                          <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${muted}`}>Avatar URL</p>
                          <input value={editAvatar} onChange={e => setEditAvatar(e.target.value)}
                            placeholder="https://..."
                            className={`w-full text-[11px] px-2 py-1.5 rounded-lg border outline-none transition-all ${dk ? "bg-white/5 border-white/10 text-white placeholder:text-white/20" : "bg-gray-50 border-gray-200 text-gray-900"}`} />
                        </div>
                        <div>
                          <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${muted}`}>Bio</p>
                          <textarea value={editBio} onChange={e => setEditBio(e.target.value)} maxLength={120} rows={2}
                            placeholder="Short bio…"
                            className={`w-full text-[11px] px-2 py-1.5 rounded-lg border outline-none resize-none transition-all ${dk ? "bg-white/5 border-white/10 text-white placeholder:text-white/20" : "bg-gray-50 border-gray-200 text-gray-900"}`} />
                        </div>
                        {editError && <p className="text-[10px] text-red-400">{editError}</p>}
                        <div className="flex gap-2">
                          <button onClick={handleEditSave} disabled={editSaving}
                            className={`flex-1 py-1.5 rounded-lg text-[11px] font-black transition-all disabled:opacity-50 ${dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white"}`}>
                            {editSaving ? "Saving…" : "Save"}
                          </button>
                          <button onClick={() => setEditMode(false)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold ${muted} hover:opacity-70`}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {profile.bio && <p className={`text-[11px] mt-1 ${sub}`}>{profile.bio}</p>}
                        {isOwnProfile && !profile.bio && (
                          <button onClick={() => { setEditAvatar(profile.avatar_url ?? ""); setEditBio(""); setEditMode(true); setEditError(""); }}
                            className={`text-[10px] font-bold mt-1 transition-opacity hover:opacity-60 ${muted}`}>
                            + Add bio
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className={`border-t pt-3 ${border} grid grid-cols-3 gap-2`}>
                  <div>
                    <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${muted}`}>Bets</p>
                    <p className={`text-[18px] font-black ${strong}`}>{profile.total_bets}</p>
                  </div>
                  <div>
                    <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${muted}`}>Wins</p>
                    <p className={`text-[18px] font-black text-emerald-400`}>{profile.wins}</p>
                  </div>
                  <div>
                    <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${muted}`}>Losses</p>
                    <p className={`text-[18px] font-black text-red-400`}>{losses}</p>
                  </div>
                </div>
                {/* Followers / Following */}
                <div className={`border-t pt-3 mt-2 ${border} flex gap-4`}>
                  <div>
                    <span className={`text-[14px] font-black ${strong}`}>{profile.follower_count ?? 0}</span>
                    <span className={`text-[11px] font-bold ml-1 ${muted}`}>followers</span>
                  </div>
                  <div>
                    <span className={`text-[14px] font-black ${strong}`}>{profile.following_count ?? 0}</span>
                    <span className={`text-[11px] font-bold ml-1 ${muted}`}>following</span>
                  </div>
                </div>
              </div>

              {/* PnL card */}
              <div className={`flex-1 rounded-2xl border p-4 flex flex-col ${card}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-black ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{pnl >= 0 ? "▲" : "▼"}</span>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>P&L</span>
                  </div>
                  <div className="flex gap-1">
                    {(["1W", "1M", "ALL"] as ChartPeriod[]).map(p => (
                      <button key={p} onClick={() => setPeriod(p)}
                        className={`text-[9px] font-black px-1.5 py-0.5 rounded-lg transition-all ${
                          period === p
                            ? (dk ? "bg-white text-black" : "bg-gray-900 text-white")
                            : muted + " hover:opacity-70"
                        }`}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <p className={`text-[22px] font-black mb-2 ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toFixed(2)}
                </p>
                <div className="flex-1 min-h-[60px]">
                  <PnlChart trades={profile.recent_trades} period={period} dk={dk} />
                </div>
                <div className="flex justify-between mt-2">
                  <div>
                    <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${muted}`}>Win rate</p>
                    <p className={`text-[14px] font-black ${strong}`}>{winRate}%</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${muted}`}>Volume</p>
                    <p className={`text-[14px] font-black ${strong}`}>${parseFloat(profile.volume).toFixed(0)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className={`flex rounded-xl p-0.5 border text-[12px] font-black ${dk ? "bg-white/5 border-white/10" : "bg-gray-100 border-gray-200"}`}>
              <button onClick={() => setTab("positions")}
                className={`flex-1 py-2 rounded-[10px] transition-all ${tab === "positions" ? (dk ? "bg-white text-black" : "bg-gray-900 text-white") : (dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700")}`}>
                Positions
              </button>
              <button onClick={() => setTab("activity")}
                className={`flex-1 py-2 rounded-[10px] transition-all ${tab === "activity" ? (dk ? "bg-white text-black" : "bg-gray-900 text-white") : (dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700")}`}>
                Activity
              </button>
            </div>

            {/* Positions tab */}
            {tab === "positions" && (
              <div>
                {/* Filter pills */}
                <div className="flex gap-1.5 mb-3">
                  {(["all", "open", "won", "lost"] as const).map(f => (
                    <button key={f} onClick={() => setPosFilter(f)}
                      className={`px-3 py-1 rounded-full text-[11px] font-black transition-all ${
                        posFilter === f
                          ? (dk ? "bg-white text-black" : "bg-gray-900 text-white")
                          : (dk ? "bg-white/5 text-white/40 hover:text-white/70" : "bg-gray-100 text-gray-400 hover:text-gray-700")
                      }`}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>

                {filteredTrades.length === 0 ? (
                  <p className={`text-[13px] ${muted} text-center py-8`}>No positions found.</p>
                ) : (
                  <div className={`rounded-2xl border overflow-hidden ${border}`}>
                    {/* Table header */}
                    <div className={`grid grid-cols-[1fr_80px_80px] px-4 py-2 border-b text-[10px] font-black uppercase tracking-widest ${muted} ${border} ${dk ? "bg-white/[0.02]" : "bg-gray-50"}`}>
                      <span>Market</span>
                      <span className="text-right">Amount</span>
                      <span className="text-right">Result</span>
                    </div>
                    {filteredTrades.map((t, i) => {
                      const won  = t.status === "resolved" && t.winner_side === t.side;
                      const lost = t.status === "resolved" && t.winner_side !== t.side;
                      const isOpen = t.status !== "resolved";
                      return (
                        <div key={i} className={`grid grid-cols-[1fr_80px_80px] px-4 py-3 items-center ${i < filteredTrades.length - 1 ? `border-b ${border}` : ""} ${dk ? "hover:bg-white/[0.02]" : "hover:bg-gray-50"} transition-colors`}>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[11px] font-black ${t.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
                                {t.side === "long" ? "▲ Long" : "▼ Short"}
                              </span>
                              <span className={`text-[10px] font-bold ${muted}`}>{t.timeframe}</span>
                            </div>
                            <p className={`text-[13px] font-black mt-0.5 ${strong}`}>${t.symbol}</p>
                            <p className={`text-[10px] ${muted}`}>{t.chain.toUpperCase()}</p>
                          </div>
                          <div className="text-right">
                            <p className={`text-[13px] font-black ${strong}`}>${parseFloat(t.amount).toFixed(0)}</p>
                          </div>
                          <div className="text-right">
                            {isOpen  && <span className={`text-[11px] font-black ${muted}`}>Open</span>}
                            {won     && <span className="text-[11px] font-black text-emerald-400">Won ✓</span>}
                            {lost    && <span className="text-[11px] font-black text-red-400">Lost ✗</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Activity tab */}
            {tab === "activity" && (
              <div className={`rounded-2xl border overflow-hidden ${border}`}>
                {profile.recent_trades.length === 0 ? (
                  <p className={`text-[13px] ${muted} text-center py-8`}>No activity yet.</p>
                ) : (
                  profile.recent_trades.map((t, i) => {
                    const won = t.status === "resolved" && t.winner_side === t.side;
                    const lost = t.status === "resolved" && t.winner_side !== t.side;
                    const date = new Date(t.placed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    return (
                      <div key={i} className={`flex items-center justify-between px-4 py-3 ${i < profile.recent_trades.length - 1 ? `border-b ${border}` : ""}`}>
                        <div className="flex items-center gap-3">
                          <span className={`text-[16px] ${t.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
                            {t.side === "long" ? "▲" : "▼"}
                          </span>
                          <div>
                            <p className={`text-[12px] font-black ${strong}`}>${t.symbol} {t.side.toUpperCase()} {t.timeframe}</p>
                            <p className={`text-[10px] ${muted}`}>{date}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-[12px] font-black ${strong}`}>${parseFloat(t.amount).toFixed(0)}</p>
                          {won  && <p className="text-[10px] font-black text-emerald-400">Won</p>}
                          {lost && <p className="text-[10px] font-black text-red-400">Lost</p>}
                          {t.status === "open" && <p className={`text-[10px] font-black ${muted}`}>Open</p>}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

          </div>
        )}
      </div>
    </motion.div>
  );
}
