"use client";

import { motion } from "framer-motion";
import CallCard, { type Call } from "@/components/CallCard";

interface FollowingScreenProps {
  dk:             boolean;
  calls:          Call[];
  followingList:  string[];
  loggedIn:       boolean;
  onViewProfile:  (username: string) => void;
  onViewToken:    (symbol: string, chain: string) => void;
  onAuthRequired: () => void;
  onFade:         (marketId: string, side: "long" | "short", amount: number, fadedPositionId?: string) => Promise<string | null>;
}

/**
 * Following screen — shows calls from users you follow.
 */
export default function FollowingScreen({
  dk,
  calls,
  followingList,
  loggedIn,
  onViewProfile,
  onViewToken,
  onAuthRequired,
  onFade,
}: FollowingScreenProps) {
  const followedCalls = calls.filter(c => followingList.includes(c.username));

  return (
    <motion.div key="following"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      className="flex-1 overflow-hidden flex flex-col">
      <div className="flex-1 overflow-y-auto px-4 md:px-5 py-4">
        {followedCalls.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {followedCalls.map((c, i) => (
              <CallCard key={c.id} call={c} dk={dk} index={i}
                onViewProfile={onViewProfile}
                onViewToken={onViewToken}
                onFade={async (call, side, amount) => {
                  if (!loggedIn) { onAuthRequired(); return null; }
                  if (!call.market_id) return "Cannot fade — market not found.";
                  return onFade(call.market_id, side, amount, call.id);
                }}
              />
            ))}
          </div>
        ) : (
          <div className={`flex flex-col items-center justify-center h-full gap-4 px-6`}>
            <span className="text-[40px]">👥</span>
            <div className="text-center">
              <p className={`text-[15px] font-black ${dk ? "text-white/70" : "text-gray-700"}`}>No activity from people you follow</p>
              <p className={`text-[12px] font-bold mt-1 ${dk ? "text-white/30" : "text-gray-400"}`}>
                Follow traders to see their calls here.
              </p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
