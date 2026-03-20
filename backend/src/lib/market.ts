// Market lifecycle helpers

export type Timeframe = "5m" | "15m" | "1h" | "4h" | "12h" | "24h";

const TF_MS: Record<Timeframe, number> = {
  "5m":  5  * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h":  60 * 60 * 1000,
  "4h":  4  * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

/** Returns the close time for a market: now + timeframe duration.
 *  Each market has its own independent countdown from the moment it opens. */
export function nextWindowClose(tf: Timeframe): Date {
  return new Date(Date.now() + TF_MS[tf]);
}

export const HOUSE_FEE = 0.05; // 5%

/** Parimutuel multiplier for the winning side */
export function calcMultiplier(myPool: number, otherPool: number): number {
  if (myPool === 0) return 0;
  return 1 + (otherPool * (1 - HOUSE_FEE)) / myPool;
}

/** Payout for a single position */
export function calcPayout(amount: number, myPool: number, otherPool: number): number {
  const mult = calcMultiplier(myPool, otherPool);
  return parseFloat((amount * mult).toFixed(6));
}

/** House fee taken from the losing pool */
export function calcHouseFee(losingPool: number): number {
  return parseFloat((losingPool * HOUSE_FEE).toFixed(6));
}
