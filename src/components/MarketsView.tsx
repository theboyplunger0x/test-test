"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api, Market, OrderBook, OrderBookTimeframe, Order, SweepResult } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Props {
  dk:          boolean;
  liveMarkets: Market[];
}

type Side = "long" | "short";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "12h", "24h"];
const QUICK_AMOUNTS = [10, 25, 50, 100];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt$(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtMult(m: number): string {
  if (!m || m <= 0) return "—";
  if (m >= 100) return "100x+";
  return `${m.toFixed(2)}x`;
}

function multColor(m: number, dk: boolean): string {
  if (!m || m <= 0) return dk ? "text-white/20" : "text-gray-300";
  if (m >= 5)  return "text-emerald-400 font-bold";
  if (m >= 3)  return "text-emerald-400";
  if (m >= 2)  return dk ? "text-white/70" : "text-gray-600";
  return dk ? "text-white/40" : "text-gray-400";
}

function poolBar(total: number, maxPool: number): number {
  if (!maxPool) return 0;
  return Math.min(100, (total / maxPool) * 100);
}

// ── SweepModal ─────────────────────────────────────────────────────────────────

function SweepModal({
  dk, symbol, chain, timeframe, takerSide, book, onClose, onDone,
}: {
  dk: boolean; symbol: string; chain: string; timeframe: string;
  takerSide: Side; book: OrderBookTimeframe;
  onClose: () => void; onDone: (r: SweepResult) => void;
}) {
  const [amount, setAmount]   = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");

  const makerSide   = takerSide === "long" ? "short" : "long";
  const makerPool   = book[makerSide].total;
  const numericAmt  = parseFloat(amount) || 0;
  const takerMult   = makerPool > 0 && numericAmt > 0
    ? 1 + (makerPool * 0.95) / numericAmt
    : 0;

  const bg     = dk ? "bg-[#0e0e0e] border-white/10"  : "bg-white border-gray-200";
  const strong = dk ? "text-white"                     : "text-gray-900";
  const muted  = dk ? "text-white/40"                  : "text-gray-400";
  const input  = dk ? "bg-white/5 border-white/10 text-white placeholder-white/20"
                    : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400";
  const sideColor = takerSide === "long" ? "text-emerald-400" : "text-red-400";

  async function submit() {
    if (!numericAmt || numericAmt <= 0) { setErr("Enter an amount"); return; }
    setLoading(true); setErr("");
    try {
      const result = await api.sweep({ symbol, chain, timeframe, side: takerSide, amount: numericAmt });
      onDone(result);
    } catch (e: any) {
      setErr(e.message ?? "Sweep failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className={`relative w-full max-w-sm rounded-2xl border p-6 ${bg}`}
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <span className={`text-xs font-mono uppercase tracking-widest ${muted}`}>Sweep</span>
            <div className={`text-lg font-bold mt-0.5 ${strong}`}>
              GO <span className={sideColor}>{takerSide.toUpperCase()}</span> — {symbol} {timeframe}
            </div>
          </div>
          <button onClick={onClose} className={`text-xl leading-none ${muted} hover:opacity-70`}>×</button>
        </div>

        {/* Pool info */}
        <div className={`rounded-xl p-3 mb-4 text-sm font-mono ${dk ? "bg-white/4" : "bg-gray-50"}`}>
          <div className="flex justify-between mb-1">
            <span className={muted}>Available {makerSide.toUpperCase()} pool</span>
            <span className={strong}>{fmt$(makerPool)}</span>
          </div>
          <div className="flex justify-between">
            <span className={muted}>Your multiplier (est.)</span>
            <span className={takerMult >= 3 ? "text-emerald-400 font-bold" : strong}>
              {takerMult > 0 ? `${takerMult.toFixed(2)}x` : "—"}
            </span>
          </div>
        </div>

        {/* Amount */}
        <div className="mb-3">
          <div className={`text-xs mb-1.5 ${muted}`}>Your {takerSide} amount</div>
          <div className="flex gap-1.5 mb-2">
            {QUICK_AMOUNTS.map(q => (
              <button key={q}
                onClick={() => setAmount(String(q))}
                className={`flex-1 rounded-lg py-1.5 text-xs font-mono transition-colors
                  ${amount === String(q)
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : dk ? "bg-white/5 text-white/50 border border-white/8 hover:bg-white/10"
                          : "bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200"}`}
              >
                ${q}
              </button>
            ))}
          </div>
          <input
            type="number" min="1" step="1"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Custom amount..."
            className={`w-full rounded-xl border px-3 py-2.5 text-sm font-mono outline-none ${input}`}
          />
        </div>

        {err && <p className="text-red-400 text-xs mb-3">{err}</p>}

        <button
          onClick={submit}
          disabled={loading || !numericAmt}
          className={`w-full rounded-xl py-3 text-sm font-bold transition-all
            ${takerSide === "long"
              ? "bg-emerald-500 hover:bg-emerald-400 text-white"
              : "bg-red-500 hover:bg-red-400 text-white"}
            disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {loading ? "Sweeping…" : `GO ${takerSide.toUpperCase()} ${numericAmt ? fmt$(numericAmt) : ""}`}
        </button>
      </motion.div>
    </motion.div>
  );
}

// ── PlaceOrderForm ─────────────────────────────────────────────────────────────

function PlaceOrderForm({
  dk, symbol, chain, onDone,
}: {
  dk: boolean; symbol: string; chain: string; onDone: () => void;
}) {
  const [side, setSide]             = useState<Side>("short");
  const [autoReopen, setAutoReopen] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [err, setErr]               = useState("");
  const [success, setSuccess]       = useState(false);

  // Per-timeframe amounts
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const setAmt = (tf: string, v: string) => setAmounts(prev => ({ ...prev, [tf]: v }));

  const strong = dk ? "text-white"      : "text-gray-900";
  const muted  = dk ? "text-white/40"   : "text-gray-400";
  const input  = dk ? "bg-white/5 border-white/10 text-white placeholder-white/20"
                    : "bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400";

  const activeOrders = TIMEFRAMES
    .filter(tf => parseFloat(amounts[tf] ?? "") > 0)
    .map(tf => ({ timeframe: tf, amount: parseFloat(amounts[tf]) }));

  const total = activeOrders.reduce((s, o) => s + o.amount, 0);

  async function submit() {
    if (activeOrders.length === 0) { setErr("Select at least one timeframe"); return; }
    setLoading(true); setErr("");
    try {
      await api.createOrders(activeOrders.map(o => ({
        symbol, chain, timeframe: o.timeframe,
        side, amount: o.amount, auto_reopen: autoReopen,
      })));
      setSuccess(true);
      setAmounts({});
      setTimeout(() => { setSuccess(false); onDone(); }, 1500);
    } catch (e: any) {
      setErr(e.message ?? "Failed to place orders");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Side selector */}
      <div className={`flex rounded-xl p-1 mb-4 ${dk ? "bg-white/5" : "bg-gray-100"}`}>
        {(["short", "long"] as Side[]).map(s => (
          <button key={s}
            onClick={() => setSide(s)}
            className={`flex-1 rounded-lg py-2 text-sm font-bold transition-all ${
              side === s
                ? s === "short"
                  ? "bg-red-500 text-white shadow"
                  : "bg-emerald-500 text-white shadow"
                : `${muted} hover:opacity-70`
            }`}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Timeframe grid */}
      <div className="space-y-2 mb-4">
        {TIMEFRAMES.map(tf => (
          <div key={tf} className="flex items-center gap-2">
            <div className={`w-10 text-xs font-mono text-right ${muted}`}>{tf}</div>
            <div className="flex gap-1">
              {QUICK_AMOUNTS.map(q => (
                <button key={q}
                  onClick={() => setAmt(tf, amounts[tf] === String(q) ? "" : String(q))}
                  className={`w-9 rounded-lg py-1 text-xs font-mono transition-colors
                    ${amounts[tf] === String(q)
                      ? side === "short"
                        ? "bg-red-500/20 text-red-400 border border-red-500/30"
                        : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : dk ? "bg-white/5 text-white/40 border border-white/8 hover:bg-white/10"
                            : "bg-gray-100 text-gray-400 border border-gray-200 hover:bg-gray-200"}`}
                >
                  {q}
                </button>
              ))}
              <input
                type="number" min="1"
                value={amounts[tf] ?? ""}
                onChange={e => setAmt(tf, e.target.value)}
                placeholder="—"
                className={`w-16 rounded-lg border px-2 py-1 text-xs font-mono outline-none ${input}`}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Auto-reopen */}
      <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
        <div
          onClick={() => setAutoReopen(v => !v)}
          className={`w-9 h-5 rounded-full transition-colors relative ${
            autoReopen
              ? side === "short" ? "bg-red-500" : "bg-emerald-500"
              : dk ? "bg-white/15" : "bg-gray-200"
          }`}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            autoReopen ? "translate-x-4" : "translate-x-0.5"
          }`} />
        </div>
        <span className={`text-xs ${muted}`}>Auto-reopen after resolution</span>
      </label>

      {/* Summary + submit */}
      {activeOrders.length > 0 && (
        <div className={`rounded-xl p-3 mb-3 text-xs font-mono ${dk ? "bg-white/4" : "bg-gray-50"}`}>
          <div className={`${muted} mb-1`}>{activeOrders.length} order{activeOrders.length > 1 ? "s" : ""} • total</div>
          <div className={`text-base font-bold ${strong}`}>{fmt$(total)}</div>
        </div>
      )}

      {err && <p className="text-red-400 text-xs mb-2">{err}</p>}

      <button
        onClick={submit}
        disabled={loading || activeOrders.length === 0}
        className={`w-full rounded-xl py-3 text-sm font-bold transition-all
          ${side === "short"
            ? "bg-red-500 hover:bg-red-400 text-white"
            : "bg-emerald-500 hover:bg-emerald-400 text-white"}
          disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {loading ? "Placing…" : success ? "✓ Orders placed!" : `PLACE ${side.toUpperCase()} ORDER${activeOrders.length > 1 ? "S" : ""}`}
      </button>
    </div>
  );
}

// ── OrderBookTable ─────────────────────────────────────────────────────────────

function OrderBookTable({
  dk, book, onSweep,
}: {
  dk: boolean;
  book: OrderBook;
  onSweep: (tf: string, side: Side) => void;
}) {
  const strong  = dk ? "text-white"      : "text-gray-900";
  const muted   = dk ? "text-white/35"   : "text-gray-400";
  const border  = dk ? "border-white/6"  : "border-gray-100";
  const rowHov  = dk ? "hover:bg-white/3": "hover:bg-gray-50";

  const tfs = TIMEFRAMES.filter(tf => book.timeframes[tf]);
  const maxPool = Math.max(
    ...Object.values(book.timeframes).flatMap(tf => [tf.short.total, tf.long.total]),
    1
  );

  if (tfs.length === 0) {
    return (
      <div className={`text-center py-16 ${muted}`}>
        <div className="text-3xl mb-3">📭</div>
        <div className="text-sm">No pending orders for {book.symbol}</div>
        <div className="text-xs mt-1 opacity-60">Be the first to place an order</div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className={`grid grid-cols-[60px_1fr_1fr_80px_80px] gap-2 px-4 py-2 text-xs font-mono uppercase tracking-wider border-b ${border} ${muted}`}>
        <div>TF</div>
        <div>SHORT</div>
        <div>LONG</div>
        <div className="text-right">LONG ×</div>
        <div className="text-right">SHORT ×</div>
      </div>

      {tfs.map(tf => {
        const row   = book.timeframes[tf];
        const sBar  = poolBar(row.short.total, maxPool);
        const lBar  = poolBar(row.long.total,  maxPool);

        return (
          <div key={tf} className={`grid grid-cols-[60px_1fr_1fr_80px_80px] gap-2 px-4 py-3 border-b ${border} ${rowHov} transition-colors`}>
            {/* Timeframe */}
            <div className={`text-sm font-mono font-bold self-center ${strong}`}>{tf}</div>

            {/* SHORT side */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-mono ${row.short.total > 0 ? "text-red-400" : muted}`}>
                  {row.short.total > 0 ? fmt$(row.short.total) : "—"}
                </span>
                {row.short.total > 0 && (
                  <button
                    onClick={() => onSweep(tf, "long")}
                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                  >
                    TAKE
                  </button>
                )}
              </div>
              {row.short.total > 0 && (
                <div className={`h-1 rounded-full overflow-hidden ${dk ? "bg-white/8" : "bg-gray-100"}`}>
                  <div className="h-full rounded-full bg-red-400/60" style={{ width: `${sBar}%` }} />
                </div>
              )}
            </div>

            {/* LONG side */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-mono ${row.long.total > 0 ? "text-emerald-400" : muted}`}>
                  {row.long.total > 0 ? fmt$(row.long.total) : "—"}
                </span>
                {row.long.total > 0 && (
                  <button
                    onClick={() => onSweep(tf, "short")}
                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
                  >
                    TAKE
                  </button>
                )}
              </div>
              {row.long.total > 0 && (
                <div className={`h-1 rounded-full overflow-hidden ${dk ? "bg-white/8" : "bg-gray-100"}`}>
                  <div className="h-full rounded-full bg-emerald-400/60" style={{ width: `${lBar}%` }} />
                </div>
              )}
            </div>

            {/* Multipliers */}
            <div className={`text-right text-sm font-mono self-center ${multColor(row.long_multiplier, dk)}`}>
              {fmtMult(row.long_multiplier)}
            </div>
            <div className={`text-right text-sm font-mono self-center ${multColor(row.short_multiplier, dk)}`}>
              {fmtMult(row.short_multiplier)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── MyOrders ──────────────────────────────────────────────────────────────────

function MyOrders({ dk, onCancel }: { dk: boolean; onCancel: () => void }) {
  const [orders, setOrders]     = useState<Order[]>([]);
  const [loading, setLoading]   = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const strong = dk ? "text-white"    : "text-gray-900";
  const muted  = dk ? "text-white/40" : "text-gray-400";

  useEffect(() => {
    api.getMyOrders()
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function cancel(id: string) {
    setCancelling(id);
    try {
      await api.cancelOrder(id);
      setOrders(prev => prev.filter(o => o.id !== id));
      onCancel();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setCancelling(null);
    }
  }

  if (loading) return <div className={`text-xs ${muted} p-4`}>Loading…</div>;
  if (!orders.length) return <div className={`text-xs ${muted} p-4`}>No pending orders</div>;

  return (
    <div className="space-y-2 p-1">
      {orders.map(o => (
        <div key={o.id} className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${dk ? "bg-white/4" : "bg-gray-50"}`}>
          <div>
            <span className={`text-xs font-mono font-bold ${o.side === "short" ? "text-red-400" : "text-emerald-400"}`}>
              {o.side.toUpperCase()}
            </span>
            <span className={`text-xs font-mono ${strong} ml-1.5`}>{o.symbol} {o.timeframe}</span>
            {o.auto_reopen && (
              <span className={`ml-1.5 text-[10px] ${muted}`}>↻</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-mono ${strong}`}>${parseFloat(o.remaining_amount).toFixed(0)}</span>
            {o.status === "partially_filled" && (
              <span className={`text-[10px] font-mono ${muted}`}>partial</span>
            )}
            <button
              onClick={() => cancel(o.id)}
              disabled={cancelling === o.id}
              className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors
                ${dk ? "bg-white/8 text-white/50 hover:bg-red-500/20 hover:text-red-400"
                      : "bg-gray-100 text-gray-400 hover:bg-red-50 hover:text-red-500"}`}
            >
              {cancelling === o.id ? "…" : "cancel"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── SweepToast ────────────────────────────────────────────────────────────────

function SweepToast({ result, dk, onClose }: { result: SweepResult; dk: boolean; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 6000); return () => clearTimeout(t); }, [onClose]);
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[320px]"
    >
      <div className="bg-emerald-500 rounded-2xl px-5 py-4 text-white shadow-2xl">
        <div className="text-sm font-bold mb-1">✓ Sweep executed</div>
        <div className="text-xs opacity-90 font-mono">
          ${result.filled_amount.toFixed(0)} filled · {result.taker_multiplier}x multiplier · {result.fills_count} maker{result.fills_count !== 1 ? "s" : ""}
        </div>
      </div>
    </motion.div>
  );
}

// ── MarketsView ────────────────────────────────────────────────────────────────

export default function MarketsView({ dk, liveMarkets }: Props) {
  // Token selection
  const [inputVal, setInputVal]       = useState("");
  const [symbol, setSymbol]           = useState("");
  const [chain, setChain]             = useState("");
  const [showSugs, setShowSugs] = useState(false);

  // Book state
  const [book, setBook]               = useState<OrderBook | null>(null);
  const [bookLoading, setBookLoading] = useState(false);
  const [bookErr, setBookErr]         = useState("");

  // UI state
  const [rightTab, setRightTab]       = useState<"place" | "mine">("place");
  const [sweep, setSweep]             = useState<{ tf: string; side: Side } | null>(null);
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [myOrdersKey, setMyOrdersKey] = useState(0); // force remount to refresh

  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const bg       = dk ? "bg-[#0a0a0a]"        : "bg-[#f7f7f7]";
  const card     = dk ? "bg-[#111] border-white/6"  : "bg-white border-gray-200";
  const strong   = dk ? "text-white"           : "text-gray-900";
  const muted    = dk ? "text-white/40"        : "text-gray-400";
  const inputCls = dk ? "bg-white/5 border-white/10 text-white placeholder-white/25 focus:border-white/25"
                      : "bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-gray-400";

  // Deduplicated token suggestions from live markets
  const suggestions = Array.from(
    new Map(liveMarkets.map(m => [m.symbol, m])).values()
  ).filter(m =>
    inputVal.length > 0 &&
    m.symbol.toLowerCase().startsWith(inputVal.toLowerCase())
  ).slice(0, 8);

  function selectToken(sym: string, ch: string) {
    setSymbol(sym);
    setChain(ch);
    setInputVal(sym);
    setShowSugs(false);
    fetchBook(sym, ch);
  }

  const fetchBook = useCallback(async (sym: string, ch: string) => {
    if (!sym) return;
    setBookLoading(true); setBookErr("");
    try {
      const data = await api.getOrderBook(sym, ch || undefined);
      setBook(data);
    } catch (e: any) {
      setBookErr(e.message ?? "Failed to load book");
    } finally {
      setBookLoading(false);
    }
  }, []);

  // Poll every 5s when a token is selected
  useEffect(() => {
    if (!symbol) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchBook(symbol, chain), 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [symbol, chain, fetchBook]);

  function handleSweepDone(result: SweepResult) {
    setSweep(null);
    setSweepResult(result);
    fetchBook(symbol, chain);
    setMyOrdersKey(k => k + 1);
  }

  const totalShort = book ? Object.values(book.timeframes).reduce((s, tf) => s + tf.short.total, 0) : 0;
  const totalLong  = book ? Object.values(book.timeframes).reduce((s, tf) => s + tf.long.total,  0) : 0;
  const total      = totalShort + totalLong;
  const shortPct   = total > 0 ? Math.round((totalShort / total) * 100) : 50;

  return (
    <div className={`min-h-screen ${bg} pb-20`}>
      <div className="max-w-5xl mx-auto px-4 pt-6">

        {/* ── Header ── */}
        <div className="mb-6">
          <h1 className={`text-lg font-bold mb-0.5 ${strong}`}>Order Book</h1>
          <p className={`text-xs ${muted}`}>Place intents · Sweep liquidity · Short/Long any memecoin</p>
        </div>

        {/* ── Token search ── */}
        <div className="relative mb-6">
          <input
            value={inputVal}
            onChange={e => { setInputVal(e.target.value); setShowSugs(true); }}
            onFocus={() => setShowSugs(true)}
            onBlur={() => setTimeout(() => setShowSugs(false), 150)}
            onKeyDown={e => {
              if (e.key === "Enter" && inputVal) {
                selectToken(inputVal.toUpperCase(), chain || "SOL");
              }
            }}
            placeholder="Search token symbol… (e.g. DOGE, PEPE)"
            className={`w-full rounded-2xl border px-4 py-3 text-sm font-mono outline-none transition-colors ${inputCls}`}
          />
          {showSugs && suggestions.length > 0 && (
            <div className={`absolute top-full mt-1 w-full rounded-2xl border overflow-hidden z-20 shadow-xl ${dk ? "bg-[#111] border-white/10" : "bg-white border-gray-100"}`}>
              {suggestions.map(m => (
                <button key={m.id} onMouseDown={() => selectToken(m.symbol, m.chain)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${dk ? "hover:bg-white/5" : "hover:bg-gray-50"}`}
                >
                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${dk ? "bg-white/8 text-white/70" : "bg-gray-100 text-gray-600"}`}>
                    {m.chain}
                  </span>
                  <span className={`font-mono font-bold text-sm ${strong}`}>{m.symbol}</span>
                  <span className={`text-xs ml-auto ${muted}`}>${parseFloat(m.entry_price).toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {!symbol && (
          <div className={`text-center py-20 ${muted}`}>
            <div className="text-4xl mb-4">📊</div>
            <div className="text-sm">Search for a token to see its order book</div>
            <div className="text-xs mt-1 opacity-60">Or place orders on any supported token</div>
          </div>
        )}

        {symbol && (
          <div className="flex flex-col lg:flex-row gap-4">

            {/* ── Left: Order Book ── */}
            <div className={`flex-1 rounded-2xl border overflow-hidden ${card}`}>

              {/* Book header */}
              <div className={`flex items-center justify-between px-4 py-3 border-b ${dk ? "border-white/6" : "border-gray-100"}`}>
                <div>
                  <span className={`font-mono font-bold ${strong}`}>{symbol}</span>
                  {chain && <span className={`ml-2 text-xs font-mono ${muted}`}>{chain}</span>}
                  {bookLoading && <span className={`ml-2 text-xs ${muted}`}>↻</span>}
                </div>

                {/* Bias bar */}
                {total > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-400 font-mono">{shortPct}% S</span>
                    <div className={`w-24 h-2 rounded-full overflow-hidden ${dk ? "bg-white/8" : "bg-gray-100"}`}>
                      <div className="h-full bg-gradient-to-r from-red-400 to-emerald-400 rounded-full"
                        style={{ width: "100%",
                          background: `linear-gradient(to right, #f87171 ${shortPct}%, #34d399 ${shortPct}%)`
                        }}
                      />
                    </div>
                    <span className="text-xs text-emerald-400 font-mono">{100 - shortPct}% L</span>
                  </div>
                )}
              </div>

              {bookErr && (
                <div className="p-4 text-red-400 text-xs font-mono">{bookErr}</div>
              )}

              {!bookErr && book && (
                <OrderBookTable
                  dk={dk}
                  book={book}
                  onSweep={(tf, side) => setSweep({ tf, side })}
                />
              )}

              {!bookErr && !book && !bookLoading && (
                <div className={`text-center py-16 ${muted} text-sm`}>Loading…</div>
              )}
            </div>

            {/* ── Right: Place / My Orders ── */}
            <div className={`w-full lg:w-80 rounded-2xl border overflow-hidden ${card}`}>
              {/* Tab */}
              <div className={`flex border-b ${dk ? "border-white/6" : "border-gray-100"}`}>
                {(["place", "mine"] as const).map(tab => (
                  <button key={tab}
                    onClick={() => setRightTab(tab)}
                    className={`flex-1 py-3 text-xs font-mono font-bold uppercase tracking-wider transition-colors
                      ${rightTab === tab
                        ? `${strong} border-b-2 ${dk ? "border-white/40" : "border-gray-400"} -mb-px`
                        : muted}`}
                  >
                    {tab === "place" ? "Place Order" : "My Orders"}
                  </button>
                ))}
              </div>

              <div className="p-4">
                {rightTab === "place" ? (
                  <PlaceOrderForm
                    dk={dk} symbol={symbol} chain={chain}
                    onDone={() => {
                      fetchBook(symbol, chain);
                      setMyOrdersKey(k => k + 1);
                    }}
                  />
                ) : (
                  <MyOrders
                    key={myOrdersKey}
                    dk={dk}
                    onCancel={() => fetchBook(symbol, chain)}
                  />
                )}
              </div>
            </div>

          </div>
        )}
      </div>

      {/* ── Sweep Modal ── */}
      <AnimatePresence>
        {sweep && book?.timeframes[sweep.tf] && (
          <SweepModal
            dk={dk}
            symbol={symbol} chain={chain}
            timeframe={sweep.tf}
            takerSide={sweep.side}
            book={book.timeframes[sweep.tf]}
            onClose={() => setSweep(null)}
            onDone={handleSweepDone}
          />
        )}
      </AnimatePresence>

      {/* ── Sweep toast ── */}
      <AnimatePresence>
        {sweepResult && (
          <SweepToast
            result={sweepResult}
            dk={dk}
            onClose={() => setSweepResult(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
