"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { searchByCA, searchBySymbol, TokenInfo } from "@/lib/chartData";

const TFS = ["1m", "5m", "15m", "1h", "4h", "12h", "24h"];

function formatPrice(n: number): string {
  if (n === 0) return "0";
  if (n >= 1) return n.toFixed(4);
  const s = n.toFixed(12).replace(/0+$/, "");
  const match = s.match(/^0\.(0+)/);
  if (match) {
    const zeros = match[1].length;
    if (zeros >= 4) return `0.0{${zeros}}${s.slice(2 + zeros, 2 + zeros + 4)}`;
  }
  return n.toPrecision(4);
}

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

interface Props {
  dk: boolean;
  onClose: () => void;
  onTrade: (token: TokenInfo) => void;
  onQuickTrade: (token: TokenInfo, side: "long" | "short", timeframe: string, amount: number, message?: string) => Promise<string | null>;
  presets: number[];
}

export default function CASearchModal({ dk, onClose, onTrade, onQuickTrade, presets }: Props) {
  const [query, setQuery]       = useState("");
  const [result, setResult]     = useState<TokenInfo | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const inputRef                = useRef<HTMLInputElement>(null);

  // Inline trade state
  const [showTrade, setShowTrade]     = useState(false);
  const [tradeSide, setTradeSide]     = useState<"long" | "short" | null>(null);
  const [tradeTf, setTradeTf]         = useState("1h");
  const [tradeAmt, setTradeAmt]       = useState<number | null>(null);
  const [tradeCustom, setTradeCustom] = useState("");
  const [tradeMsg, setTradeMsg]       = useState("");
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeError, setTradeError]   = useState<string | null>(null);
  const [tradeDone, setTradeDone]     = useState(false);

  const finalTradeAmt = tradeCustom ? parseFloat(tradeCustom) : tradeAmt;
  const tradeReady = tradeSide && finalTradeAmt && finalTradeAmt >= 5;

  const overlay = dk ? "bg-black/70" : "bg-black/30";
  const sheet   = dk ? "bg-[#0f0f0f] border-t border-white/8" : "bg-white border-t border-gray-200";
  const inputCls = dk
    ? "bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-white/25"
    : "bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-gray-400";
  const muted = dk ? "text-white/30" : "text-gray-400";
  const strong = dk ? "text-white" : "text-gray-900";

  async function doSearch() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const isCA = q.length > 20 && !q.includes(" ");
      const info = isCA ? await searchByCA(q) : await searchBySymbol(q, "SOL");

      if (!info) {
        setError(isCA
          ? "No token found for this address. Make sure it's a valid contract address."
          : `No results for "${q}". Try pasting the contract address instead.`
        );
      } else {
        setResult(info);
      }
    } catch {
      setError("Search failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickTrade() {
    if (!result || !tradeSide || !finalTradeAmt) return;
    setTradeError(null);
    setTradeLoading(true);
    const err = await onQuickTrade(result, tradeSide, tradeTf, finalTradeAmt, tradeMsg.trim() || undefined);
    setTradeLoading(false);
    if (err) {
      setTradeError(err);
    } else {
      setTradeDone(true);
      setTimeout(onClose, 1800);
    }
  }

  const chainPill = (c: string) => {
    if (c === "SOL")  return dk ? "text-purple-300 bg-purple-500/20" : "text-purple-700 bg-purple-100";
    if (c === "BASE") return dk ? "text-blue-300 bg-blue-500/20"     : "text-blue-700 bg-blue-100";
    if (c === "BSC")  return dk ? "text-yellow-300 bg-yellow-500/20" : "text-yellow-700 bg-yellow-100";
    return dk ? "text-orange-300 bg-orange-500/20" : "text-orange-700 bg-orange-100";
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`absolute inset-0 ${overlay}`} onClick={onClose} />

      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className={`relative w-full max-w-lg rounded-t-3xl p-6 space-y-4 ${sheet}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className={`text-[15px] font-black ${strong}`}>Search Token</p>
          <button onClick={onClose} className={`text-[11px] font-bold ${muted}`}>✕ close</button>
        </div>

        {/* Search input */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Symbol (PEPE) or contract address (0x… / So1…)"
            className={`flex-1 border rounded-xl px-4 py-3 text-[13px] font-mono outline-none transition-all ${inputCls}`}
            autoFocus
          />
          <button
            onClick={doSearch}
            disabled={loading || !query.trim()}
            className={`px-5 py-3 rounded-xl text-[12px] font-black transition-all ${
              loading
                ? dk ? "bg-white/10 text-white/30" : "bg-gray-100 text-gray-400"
                : dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-gray-700"
            }`}
          >
            {loading ? "…" : "Find"}
          </button>
        </div>

        <p className={`text-[10px] font-bold ${muted}`}>
          Supports Solana, Base, Ethereum, BSC · Powered by DexScreener
        </p>

        {/* Error */}
        {error && (
          <p className="text-[12px] font-bold text-red-400">{error}</p>
        )}

        {/* Result */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl border p-4 space-y-3 ${dk ? "border-white/8 bg-white/[0.03]" : "border-gray-200 bg-gray-50"}`}
            >
              {/* Token header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[18px] font-black ${strong}`}>${result.symbol}</span>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${chainPill(result.chainLabel)}`}>
                      {result.chainLabel}
                    </span>
                    <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${result.change24h >= 0 ? (dk ? "text-emerald-300 bg-emerald-500/20" : "text-emerald-700 bg-emerald-100") : (dk ? "text-red-300 bg-red-500/20" : "text-red-700 bg-red-100")}`}>
                      {result.change24h >= 0 ? "+" : ""}{result.change24h.toFixed(1)}%
                    </span>
                  </div>
                  <p className={`text-[11px] mt-0.5 ${muted}`}>{result.name}</p>
                </div>
                <div className="text-right">
                  <p className={`text-[16px] font-black font-mono ${strong}`}>${formatPrice(result.price)}</p>
                </div>
              </div>

              {/* Stats row */}
              <div className={`flex gap-4 text-[10px] font-bold ${muted}`}>
                <div>
                  <p className="mb-0.5">Liquidity</p>
                  <p className={strong}>{formatNum(result.liquidity)}</p>
                </div>
                <div>
                  <p className="mb-0.5">Vol 24h</p>
                  <p className={strong}>{formatNum(result.volume24h)}</p>
                </div>
                {result.marketCap > 0 && (
                  <div>
                    <p className="mb-0.5">Mkt Cap</p>
                    <p className={strong}>{formatNum(result.marketCap)}</p>
                  </div>
                )}
              </div>

              {/* CA */}
              <p className={`text-[9px] font-mono truncate ${muted}`}>{result.address}</p>

              {/* Action buttons */}
              {!showTrade && !tradeDone && (
                <div className="space-y-2">
                  <p className="text-center">
                    <button
                      onClick={() => { onTrade(result!); onClose(); }}
                      className={`text-[11px] font-bold transition-opacity hover:opacity-60 ${muted}`}
                    >
                      See chart
                    </button>
                  </p>
                  <button
                    onClick={() => setShowTrade(true)}
                    className={`w-full py-3.5 rounded-xl text-[13px] font-black transition-all ${
                      dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-gray-700"
                    }`}
                  >
                    Trade →
                  </button>
                </div>
              )}

              {tradeDone && (
                <p className="text-center text-[13px] font-black text-emerald-400 py-2">Trade placed! ✓</p>
              )}

              {/* Inline trade panel */}
              <AnimatePresence>
                {showTrade && !tradeDone && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden space-y-3 pt-1"
                  >
                    {/* Side */}
                    <div className="flex gap-2">
                      <button onClick={() => setTradeSide("long")}
                        className={`flex-1 py-2.5 rounded-xl text-[12px] font-black transition-all ${
                          tradeSide === "long" ? "bg-emerald-500 text-white" : dk ? "bg-emerald-500/10 text-emerald-400/60 hover:bg-emerald-500/20" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                        }`}>▲ Long</button>
                      <button onClick={() => setTradeSide("short")}
                        className={`flex-1 py-2.5 rounded-xl text-[12px] font-black transition-all ${
                          tradeSide === "short" ? "bg-red-500 text-white" : dk ? "bg-red-500/10 text-red-400/60 hover:bg-red-500/20" : "bg-rose-50 text-red-600 hover:bg-rose-100"
                        }`}>▼ Short</button>
                    </div>

                    {/* Timeframe */}
                    <div className="grid grid-cols-6 gap-1">
                      {TFS.map(tf => (
                        <button key={tf} onClick={() => setTradeTf(tf)}
                          className={`py-1.5 rounded-lg text-[11px] font-black transition-all ${
                            tradeTf === tf
                              ? dk ? "bg-white text-black" : "bg-gray-900 text-white"
                              : dk ? "bg-white/8 text-white/40 hover:bg-white/15 hover:text-white/80" : "bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                          }`}>
                          {tf}
                        </button>
                      ))}
                    </div>

                    {/* Amount */}
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-4 gap-1">
                        {presets.map((a) => (
                          <button key={a} onClick={() => { setTradeAmt(a); setTradeCustom(String(a)); }}
                            className={`py-1.5 rounded-lg text-[11px] font-black transition-all ${
                              tradeAmt === a && tradeCustom === String(a)
                                ? dk ? "bg-white/20 text-white" : "bg-gray-300 text-gray-900"
                                : dk ? "bg-white/6 text-white/40 hover:bg-white/12 hover:text-white/80" : "bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                            }`}>
                            ${a}
                          </button>
                        ))}
                      </div>
                      <div className="relative">
                        <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[12px] font-bold ${muted}`}>$</span>
                        <input
                          type="number"
                          placeholder="custom"
                          value={tradeCustom}
                          onChange={(e) => { setTradeCustom(e.target.value); setTradeAmt(null); }}
                          className={`w-full pl-6 pr-3 py-2 rounded-xl text-[12px] font-bold border outline-none transition-all ${
                            dk ? "bg-white/5 border-white/8 text-white placeholder:text-white/20 focus:border-white/20" : "bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-300 focus:border-gray-400"
                          }`}
                        />
                      </div>
                    </div>

                    {/* Message */}
                    <textarea
                      value={tradeMsg}
                      onChange={(e) => setTradeMsg(e.target.value)}
                      maxLength={80}
                      placeholder={`${result?.symbol ?? "Token"} to the moon!`}
                      rows={2}
                      className={`w-full border text-[12px] font-bold p-3 rounded-xl outline-none resize-none transition-all ${
                        dk ? "bg-white/5 border-white/8 text-white placeholder:text-white/20 focus:border-white/20" : "bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-300 focus:border-gray-400"
                      }`}
                    />

                    {tradeError && (
                      <p className={`text-[11px] font-bold px-2 py-1.5 rounded-lg ${dk ? "text-red-400 bg-red-500/10 border border-red-500/20" : "text-red-600 bg-red-50 border border-red-200"}`}>
                        {tradeError}
                      </p>
                    )}

                    <button
                      onClick={handleQuickTrade}
                      disabled={!tradeReady || tradeLoading}
                      className={`w-full py-3 rounded-xl text-[13px] font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-gray-700"
                      }`}
                    >
                      {tradeLoading ? "Placing…" : `${tradeSide === "long" ? "▲ Long" : tradeSide === "short" ? "▼ Short" : "Place"} $${finalTradeAmt ?? "—"} · ${tradeTf}`}
                    </button>

                    <button onClick={() => { setShowTrade(false); setTradeError(null); }}
                      className={`text-[11px] font-bold ${muted} hover:opacity-70 transition-opacity`}>
                      ← Back
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
