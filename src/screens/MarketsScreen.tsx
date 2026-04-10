"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import MarketsView from "@/components/MarketsView";
import type { Market } from "@/lib/api";
import type { Call } from "@/components/CallCard";
import type { Debate } from "@/components/DebateCard";

type Variant = "markets" | "sweep";

interface MarketsScreenProps {
  variant:        Variant;
  dk:             boolean;
  isTestnet:      boolean;
  paperMode:      boolean;
  liveMarkets:    Market[];
  calls:          Call[];
  debates:        Debate[];
  shakingIds:     Set<string>;
  presets:        number[];
  loggedIn:       boolean;
  onAuthRequired: () => void;
  onSelectToken:  (symbol: string, chain?: string) => void;
  onViewProfile:  (username: string) => void;
  onViewToken:    (symbol: string, chain: string) => void;
  onBet:          (id: string, side: "short" | "long", amount: number, message?: string, faded_position_id?: string) => Promise<string | null>;
  onFadeCall:     (call: Call, side: "long" | "short", amount: number) => Promise<string | null>;
  onFadeDebate:   (marketId: string, side: "long" | "short") => void;
  /** Optional right-side slot. Used by "markets" variant for the tape sidebar. */
  rightSlot?:     ReactNode;
}

/**
 * Markets screen — wraps MarketsView for both the standard "markets" tab and
 * the "sweep" (Hot X's) tab. The two tabs share the same data and handlers;
 * sweep just hides the filter bar, defaults to the "hot" filter, and skips
 * the tape sidebar.
 */
export default function MarketsScreen({
  variant,
  dk,
  isTestnet,
  paperMode,
  liveMarkets,
  calls,
  debates,
  shakingIds,
  presets,
  loggedIn,
  onAuthRequired,
  onSelectToken,
  onViewProfile,
  onViewToken,
  onBet,
  onFadeCall,
  onFadeDebate,
  rightSlot,
}: MarketsScreenProps) {
  const isSweep = variant === "sweep";

  return (
    <motion.div key={variant}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      className="flex-1 overflow-hidden flex">
      <div className="flex-1 overflow-hidden flex flex-col">
        <MarketsView
          dk={dk}
          isTestnet={isTestnet}
          liveMarkets={liveMarkets}
          paperMode={paperMode}
          presets={presets}
          {...(isSweep ? { defaultFilter: "hot" as const, hideFilterBar: true } : {})}
          onSelectToken={onSelectToken}
          onViewProfile={onViewProfile}
          onBet={onBet}
          shakingIds={shakingIds}
          calls={calls}
          debates={debates}
          onFadeCall={onFadeCall}
          onFadeDebate={onFadeDebate}
          onViewToken={onViewToken}
          loggedIn={loggedIn}
          onAuthRequired={onAuthRequired}
        />
      </div>
      {rightSlot && <div className="hidden md:flex">{rightSlot}</div>}
    </motion.div>
  );
}
