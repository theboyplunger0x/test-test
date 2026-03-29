"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import CoinDetail from "./CoinDetail";
import { Coin } from "@/lib/mockData";
import { Market } from "@/lib/api";
import type { TokenInfo } from "@/lib/chartData";

interface Props {
  dk: boolean;
  liveCoins: Coin[];
  markets: Market[];
  onBet: (marketId: string, side: "long" | "short", amount: number, message?: string) => Promise<string | null>;
  onAutoTrade?: (side: "long" | "short", amount: number, timeframe: string, tagline?: string) => Promise<string | null>;
  onSweep?: (side: "long" | "short", amount: number, timeframe: string) => Promise<string | null>;
  onPlaceOrder?: (side: "long" | "short", amount: number, timeframe: string, autoReopen: boolean) => Promise<string | null>;
  onOpenMarket: (coin: Coin) => void;
  loggedIn: boolean;
  onAuthRequired: () => void;
  presets?: number[];
  paperMode?: boolean;
  onViewProfile?: (username: string) => void;
  externalSymbol?: string;          // controlled from outside (e.g. clicking a ticker)
  externalTokenInfo?: TokenInfo;    // pre-fetched token info from CA search
}

const CHAIN_COLORS: Record<string, string> = {
  SOL:  "text-purple-400",
  ETH:  "text-blue-400",
  BASE: "text-blue-300",
};

export default function SpotView({
  dk, liveCoins, markets, onBet, onAutoTrade, onSweep, onPlaceOrder, onOpenMarket,
  loggedIn, onAuthRequired, presets, paperMode, onViewProfile, externalSymbol, externalTokenInfo,
}: Props) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>(
    externalSymbol ?? liveCoins[0]?.symbol ?? "SOL"
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sync when parent sets a new symbol (e.g. clicking a ticker)
  useEffect(() => {
    if (externalSymbol && externalSymbol !== selectedSymbol) {
      setSelectedSymbol(externalSymbol);
    }
  }, [externalSymbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCoin = liveCoins.find(c => c.symbol.toUpperCase() === selectedSymbol.toUpperCase()) ?? liveCoins[0];
  const selectedChain = selectedCoin?.chain ?? "SOL";

  // scroll selected pill into view
  useEffect(() => {
    const el = scrollRef.current?.querySelector(`[data-symbol="${selectedSymbol}"]`) as HTMLElement | null;
    el?.scrollIntoView({ inline: "center", behavior: "smooth", block: "nearest" });
  }, [selectedSymbol]);

  const T = {
    tokenBar:    dk ? "bg-[#0c0c0c] border-white/6"  : "bg-white border-gray-100",
    pillActive:  dk ? "bg-white/12 text-white"        : "bg-gray-900 text-white",
    pillInactive:dk ? "text-white/40 hover:text-white/70 hover:bg-white/6" : "text-gray-500 hover:text-gray-800 hover:bg-gray-100",
    pricePlus:   "text-emerald-400",
    priceMinus:  "text-red-400",
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── Token picker bar ────────────────────────────────────────────────── */}
      <div className={`flex items-center gap-0 border-b shrink-0 ${T.tokenBar}`}>
        <div
          ref={scrollRef}
          className="flex items-center gap-1 overflow-x-auto px-3 py-2 scrollbar-none"
          style={{ scrollbarWidth: "none" }}
        >
          {liveCoins.map(coin => {
            const active   = coin.symbol === selectedSymbol;
            const positive = (coin.change24h ?? 0) >= 0;
            return (
              <button
                key={coin.symbol}
                data-symbol={coin.symbol}
                onClick={() => setSelectedSymbol(coin.symbol)}
                className={`flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-black transition-all ${active ? T.pillActive : T.pillInactive}`}
              >
                <span>{coin.symbol}</span>
                <span className={`text-[10px] font-bold ${positive ? T.pricePlus : T.priceMinus}`}>
                  {positive ? "+" : ""}{(coin.change24h ?? 0).toFixed(1)}%
                </span>
                {coin.chain && (
                  <span className={`text-[9px] font-bold opacity-50 ${CHAIN_COLORS[coin.chain] ?? ""}`}>
                    {coin.chain}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── CoinDetail exchange view ─────────────────────────────────────── */}
      {selectedCoin && (
        <motion.div
          key={selectedSymbol}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12 }}
          className="flex-1 overflow-hidden flex"
        >
          <CoinDetail
            symbol={selectedCoin.symbol}
            chain={selectedChain}
            timeframe="1h"
            theme={dk ? "dark" : "light"}
            markets={markets}
            onBet={onBet}
            onAutoTrade={onAutoTrade}
            onSweep={onSweep}
            onPlaceOrder={onPlaceOrder}
            onOpenMarket={() => onOpenMarket(selectedCoin)}
            onViewProfile={onViewProfile}
            loggedIn={loggedIn}
            onAuthRequired={onAuthRequired}
            presets={presets}
            paperMode={paperMode}
            tokenInfo={externalTokenInfo}
          />
        </motion.div>
      )}
    </div>
  );
}
