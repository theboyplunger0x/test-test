"use client";

import { motion } from "framer-motion";
import CallCard, { type Call } from "@/components/CallCard";
import DebateCard, { type Debate } from "@/components/DebateCard";

type CallsFilter = "fresh" | "debates";

interface CallsScreenProps {
  dk:             boolean;
  calls:          Call[];
  debates:        Debate[];
  callsLoading:   boolean;
  callsFilter:    CallsFilter;
  setCallsFilter: (f: CallsFilter) => void;
  loggedIn:       boolean;
  onAuthRequired: () => void;
  onViewProfile:  (username: string) => void;
  onViewToken:    (symbol: string, chain: string) => void;
  onMakeCall:     () => void;
  onFadeCall:     (call: Call, side: "long" | "short", amount: number) => Promise<string | null>;
  onFadeDebate:   (marketId: string, side: "long" | "short") => void;
}

const filterActive   = (dk: boolean) => dk ? "bg-white/12 text-white"            : "bg-gray-200 text-gray-900";
const filterInactive = (dk: boolean) => dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700";
const navBorder      = (dk: boolean) => dk ? "border-white/6"                    : "border-gray-100";

/**
 * Calls screen — social feed of recent calls + hot debates.
 *
 * Sub-filter switches between "Fresh Calls" (chronological grid of CallCards)
 * and "Hot Debates" (markets where both sides have callers with strong
 * positions). Empty states for both branches included.
 */
export default function CallsScreen({
  dk,
  calls,
  debates,
  callsLoading,
  callsFilter,
  setCallsFilter,
  loggedIn,
  onAuthRequired,
  onViewProfile,
  onViewToken,
  onMakeCall,
  onFadeCall,
  onFadeDebate,
}: CallsScreenProps) {
  return (
    <motion.div key="calls"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      className="flex-1 overflow-hidden flex flex-col">

      {/* Sub-filter: Fresh Calls | Hot Debates */}
      <div className={`flex gap-1.5 px-4 md:px-5 py-2 border-b shrink-0 ${navBorder(dk)}`}>
        {(["fresh", "debates"] as const).map(f => (
          <button key={f} onClick={() => setCallsFilter(f)}
            className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all ${callsFilter === f ? filterActive(dk) : filterInactive(dk)}`}>
            {f === "fresh" ? "Fresh Calls" : `Hot Debates${debates.length > 0 ? ` (${debates.length})` : ""}`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-5 py-4">
        {callsFilter === "fresh" ? (
          <>
            {callsLoading && calls.length === 0 ? (
              <div className={`flex items-center justify-center h-40 ${dk ? "text-white/30" : "text-gray-400"}`}>
                <span className="text-[13px] font-bold">Loading calls…</span>
              </div>
            ) : calls.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {calls.map((c, i) => (
                  <CallCard
                    key={c.id}
                    call={c}
                    dk={dk}
                    index={i}
                    onViewProfile={onViewProfile}
                    onViewToken={onViewToken}
                    onFade={async (call, side, amount) => {
                      if (!loggedIn) { onAuthRequired(); return null; }
                      if (!call.market_id) return "Cannot fade — market not found.";
                      if (call.status !== "open") return "This market is already closed.";
                      return onFadeCall(call, side, amount);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className={`flex flex-col items-center justify-center h-full gap-4 px-6`}>
                <span className="text-[40px]">📢</span>
                <div className="text-center">
                  <p className={`text-[15px] font-black ${dk ? "text-white/70" : "text-gray-700"}`}>No calls yet</p>
                  <p className={`text-[12px] font-bold mt-1 ${dk ? "text-white/30" : "text-gray-400"}`}>
                    Be the first to make a call. Open a market and share your thesis.
                  </p>
                </div>
                <button onClick={onMakeCall}
                  className={`px-5 py-2.5 rounded-xl text-[12px] font-black tracking-wide transition-all ${dk ? "bg-white text-black hover:bg-white/90" : "bg-gray-900 text-white hover:bg-gray-700"}`}>
                  Make a call →
                </button>
              </div>
            )}
          </>
        ) : (
          /* HOT DEBATES */
          debates.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {debates.map((d, i) => (
                <DebateCard
                  key={d.market.id}
                  debate={d}
                  dk={dk}
                  index={i}
                  onViewProfile={onViewProfile}
                  onViewToken={onViewToken}
                  onFade={(marketId, side) => {
                    if (!loggedIn) { onAuthRequired(); return; }
                    onFadeDebate(marketId, side);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className={`flex flex-col items-center justify-center h-full gap-4 px-6`}>
              <span className="text-[40px]">⚔️</span>
              <div className="text-center">
                <p className={`text-[15px] font-black ${dk ? "text-white/70" : "text-gray-700"}`}>No active debates</p>
                <p className={`text-[12px] font-bold mt-1 ${dk ? "text-white/30" : "text-gray-400"}`}>
                  Debates appear when both sides of a market have callers with strong positions.
                </p>
              </div>
            </div>
          )
        )}
      </div>
    </motion.div>
  );
}
