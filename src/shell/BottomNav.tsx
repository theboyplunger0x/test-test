"use client";

import type { MainTab } from "@/lib/navTypes";

interface BottomNavProps {
  dk:          boolean;
  mainTab:     MainTab;
  accountActive: boolean;
  onNavigate:  (tab: MainTab) => void;
  onOpenAccount: () => void;
}

const ITEMS: { key: MainTab | "account"; label: string; icon: string }[] = [
  { key: "markets",   label: "Feed",      icon: "🏠" },
  { key: "trending",  label: "Discover",  icon: "🔍" },
  { key: "following", label: "Following", icon: "👥" },
  { key: "ranks",     label: "Ranks",     icon: "🏆" },
  { key: "account",   label: "Account",   icon: "👤" },
];

/**
 * Mobile-only bottom navigation bar.
 *
 * 5 tabs pinned at the bottom, blurred background, hidden on desktop.
 * The "account" tab opens the user's own ProfilePage.
 */
export default function BottomNav({ dk, mainTab, accountActive, onNavigate, onOpenAccount }: BottomNavProps) {
  return (
    <nav className={`md:hidden fixed bottom-0 left-0 right-0 z-30 border-t ${dk ? "bg-[#0a0a0a]/95 border-white/8" : "bg-white/95 border-gray-200"} backdrop-blur-lg`}>
      <div className="flex items-stretch justify-around">
        {ITEMS.map((item) => {
          const isAccount = item.key === "account";
          const isActive = isAccount
            ? accountActive
            : (item.key === mainTab || (item.key === "markets" && (mainTab === "calls" || mainTab === "feed" || mainTab === "sweep")));
          return (
            <button key={item.label}
              onClick={() => {
                if (isAccount) onOpenAccount();
                else onNavigate(item.key as MainTab);
              }}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-all ${
                isActive
                  ? dk ? "text-white" : "text-gray-900"
                  : dk ? "text-white/40" : "text-gray-400"
              }`}>
              <span className="text-[20px] leading-none">{item.icon}</span>
              <span className="text-[9px] font-black uppercase tracking-wider">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
