"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, AppNotification } from "../lib/api";

function formatAgo(ts: string) {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60)  return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

function NotifRow({ n, dk, onViewProfile }: { n: AppNotification; dk: boolean; onViewProfile?: (u: string) => void }) {
  const payload = n.payload;
  const muted = dk ? "text-white/40" : "text-gray-400";
  const strong = dk ? "text-white" : "text-gray-900";

  let icon = "🔔";
  let text: React.ReactNode = null;

  if (n.type === "market_resolved") {
    const won = payload.side === payload.winner_side;
    icon = won ? "🟢" : "🔴";
    text = (
      <span>
        Your <span className={`font-black ${payload.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
          {payload.side === "long" ? "LONG" : "SHORT"}
        </span>{" "}
        on <span className={`font-black ${strong}`}>${payload.symbol}</span>{" "}
        {won ? "won" : "lost"}{" — "}
        <span className={`font-black ${won ? "text-emerald-400" : "text-red-400"}`}>
          {won ? "+" : ""}{payload.pnl >= 0 ? "+" : ""}${Math.abs(payload.pnl).toFixed(2)}
        </span>
      </span>
    );
  } else if (n.type === "new_follower") {
    icon = "👤";
    text = (
      <span>
        <button
          onClick={() => onViewProfile?.(payload.from_username)}
          className={`font-black ${strong} hover:opacity-60 transition-opacity`}
        >
          {payload.from_username}
        </button>{" "}
        started following you
      </span>
    );
  } else if (n.type === "followed_trade") {
    icon = payload.side === "long" ? "🟩" : "🟥";
    text = (
      <span>
        <button
          onClick={() => onViewProfile?.(payload.trader_username)}
          className={`font-black ${strong} hover:opacity-60 transition-opacity`}
        >
          {payload.trader_username}
        </button>{" "}
        opened a{" "}
        <span className={`font-black ${payload.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
          {payload.side === "long" ? "LONG" : "SHORT"}
        </span>{" "}
        on <span className={`font-black ${strong}`}>${payload.symbol}</span>{" "}
        <span className={muted}>· ${payload.amount?.toFixed ? payload.amount.toFixed(0) : payload.amount}</span>
      </span>
    );
  } else if (n.type === "order_filled") {
    icon = "⚡";
    text = (
      <span>
        Your{" "}
        <span className={`font-black ${payload.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
          {payload.side === "long" ? "LONG" : "SHORT"}
        </span>{" "}
        order on <span className={`font-black ${strong}`}>${payload.symbol}</span>{" "}
        <span className={muted}>{payload.timeframe}</span>{" "}
        was filled{" "}
        <span className={`font-black ${strong}`}>
          ${typeof payload.amount === "number" ? payload.amount.toFixed(0) : payload.amount}
        </span>
      </span>
    );
  } else if (n.type === "followed_big_trade") {
    const won = payload.pnl >= 0;
    icon = won ? "🚀" : "💥";
    text = (
      <span>
        <button
          onClick={() => onViewProfile?.(payload.trader_username)}
          className={`font-black ${strong} hover:opacity-60 transition-opacity`}
        >
          {payload.trader_username}
        </button>{" "}
        {won ? "won" : "lost"}{" "}
        <span className={`font-black ${won ? "text-emerald-400" : "text-red-400"}`}>
          ${Math.abs(payload.pnl).toFixed(2)}
        </span>{" "}
        on <span className={`font-black ${strong}`}>${payload.symbol}</span>
      </span>
    );
  }

  return (
    <div className={`flex gap-3 px-5 py-3.5 border-b transition-colors ${
      !n.read ? (dk ? "bg-white/[0.02]" : "bg-blue-50/60") : ""
    } ${dk ? "border-white/5" : "border-gray-100"}`}>
      <span className="text-[18px] shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-[12px] leading-snug ${muted}`}>{text}</p>
        <p className={`text-[10px] font-bold mt-1 ${dk ? "text-white/20" : "text-gray-400"}`}>{formatAgo(n.created_at)}</p>
      </div>
      {!n.read && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-2" />
      )}
    </div>
  );
}

export default function NotificationsPanel({
  dk,
  onClose,
  onViewProfile,
}: {
  dk: boolean;
  onClose: () => void;
  onViewProfile?: (username: string) => void;
}) {
  const [notifs, setNotifs] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getNotifications()
      .then(data => {
        setNotifs(data);
        // Mark all read after fetching
        if (data.some(n => !n.read)) api.markAllRead().catch(() => {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const bg = dk ? "bg-[#111] border-white/8" : "bg-white border-gray-200";
  const header = dk ? "border-white/8" : "border-gray-100";
  const muted = dk ? "text-white/30" : "text-gray-400";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-start justify-end pt-14 pr-4 md:pr-6"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30" />
      <motion.div
        initial={{ y: -10, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -10, opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={`relative w-full max-w-sm rounded-2xl border shadow-2xl overflow-hidden ${bg}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-3.5 border-b ${header}`}>
          <span className={`text-[13px] font-black ${dk ? "text-white" : "text-gray-900"}`}>Notifications</span>
          <button onClick={onClose} className={`text-[16px] font-bold ${muted} hover:opacity-60`}>✕</button>
        </div>

        {/* List */}
        <div className="max-h-[480px] overflow-y-auto">
          {loading ? (
            <p className={`text-center py-10 text-[12px] ${muted}`}>Loading…</p>
          ) : notifs.length === 0 ? (
            <p className={`text-center py-10 text-[12px] ${muted}`}>No notifications yet</p>
          ) : (
            notifs.map(n => (
              <NotifRow key={n.id} n={n} dk={dk} onViewProfile={(u) => { onViewProfile?.(u); onClose(); }} />
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
