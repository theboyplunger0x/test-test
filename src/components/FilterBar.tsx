"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

export type Filter = "all" | "hot" | "juicy";

type FilterBarProps = {
  dk: boolean; navBorder: string;
  filter: Filter; setFilter: (v: Filter) => void;
  marketCapMax: number | null; setMarketCapMax: (v: number | null) => void;
  minPool: number | null; setMinPool: (v: number | null) => void;
  poolSortDir: "asc" | "desc" | null; setPoolSortDir: (v: "asc" | "desc" | null) => void;
  statusFilter: "open" | "closed"; setStatusFilter: (v: "open" | "closed") => void;
};

export default function FilterBar({ dk, navBorder, filter, setFilter, marketCapMax, setMarketCapMax, minPool, setMinPool, poolSortDir, setPoolSortDir, statusFilter, setStatusFilter }: FilterBarProps) {
  const [open, setOpen] = useState(false);

  const activeCount = [filter !== "all", marketCapMax !== null, minPool !== null, poolSortDir !== null].filter(Boolean).length;

  const btnBase = dk
    ? "border border-white/8 text-[11px] font-black px-3 py-1.5 rounded-xl transition-all"
    : "border border-gray-200 text-[11px] font-black px-3 py-1.5 rounded-xl transition-all";
  const btnActive   = dk ? "bg-white/14 text-white"              : "bg-gray-200 text-gray-900";
  const btnInactive = dk ? "bg-transparent text-white/35 hover:text-white/60 hover:bg-white/6" : "bg-transparent text-gray-400 hover:text-gray-700 hover:bg-gray-50";

  const chipOn  = dk ? "bg-white text-black"    : "bg-gray-900 text-white";
  const chipOff = dk ? "bg-white/6 text-white/40 hover:bg-white/10 hover:text-white/70 border border-white/8" : "bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-700 border border-gray-200";

  function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
      <button onClick={onClick} className={`text-[11px] font-black px-3 py-1.5 rounded-xl transition-all ${active ? chipOn : chipOff}`}>
        {label}
      </button>
    );
  }

  function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
      <div className="flex items-center gap-2">
        <span className={`text-[9px] font-black uppercase tracking-widest w-[62px] shrink-0 ${dk ? "text-white/20" : "text-gray-400"}`}>{label}</span>
        <div className="flex items-center gap-1.5 flex-wrap">{children}</div>
      </div>
    );
  }

  const activePills = [
    filter !== "all"       ? { label: filter === "hot" ? "🔥 Hot" : "🍋 Juicy", clear: () => setFilter("all") }         : null,
    marketCapMax !== null  ? { label: `Cap <${marketCapMax >= 1_000_000 ? "$1M" : marketCapMax >= 1_000 ? `$${marketCapMax / 1000}K` : `$${marketCapMax}`}`, clear: () => setMarketCapMax(null) } : null,
    minPool !== null       ? { label: `Pool >$${minPool}`, clear: () => setMinPool(null) }                              : null,
    poolSortDir !== null   ? { label: poolSortDir === "asc" ? "Pool ↑" : "Pool ↓", clear: () => setPoolSortDir(null) } : null,
  ].filter(Boolean) as { label: string; clear: () => void }[];

  return (
    <div className={`shrink-0 border-b ${navBorder}`}>
      <div className="flex items-center gap-2 px-4 md:px-5 py-2">
        <div className={`flex items-center rounded-xl p-0.5 border text-[11px] font-black shrink-0 ${dk ? "bg-white/4 border-white/8" : "bg-gray-100 border-gray-200"}`}>
          <button onClick={() => setStatusFilter("open")}
            className={`px-3 py-1 rounded-[9px] transition-all ${statusFilter === "open"
              ? (dk ? "bg-white text-black" : "bg-white text-gray-900 shadow-sm")
              : (dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700")
            }`}>
            Open
          </button>
          <button onClick={() => setStatusFilter("closed")}
            className={`px-3 py-1 rounded-[9px] transition-all ${statusFilter === "closed"
              ? (dk ? "bg-white text-black" : "bg-white text-gray-900 shadow-sm")
              : (dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700")
            }`}>
            Closed
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-1 overflow-x-auto scrollbar-none">
          {activePills.map(p => (
            <button key={p.label} onClick={p.clear}
              className={`flex items-center gap-1 shrink-0 text-[11px] font-black px-2.5 py-1 rounded-xl transition-all ${dk ? "bg-white/10 text-white/70 hover:bg-white/6" : "bg-gray-100 text-gray-600 hover:bg-gray-50"}`}>
              {p.label} <span className="text-[9px] opacity-50">✕</span>
            </button>
          ))}
        </div>

        <div className="relative shrink-0">
          <button onClick={() => setOpen(o => !o)} className={`flex items-center gap-1.5 ${btnBase} ${open || activeCount > 0 ? btnActive : btnInactive}`}>
            <span>Filters</span>
            {activeCount > 0 && (
              <span className={`text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center ${dk ? "bg-white/25 text-white" : "bg-gray-400 text-white"}`}>
                {activeCount}
              </span>
            )}
            <span className={`text-[9px] transition-transform duration-150 ${open ? "rotate-180" : ""}`}>▾</span>
          </button>

          <AnimatePresence>
            {open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.97, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className={`absolute right-0 top-full mt-1 z-20 rounded-2xl border p-3 space-y-2.5 min-w-[260px] ${dk ? "bg-[#161616] border-white/10 shadow-2xl" : "bg-white border-gray-200 shadow-xl"}`}
                >
                  {statusFilter === "open" && (
                    <Row label="Quality">
                      <Chip label="All"      active={filter === "all"}   onClick={() => setFilter("all")} />
                      <Chip label="🔥 Hot"   active={filter === "hot"}   onClick={() => setFilter("hot")} />
                      <Chip label="🍋 Juicy" active={filter === "juicy"} onClick={() => setFilter("juicy")} />
                    </Row>
                  )}
                  <Row label="Mkt Cap">
                    <Chip label="Any"    active={marketCapMax === null}       onClick={() => setMarketCapMax(null)} />
                    <Chip label="<$20K"  active={marketCapMax === 20_000}     onClick={() => setMarketCapMax(20_000)} />
                    <Chip label="<$100K" active={marketCapMax === 100_000}    onClick={() => setMarketCapMax(100_000)} />
                    <Chip label="<$1M"   active={marketCapMax === 1_000_000}  onClick={() => setMarketCapMax(1_000_000)} />
                  </Row>
                  {statusFilter === "open" && (
                    <Row label="Min Pool">
                      <Chip label="Any"   active={minPool === null} onClick={() => setMinPool(null)} />
                      <Chip label=">$50"  active={minPool === 50}   onClick={() => setMinPool(50)} />
                      <Chip label=">$250" active={minPool === 250}  onClick={() => setMinPool(250)} />
                      <Chip label=">$1K"  active={minPool === 1000} onClick={() => setMinPool(1000)} />
                    </Row>
                  )}
                  <Row label="Sort">
                    <Chip label="Default" active={poolSortDir === null}   onClick={() => setPoolSortDir(null)} />
                    <Chip label="Pool ↑"  active={poolSortDir === "asc"}  onClick={() => setPoolSortDir("asc")} />
                    <Chip label="Pool ↓"  active={poolSortDir === "desc"} onClick={() => setPoolSortDir("desc")} />
                  </Row>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
