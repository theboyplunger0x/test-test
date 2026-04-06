"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, Market } from "@/lib/api";
import { Coin, formatPrice } from "@/lib/mockData";
import { deployBetOnChain, takeBetOnChain, connectWallet } from "@/lib/wallet";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "24h"];
const QUICK_AMOUNTS = [10, 25, 50, 100];
const QUICK_AMOUNTS_TESTNET = [1, 5, 10, 25];

export default function OpenMarketModal({
  coin,
  dk,
  onClose,
  onSuccess,
  onViewToken,
  paperMode = false,
  isTestnet = false,
  walletAddress,
}: {
  coin: Coin;
  dk: boolean;
  onClose: () => void;
  onSuccess: (market: Market) => void;
  onViewToken?: () => void;
  paperMode?: boolean;
  isTestnet?: boolean;
  walletAddress?: string;
}) {
  const [mode, setMode] = useState<"call" | "market" | "sweep">("call");
  const [tf, setTf] = useState("1h");
  const [tagline, setTagline] = useState("");
  const [side, setSide] = useState<"long" | "short" | null>(null);
  const [customAmt, setCustomAmt] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [markets, setMarkets] = useState<Market[]>([]);

  // Fetch open markets for Market mode
  useEffect(() => {
    api.getMarkets().then(ms => setMarkets(ms.filter(m => m && m.symbol?.toUpperCase() === coin.symbol.toUpperCase() && m.status === "open" && (isTestnet ? !!m.is_testnet : !!m.is_paper === paperMode)))).catch(() => {});
  }, [coin.symbol, paperMode, isTestnet]);

  const bg        = dk ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const labelCls  = dk ? "text-white/40" : "text-gray-500";
  const closeCls  = dk ? "text-white/20 hover:text-white/50" : "text-gray-300 hover:text-gray-600";
  const inputCls  = dk
    ? "bg-white/6 border border-white/10 text-white placeholder:text-white/20 focus:border-white/30"
    : "bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-300 focus:border-gray-400";
  const tfActive   = dk ? "bg-white text-black" : "bg-gray-900 text-white";
  const tfInactive = dk ? "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70" : "bg-gray-100 text-gray-500 hover:bg-gray-200";
  const errorCls   = dk ? "text-red-400 bg-red-500/10 border border-red-500/20" : "text-red-600 bg-red-50 border border-red-200";
  const chainPill  = coin.chain === "SOL"
    ? dk ? "text-purple-300 bg-purple-500/20" : "text-purple-700 bg-purple-100"
    : coin.chain === "BASE"
    ? dk ? "text-blue-300 bg-blue-500/20" : "text-blue-700 bg-blue-100"
    : coin.chain === "BSC"
    ? dk ? "text-yellow-300 bg-yellow-500/20" : "text-yellow-700 bg-yellow-100"
    : dk ? "text-orange-300 bg-orange-500/20" : "text-orange-700 bg-orange-100";

  const openTfs = [...new Set(markets.map(m => m.timeframe))];
  const activeMarket = mode === "market" ? markets.find(m => m.timeframe === tf) ?? null : null;
  const canSubmit = side !== null && amount !== null && amount > 0 && !loading && (mode !== "market" || activeMarket !== null);

  async function handleSubmit() {
    if (!canSubmit || !side || !amount) return;
    setLoading(true);
    setError("");
    try {
      if (isTestnet) {
        if (!coin.ca) throw new Error("On-chain testnet requires a token with a contract address. Search by CA.");
        // On-chain flow: deploy escrow contract, user signs with MetaMask
        let wallet = walletAddress;
        if (!wallet) {
          wallet = await connectWallet();
          // Link wallet to account
          await api.linkWallet(wallet);
        }

        // Get entry price
        const dexData = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${coin.ca}`).then(r => r.json()) as any;
        const pairs = (dexData.pairs ?? []).filter((p: any) => p.priceUsd && parseFloat(p.priceUsd) > 0);
        const sorted = pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
        if (sorted.length === 0) throw new Error("No price found for this token");
        const entryPrice = sorted[0].priceUsd;

        setError("Sign transaction in MetaMask...");

        let contractAddress: string;
        let deployHash: string;
        try {
          const result = await deployBetOnChain({
            walletAddress: wallet,
            symbol: coin.symbol,
            ca: coin.ca!,
            timeframe: tf,
            entryPrice,
            side,
            amountGEN: amount,
          });
          contractAddress = result.contractAddress;
          deployHash = result.deployHash;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Deploy failed";
          if (msg.includes("User rejected") || msg.includes("denied")) throw new Error("Transaction rejected");
          throw err;
        }

        setError("Deploying on GenLayer... ⏳");

        // Track in backend
        await api.createEscrowBet({
          symbol: coin.symbol,
          chain: coin.chain,
          timeframe: tf,
          side,
          amount,
          ca: coin.ca,
          tagline: tagline.trim(),
        }).catch(() => {}); // best-effort tracking

        // Create a fake Market object for the UI
        onSuccess({
          id: contractAddress,
          symbol: coin.symbol,
          chain: coin.chain,
          timeframe: tf,
          entry_price: entryPrice,
          tagline: tagline.trim(),
          long_pool: side === "long" ? String(amount) : "0",
          short_pool: side === "short" ? String(amount) : "0",
          status: "open",
          closes_at: new Date(Date.now() + 60000).toISOString(),
          opener_id: "",
          created_at: new Date().toISOString(),
          is_paper: false,
          is_testnet: true,
        });
      } else if (mode === "call") {
        const market = await api.createMarket(coin.symbol, coin.chain, tf, tagline.trim(), paperMode && !isTestnet, coin.ca, isTestnet);
        await api.placeBet(market.id, side, amount);
        onSuccess(market);
      } else if (mode === "market" && activeMarket) {
        await api.placeBet(activeMarket.id, side, amount);
        onSuccess(activeMarket);
      } else if (mode === "sweep") {
        await api.sweep({ symbol: coin.symbol, chain: coin.chain, timeframe: "5m", side, amount, is_paper: paperMode && !isTestnet, is_testnet: isTestnet });
        onClose();
      }
    } catch (err: any) {
      setError(err.message ?? "Failed");
    } finally {
      setLoading(false);
    }
  }

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
        className={`relative w-[400px] rounded-2xl border p-6 shadow-2xl z-10 space-y-5 ${bg}`}
      >
        <button onClick={onClose} className={`absolute top-4 right-4 text-[18px] font-bold transition-colors ${closeCls}`}>✕</button>

        {/* Coin header */}
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <button onClick={onViewToken} className={`text-[20px] font-black transition-opacity hover:opacity-60 ${dk ? "text-white" : "text-gray-900"} ${onViewToken ? "cursor-pointer" : "cursor-default"}`}>${coin.symbol}</button>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${chainPill}`}>{coin.chain}</span>
            </div>
            <p className={`text-[12px] font-mono mt-0.5 ${labelCls}`}>${formatPrice(coin.price)}</p>
          </div>
        </div>

        {/* Mode selector */}
        <div className="flex items-center gap-3">
          {(["call", "market", "sweep"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`text-[11px] font-black transition-all ${mode === m ? dk ? "text-white" : "text-gray-900" : dk ? "text-white/30 hover:text-white/50" : "text-gray-400 hover:text-gray-600"}`}>
              {m === "call" ? "Call" : m === "market" ? "Market" : "Sweep"}
            </button>
          ))}
          <span className={`text-[11px] font-bold cursor-default ${dk ? "text-white/15" : "text-gray-300"}`}>
            Advanced ▾
          </span>
        </div>

        {/* Timeframe — Call: all, Market: only open, Sweep: none */}
        {mode === "call" && (
          <div>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${labelCls}`}>Timeframe</p>
            <div className="flex gap-1.5 flex-wrap">
              {TIMEFRAMES.map((t) => (
                <button key={t} onClick={() => setTf(t)}
                  className={`px-3 py-1.5 rounded-xl text-[12px] font-black transition-all ${tf === t ? tfActive : tfInactive}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
        {mode === "market" && (
          <div>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${labelCls}`}>Open Markets</p>
            {openTfs.length === 0 ? (
              <p className={`text-[11px] ${labelCls}`}>No open markets. Try making a Call.</p>
            ) : (
              <div className="flex gap-1.5 flex-wrap">
                {openTfs.map((t) => (
                  <button key={t} onClick={() => setTf(t)}
                    className={`px-3 py-1.5 rounded-xl text-[12px] font-black transition-all ${tf === t ? tfActive : tfInactive}`}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {mode === "sweep" && (
          <p className={`text-[10px] font-black uppercase tracking-widest ${labelCls} opacity-50`}>Sweeps all open timeframes</p>
        )}

        {/* Tagline — Call only */}
        {mode === "call" && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className={`text-[10px] font-black uppercase tracking-widest ${labelCls}`}>Your thesis</p>
              <span className={`text-[9px] font-bold tabular-nums ${tagline.length > 50 ? "text-amber-400" : labelCls}`}>{tagline.length}/60</span>
            </div>
            <input
              type="text"
              placeholder='"this thing is cooked"'
              maxLength={60}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              className={`w-full px-3 py-2.5 rounded-xl text-[13px] outline-none transition-all italic ${inputCls}`}
            />
          </div>
        )}

        {/* Side + first bet */}
        <div>
          <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${labelCls}`}>Your position</p>
          <div className="flex gap-2 mb-3">
            <button onClick={() => setSide("short")}
              className={`flex-1 py-2.5 rounded-xl text-[12px] font-black transition-all border ${
                side === "short"
                  ? dk ? "bg-red-500/25 border-red-500/40 text-red-300" : "bg-red-100 border-red-300 text-red-700"
                  : dk ? "bg-red-500/8 border-red-500/15 text-red-400/60 hover:bg-red-500/15" : "bg-red-50 border-red-200 text-red-400 hover:bg-red-100"
              }`}>▼ Short</button>
            <button onClick={() => setSide("long")}
              className={`flex-1 py-2.5 rounded-xl text-[12px] font-black transition-all border ${
                side === "long"
                  ? dk ? "bg-emerald-500/25 border-emerald-500/40 text-emerald-300" : "bg-emerald-100 border-emerald-300 text-emerald-700"
                  : dk ? "bg-emerald-500/8 border-emerald-500/15 text-emerald-400/60 hover:bg-emerald-500/15" : "bg-emerald-50 border-emerald-200 text-emerald-400 hover:bg-emerald-100"
              }`}>Long ▲</button>
          </div>

          <div className="grid grid-cols-4 gap-1.5 mb-2">
            {(isTestnet ? QUICK_AMOUNTS_TESTNET : QUICK_AMOUNTS).map((a) => (
              <button key={a} onClick={() => { setAmount(a); setCustomAmt(String(a)); }}
                className={`py-2 rounded-xl text-[11px] font-black transition-all ${
                  amount === a && customAmt === String(a)
                    ? dk ? "bg-white text-black" : "bg-gray-900 text-white"
                    : dk ? "bg-white/6 text-white/50 hover:bg-white/12 hover:text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}>{isTestnet ? `${a} GEN` : `$${a}`}</button>
            ))}
          </div>

          <div className="relative">
            <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${labelCls}`}>{isTestnet ? "GEN" : "$"}</span>
            <input type="number" placeholder="custom"
              value={customAmt}
              onChange={(e) => { setCustomAmt(e.target.value); setAmount(parseFloat(e.target.value) || null); }}
              className={`w-full pl-6 pr-3 py-2 rounded-xl text-[12px] font-bold outline-none transition-all ${inputCls}`}
            />
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className={`text-[12px] font-bold px-3 py-2 rounded-xl ${errorCls}`}>
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <button onClick={handleSubmit} disabled={!canSubmit}
          className={`w-full py-3 rounded-xl text-[13px] font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            isTestnet ? "bg-purple-500 text-white hover:bg-purple-400" : paperMode ? "bg-yellow-400 text-black hover:bg-yellow-300" : dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-black"
          }`}>
          {loading ? "Placing…"
            : mode === "call" ? (isTestnet ? `Make ${tf} call (testnet)` : paperMode ? `Make ${tf} call (paper)` : `Make ${tf} call`)
            : mode === "market" ? "Trade"
            : "Sweep"}
        </button>
      </motion.div>
    </div>
  );
}
