"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Coin, formatPrice } from "@/lib/mockData";

type Direction = "long" | "short";

type Timeframe = {
  label: string;
  softClose: string;
  hot: boolean;
};

const TIMEFRAMES: Timeframe[] = [
  { label: "5m",  softClose: "last 1m",  hot: true  },
  { label: "15m", softClose: "last 3m",  hot: true  },
  { label: "1h",  softClose: "last 10m", hot: false },
  { label: "4h",  softClose: "last 30m", hot: false },
  { label: "12h", softClose: "last 1h",  hot: false },
  { label: "24h", softClose: "last 2h",  hot: false },
];

const AMOUNTS = [5, 25, 100, 500];
const FEE = 0.05;

const SHORT_TAUNTS = [
  "this thing is cooked",
  "fade me if you dare",
  "rug incoming, trust",
  "dead cat bounce. short.",
  "still holding? ngmi",
];

const LONG_TAUNTS = [
  "we are so back",
  "this is the bottom",
  "bulls stay winning",
  "diamond hands only",
  "you'll regret not longing",
];

interface Props {
  coin: Coin;
  onTrade: (params: { direction: Direction; amount: number; timeframe: string; message: string }) => void;
}

export default function TradePanel({ coin, onTrade }: Props) {
  const [direction, setDirection] = useState<Direction | null>(null);
  const [selectedTf, setSelectedTf] = useState<Timeframe>(TIMEFRAMES[2]); // default 1h
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const finalAmount = customAmount ? parseFloat(customAmount) : amount;
  const isReady = direction && finalAmount && finalAmount >= 5;
  const potentialWin = finalAmount ? finalAmount * 2 * (1 - FEE) : 0;

  const placeholderTaunts = direction === "short" ? SHORT_TAUNTS : direction === "long" ? LONG_TAUNTS : ["say something..."];
  const placeholder = placeholderTaunts[Math.floor(Math.random() * placeholderTaunts.length)];

  const handleExecute = () => {
    if (!isReady || !direction || !finalAmount) return;
    setSubmitted(true);
    onTrade({ direction, amount: finalAmount, timeframe: selectedTf.label, message: message.trim() });
    setTimeout(() => {
      setSubmitted(false);
      setDirection(null);
      setAmount(null);
      setCustomAmount("");
      setMessage("");
    }, 2500);
  };

  return (
    <div className="flex flex-col h-full w-[220px] min-w-[220px] border-l border-white/5 px-4 py-4 gap-4 overflow-y-auto">

      {/* Coin header */}
      <div>
        <p className="text-[10px] font-black tracking-widest text-white/25 uppercase mb-1">Open Challenge</p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[17px] font-black text-white">${coin.symbol}</span>
          <span className={`text-xs font-bold ${coin.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {coin.change24h >= 0 ? "+" : ""}{coin.change24h.toFixed(1)}%
          </span>
        </div>
        <p className="text-[11px] text-white/30 mt-0.5">${formatPrice(coin.price)}</p>
      </div>

      <div className="h-px bg-white/5" />

      {/* Direction */}
      <div>
        <p className="text-[10px] font-black tracking-widest text-white/25 uppercase mb-2">You think it goes</p>
        <div className="flex gap-2">
          <motion.button whileTap={{ scale: 0.94 }} onClick={() => setDirection("long")}
            className={`flex-1 py-3 rounded-xl text-[13px] font-black transition-all ${
              direction === "long"
                ? "bg-emerald-500 text-white"
                : "bg-emerald-500/10 text-emerald-500/50 hover:bg-emerald-500/20 hover:text-emerald-400"
            }`}>
            ▲ UP
          </motion.button>
          <motion.button whileTap={{ scale: 0.94 }} onClick={() => setDirection("short")}
            className={`flex-1 py-3 rounded-xl text-[13px] font-black transition-all ${
              direction === "short"
                ? "bg-red-500 text-white"
                : "bg-red-500/10 text-red-500/50 hover:bg-red-500/20 hover:text-red-400"
            }`}>
            ▼ DOWN
          </motion.button>
        </div>
      </div>

      {/* Timeframe */}
      <div>
        <p className="text-[10px] font-black tracking-widest text-white/25 uppercase mb-2">In how long</p>
        <div className="grid grid-cols-3 gap-1.5">
          {TIMEFRAMES.map((tf) => (
            <button key={tf.label} onClick={() => setSelectedTf(tf)}
              className={`py-2 rounded-xl text-[12px] font-black transition-all relative ${
                selectedTf.label === tf.label
                  ? "bg-white text-black"
                  : "bg-white/6 text-white/40 hover:bg-white/12 hover:text-white/80"
              }`}>
              {tf.hot && <span className="absolute -top-1 -right-1 text-[8px]">🔥</span>}
              {tf.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-white/20 mt-1.5 font-bold">
          Closes {selectedTf.softClose} before expiry
        </p>
      </div>

      {/* Amount */}
      <div>
        <div className="flex justify-between mb-2">
          <p className="text-[10px] font-black tracking-widest text-white/25 uppercase">Your stake</p>
          <p className="text-[10px] text-white/20 font-bold">min $5</p>
        </div>
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          {AMOUNTS.map((a) => (
            <button key={a} onClick={() => { setAmount(a); setCustomAmount(""); }}
              className={`py-2 rounded-xl text-[12px] font-black transition-all ${
                amount === a && !customAmount
                  ? "bg-white/15 text-white"
                  : "bg-white/5 text-white/35 hover:bg-white/10 hover:text-white/70"
              }`}>
              ${a}
            </button>
          ))}
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-[12px] font-bold">$</span>
          <input type="number" placeholder="custom" value={customAmount}
            onChange={(e) => { setCustomAmount(e.target.value); setAmount(null); }}
            className="w-full bg-white/5 text-white text-[12px] font-bold pl-7 pr-3 py-2 rounded-xl outline-none placeholder:text-white/20 focus:bg-white/10 transition-colors" />
        </div>
      </div>

      {/* Message */}
      <div>
        <p className="text-[10px] font-black tracking-widest text-white/25 uppercase mb-2">Your message</p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={80}
          rows={2}
          placeholder={placeholder}
          className="w-full bg-white/5 text-white text-[12px] font-bold px-3 py-2 rounded-xl outline-none placeholder:text-white/15 focus:bg-white/10 transition-colors resize-none leading-snug italic"
        />
        <p className="text-[10px] text-white/15 text-right mt-0.5">{message.length}/80</p>
      </div>

      {/* Payout preview */}
      <AnimatePresence>
        {isReady && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-xl bg-white/4 border border-white/8 p-3 space-y-1.5">
            <p className="text-[10px] font-black tracking-widest text-white/25 uppercase mb-2">If pool fills 1:1</p>
            <div className="flex justify-between">
              <span className="text-[11px] text-white/40 font-bold">Win</span>
              <span className="text-[14px] font-black text-emerald-400">+${potentialWin.toFixed(0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[11px] text-white/40 font-bold">Lose</span>
              <span className="text-[14px] font-black text-red-400">-${finalAmount?.toFixed(0)}</span>
            </div>
            <div className="flex justify-between pt-1.5 border-t border-white/5">
              <span className="text-[10px] text-white/20 font-bold">House fee</span>
              <span className="text-[10px] text-white/20 font-bold">5%</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Execute */}
      <div className="mt-auto space-y-2">
        <motion.button whileTap={{ scale: 0.97 }} onClick={handleExecute} disabled={!isReady}
          className={`w-full py-3.5 rounded-xl text-[13px] font-black tracking-wide uppercase transition-all ${
            submitted
              ? "bg-white/10 text-white/50"
              : isReady
                ? direction === "short"
                  ? "bg-red-500 text-white hover:bg-red-400"
                  : "bg-emerald-500 text-white hover:bg-emerald-400"
                : "bg-white/5 text-white/15 cursor-not-allowed"
          }`}>
          {submitted
            ? "Challenge posted ✓"
            : isReady
              ? `${direction === "short" ? "▼ Down" : "▲ Up"} · $${finalAmount} · ${selectedTf.label}`
              : "Fill in all fields"}
        </motion.button>

        {isReady && !submitted && (
          <p className="text-[10px] text-white/20 text-center font-bold">
            Posted to the feed · needs a counterpart
          </p>
        )}
      </div>
    </div>
  );
}
