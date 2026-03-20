// Market resolver — schedules exact resolution at close time using setTimeout.
// On startup, reschedules all open markets (handles backend restarts).

import { db } from "../db/client.js";
import { getPrice } from "../services/oracle.js";
import { calcPayout, calcHouseFee } from "../lib/market.js";

/** Resolve a single market by ID. Safe to call multiple times (idempotent via FOR UPDATE). */
export async function resolveMarket(marketId: string) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows: [market] } = await client.query(
      `SELECT * FROM markets WHERE id = $1 AND status = 'open' FOR UPDATE`, [marketId]
    );
    if (!market) { await client.query("COMMIT"); return; } // already resolved

    let exitPrice: number;
    try {
      exitPrice = await getPrice(market.symbol, market.chain);
    } catch {
      // Oracle failed — cancel and refund
      await client.query(`UPDATE markets SET status = 'cancelled' WHERE id = $1`, [market.id]);
      const { rows: positions } = await client.query(
        `SELECT * FROM positions WHERE market_id = $1`, [market.id]
      );
      for (const pos of positions) {
        const col = pos.is_paper ? "paper_balance_usd" : "balance_usd";
        await client.query(
          `UPDATE users SET ${col} = ${col} + $1 WHERE id = $2`,
          [pos.amount, pos.user_id]
        );
      }
      await client.query("COMMIT");
      console.log(`[resolver] Market ${market.id} (${market.symbol}) cancelled — oracle failure`);
      return;
    }

    const winnerSide = exitPrice > parseFloat(market.entry_price) ? "long" : "short";
    const loserSide  = winnerSide === "long" ? "short" : "long";
    const winPool    = parseFloat(market[`${winnerSide}_pool`]);
    const losePool   = parseFloat(market[`${loserSide}_pool`]);

    await client.query(
      `UPDATE markets SET status = 'resolved', exit_price = $1, winner_side = $2 WHERE id = $3`,
      [exitPrice, winnerSide, market.id]
    );

    const { rows: winners } = await client.query(
      `SELECT * FROM positions WHERE market_id = $1 AND side = $2`, [market.id, winnerSide]
    );
    for (const pos of winners) {
      const payout = calcPayout(parseFloat(pos.amount), winPool, losePool);
      await client.query(`UPDATE positions SET payout = $1 WHERE id = $2`, [payout, pos.id]);
      const col = pos.is_paper ? "paper_balance_usd" : "balance_usd";
      await client.query(
        `UPDATE users SET ${col} = ${col} + $1 WHERE id = $2`, [payout, pos.user_id]
      );
    }

    const fee = calcHouseFee(losePool);
    if (fee > 0) {
      await client.query(
        `INSERT INTO house_revenue (market_id, amount_usd) VALUES ($1, $2)`, [market.id, fee]
      );
    }

    await client.query("COMMIT");
    console.log(`[resolver] Market ${market.id} (${market.symbol}) resolved → ${winnerSide} wins. Fee: $${fee}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`[resolver] Error resolving market ${marketId}:`, err);
  } finally {
    client.release();
  }
}

/** Schedule a market to resolve at exactly its close time. */
export function scheduleResolution(marketId: string, closesAt: Date) {
  const delay = closesAt.getTime() - Date.now();
  if (delay <= 0) {
    // Already expired — resolve immediately
    resolveMarket(marketId);
  } else {
    setTimeout(() => resolveMarket(marketId), delay);
    console.log(`[resolver] Scheduled market ${marketId} in ${Math.round(delay / 1000)}s`);
  }
}

/** On startup: load all open markets and reschedule their resolution. */
export async function scheduleAllPendingMarkets() {
  const { rows } = await db.query(`SELECT id, closes_at FROM markets WHERE status = 'open'`);
  for (const market of rows) {
    scheduleResolution(market.id, new Date(market.closes_at));
  }
  console.log(`[resolver] Rescheduled ${rows.length} pending market(s)`);
}

// Keep the old export name for backwards compat (used nowhere now but safe to keep)
export async function resolveExpiredMarkets() {
  const { rows } = await db.query(`SELECT id, closes_at FROM markets WHERE status = 'open' AND closes_at <= NOW()`);
  for (const market of rows) resolveMarket(market.id);
}
