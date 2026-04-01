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

  const selectedCoin = liveCoins.find(c => c.symbol.toUpperCase() === selectedSymbol.toUpperCase()) ?? null;
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
      {/* ── CoinDetail exchange view ─────────────────────────────────────── */}
      <motion.div
        key={selectedSymbol}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.12 }}
        className="flex-1 overflow-hidden flex"
      >
        <CoinDetail
          symbol={selectedSymbol}
          chain={selectedChain}
          timeframe="1h"
          theme={dk ? "dark" : "light"}
          markets={markets}
          onBet={onBet}
          onAutoTrade={onAutoTrade}
          onSweep={onSweep}
          onPlaceOrder={onPlaceOrder}
          onOpenMarket={() => {
            if (selectedCoin) onOpenMarket(selectedCoin);
          }}
          onViewProfile={onViewProfile}
          loggedIn={loggedIn}
          onAuthRequired={onAuthRequired}
          presets={presets}
          paperMode={paperMode}
          tokenInfo={externalTokenInfo}
        />
      </motion.div>
    </div>
  );
}
