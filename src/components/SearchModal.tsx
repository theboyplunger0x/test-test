"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { searchTokens, TokenInfo } from "@/lib/chartData";
import { api } from "@/lib/api";
import { Coin } from "@/lib/mockData";

function formatPrice(n: number): string {
  if (n === 0) return "0";
  if (n >= 1) return n.toFixed(2);
  const s = n.toFixed(12).replace(/0+$/, "");
  const match = s.match(/^0\.(0+)/);
  if (match) {
    const zeros = match[1].length;
    if (zeros >= 4) return `0.0{${zeros}}${s.slice(2 + zeros, 2 + zeros + 4)}`;
  }
  return n.toPrecision(4);
}

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}K`;
  return `${n.toFixed(0)}`;
}

function chainPill(c: string, dk: boolean) {
  if (c === "SOL")  return dk ? "text-purple-300 bg-purple-500/20" : "text-purple-700 bg-purple-100";
  if (c === "BASE") return dk ? "text-blue-300 bg-blue-500/20"     : "text-blue-700 bg-blue-100";
  if (c === "BSC")  return dk ? "text-yellow-300 bg-yellow-500/20" : "text-yellow-700 bg-yellow-100";
  return dk ? "text-orange-300 bg-orange-500/20" : "text-orange-700 bg-orange-100";
}

function tokenToCoin(t: TokenInfo): Coin {
  return {
    id: t.address,
    symbol: t.symbol,
    name: t.name,
    price: t.price,
    change24h: t.change24h,
    marketCap: t.marketCap,
    volume24h: t.volume24h,
    liquidity: t.liquidity,
    age: "—",
    migrated: false,
    chain: t.chainLabel as any,
    ca: t.address,
  };
}

const SEAL = "M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.266.14-1.897-.131-.63-.437-1.208-.882-1.671-.445-.464-1.011-.79-1.638-.944-.627-.155-1.284-.127-1.895.082-.274-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.61-.209-1.265-.237-1.892-.082-.627.155-1.193.48-1.639.944-.445.463-.749 1.04-.878 1.671-.13.63-.083 1.29.141 1.897-.587.274-1.086.706-1.44 1.246-.354.54-.551 1.17-.569 1.816.018.647.215 1.276.57 1.817.354.54.852.972 1.438 1.245-.224.607-.27 1.266-.14 1.897.13.63.436 1.208.882 1.671.445.464 1.011.79 1.638.944.627.155 1.284.127 1.895-.082.274.587.704 1.086 1.245 1.44.54.354 1.17.551 1.816.569.647-.016 1.275-.213 1.815-.567s.969-.854 1.24-1.44c.61.21 1.266.238 1.893.083.626-.155 1.192-.48 1.637-.944.445-.463.749-1.041.879-1.672.13-.63.083-1.29-.141-1.896.587-.274 1.086-.706 1.44-1.246.354-.54.551-1.17.569-1.816z";
const CHECK = "M9.611 12.851L7.29 10.53l-.927.948 3.248 3.2 6.912-6.83-.95-.943-5.962 5.946z";

function TierBadge({ tier }: { tier?: string }) {
  const tip = (label: string) => (
    <span className="pointer-events-none absolute left-full ml-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/90 px-2 py-1 text-[10px] font-bold text-white opacity-0 group-hover/badge:opacity-100 transition-opacity duration-150 z-50">
      {label}
    </span>
  );
  if (tier === "elite") return <span className="relative group/badge inline-flex items-center shrink-0"><svg width="13" height="13" viewBox="0 0 22 22" fill="none"><path d={SEAL} fill="#8B5CF6"/><path d={CHECK} fill="white"/></svg>{tip("Not for everyone.")}</span>;
  if (tier === "top") return <span className="relative group/badge inline-flex items-center shrink-0"><svg width="13" height="13" viewBox="0 0 22 22" fill="none"><path d={SEAL} fill="#F4C43B"/><path d={CHECK} fill="white"/></svg>{tip("Top · 20% fee rebate")}</span>;
  if (tier === "pro" || tier === "normal") return <span className="relative group/badge inline-flex items-center shrink-0"><svg width="13" height="13" viewBox="0 0 22 22" fill="none"><path d={SEAL} fill="#1D9BF0"/><path d={CHECK} fill="white"/></svg>{tip("Pro · 10% fee rebate")}</span>;
  return null;
}

type UserResult = { username: string; avatar_url?: string; tier?: string };
type Tab = "tokens" | "profiles";

interface Props {
  dk: boolean;
  onClose: () => void;
  onViewToken: (token: TokenInfo) => void;
  onViewChart: (token: TokenInfo) => void;
  onOpenMarket: (coin: Coin) => void;
  onViewProfile: (username: string) => void;
}

export default function SearchModal({ dk, onClose, onViewToken, onViewChart, onOpenMarket, onViewProfile }: Props) {
  const [query, setQuery]           = useState("");
  const [tab, setTab]               = useState<Tab>("tokens");
  const [tokens, setTokens]         = useState<TokenInfo[]>([]);
  const [users, setUsers]           = useState<UserResult[]>([]);
  const [loading, setLoading]       = useState(false);
  const inputRef                    = useRef<HTMLInputElement>(null);
  const debounceRef                 = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bg     = dk ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const input  = dk ? "bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-white/20" : "bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-gray-400";
  const muted  = dk ? "text-white/35" : "text-gray-400";
  const strong = dk ? "text-white" : "text-gray-900";
  const row    = dk ? "hover:bg-white/[0.04]" : "hover:bg-gray-50";
  const divider = dk ? "border-white/6" : "border-gray-100";

  const doSearch = useCallback(async (q: string, activeTab: Tab) => {
    if (!q.trim()) { setTokens([]); setUsers([]); setLoading(false); return; }
    setLoading(true);
    try {
      if (activeTab === "tokens") {
        const results = await searchTokens(q);
        setTokens(results);
      } else {
        const results = await api.searchUsers(q);
        setUsers(results);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setTokens([]); setUsers([]); setLoading(false); return; }
    setLoading(true);
    const isCA = query.trim().length > 20 && !query.includes(" ");
    const delay = isCA ? 0 : 400;
    debounceRef.current = setTimeout(() => doSearch(query, tab), delay);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, tab, doSearch]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const isEmpty = !loading && query.trim() && (tab === "tokens" ? tokens.length === 0 : users.length === 0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <motion.div
        initial={{ y: -12, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -12, opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={`relative w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden ${bg}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className={`flex items-center gap-3 px-4 py-3.5 border-b ${divider}`}>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" className={`shrink-0 ${muted}`}>
            <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={tab === "tokens" ? "Drop a $ticker or CA…" : "Search users…"}
            className={`flex-1 bg-transparent text-[14px] font-medium outline-none ${strong} placeholder:${muted}`}
          />
          {query && (
            <button onClick={() => setQuery("")} className={`text-[11px] font-bold ${muted} hover:opacity-60 shrink-0`}>✕</button>
          )}
          <button onClick={onClose} className={`text-[11px] font-bold ${muted} hover:opacity-60 shrink-0 ml-1`}>ESC</button>
        </div>

        {/* Tabs */}
        <div className={`flex items-center gap-1.5 px-4 py-2.5 border-b ${divider}`}>
          {(["tokens", "profiles"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-black transition-all capitalize ${
                tab === t
                  ? dk ? "bg-white text-black" : "bg-gray-900 text-white"
                  : dk ? "text-white/35 hover:text-white/60" : "text-gray-400 hover:text-gray-700"
              }`}>
              {t === "tokens" ? "Tokens" : "Profiles"}
            </button>
          ))}
          {loading && (
            <span className={`ml-auto text-[11px] font-bold animate-pulse ${muted}`}>Searching…</span>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[420px] overflow-y-auto">
          {!query.trim() && (
            <p className={`text-center py-10 text-[12px] ${muted}`}>
              {tab === "tokens" ? "Type a ticker or paste a contract address" : "Type a username to search"}
            </p>
          )}

          {isEmpty && (
            <p className={`text-center py-10 text-[12px] ${muted}`}>No results for "{query}"</p>
          )}

          {/* Token results */}
          {tab === "tokens" && tokens.map((t, i) => (
            <div key={t.address + i}
              className={`flex items-center gap-3 px-4 py-3 border-b cursor-pointer transition-colors ${divider} ${row}`}
              onClick={() => { onViewToken(t); onClose(); }}
            >
              {/* Letter avatar */}
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-[14px] font-black shrink-0 ${dk ? "bg-white/8 text-white/60" : "bg-gray-100 text-gray-500"}`}>
                {t.symbol.charAt(0)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[13px] font-black ${strong}`}>${t.symbol}</span>
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${chainPill(t.chainLabel, dk)}`}>{t.chainLabel}</span>
                  <span className={`text-[10px] font-bold ${t.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {t.change24h >= 0 ? "+" : ""}{t.change24h.toFixed(1)}%
                  </span>
                </div>
                <div className={`flex items-center gap-2 text-[10px] font-bold ${muted}`}>
                  <span className="truncate max-w-[80px]">{t.name}</span>
                  <span className="font-mono">· ${formatPrice(t.price)}</span>
                  {t.marketCap > 0 && <span>· MC ${formatNum(t.marketCap)}</span>}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={e => { e.stopPropagation(); onViewChart(t); onClose(); }}
                  className={`text-[10px] font-bold transition-colors ${dk ? "text-white/35 hover:text-white/80" : "text-gray-400 hover:text-gray-700"}`}
                >
                  Chart →
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onOpenMarket(tokenToCoin(t)); onClose(); }}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                    dk ? "bg-white/8 hover:bg-white/16 text-white/60 hover:text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-600"
                  }`}
                >
                  Trade
                </button>
              </div>
            </div>
          ))}

          {/* Profile results */}
          {tab === "profiles" && users.map((u, i) => (
            <div key={u.username + i}
              className={`flex items-center gap-3 px-4 py-3.5 border-b cursor-pointer transition-colors ${divider} ${row}`}
              onClick={() => { onViewProfile(u.username); onClose(); }}
            >
              {u.avatar_url ? (
                <img src={u.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
              ) : (
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[14px] font-black shrink-0 ${dk ? "bg-white/10 text-white/50" : "bg-gray-100 text-gray-500"}`}>
                  {u.username.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[13px] font-black ${strong}`}>{u.username}</span>
                  <TierBadge tier={u.tier} />
                </div>
              </div>
              <span className={`text-[11px] font-bold ${muted}`}>View profile →</span>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        {tab === "tokens" && tokens.length > 0 && (
          <div className={`px-4 py-2.5 border-t ${divider}`}>
            <p className={`text-[10px] font-bold ${muted}`}>Click row → token profile · Chart → full chart · Market → open position</p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
