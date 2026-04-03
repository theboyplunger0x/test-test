// Market resolver — schedules exact resolution at close time using setTimeout.
// On startup, reschedules all open markets (handles backend restarts).

import { db } from "../db/client.js";
import { getPriceForResolution as getPrice } from "../services/oracle.js";
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
      exitPrice = await getPrice(market.symbol, market.chain, market.ca);
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

    // Fire-and-forget: auto_reopen + notifications
    (async () => {
      // Auto-reopen: recreate pending orders for makers who had auto_reopen = true
      try {
        const { rows: autoOrders } = await db.query(`
          SELECT DISTINCT o.*
          FROM fills f
          JOIN orders o ON o.id = f.maker_order_id
          WHERE f.market_id = $1
            AND o.auto_reopen = true
            AND o.status = 'filled'
        `, [market.id]);

        for (const order of autoOrders) {
          const col = order.is_paper ? "paper_balance_usd" : "balance_usd";
          const { rows: [u] } = await db.query(
            `SELECT ${col} FROM users WHERE id = $1`, [order.user_id]
          );
          if (!u || parseFloat(u[col]) < parseFloat(order.amount)) continue;

          await db.query(
            `UPDATE users SET ${col} = ${col} - $1 WHERE id = $2`,
            [order.amount, order.user_id]
          );
          await db.query(`
            INSERT INTO orders
              (user_id, symbol, chain, ca, timeframe, side, amount, remaining_amount,
               reserved_amount, is_paper, auto_reopen, tagline)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8, true, $9)
          `, [
            order.user_id, order.symbol, order.chain, order.ca,
            order.timeframe, order.side, order.amount,
            order.is_paper, order.tagline,
          ]);
          console.log(`[resolver] auto_reopen: new ${order.side} order for ${order.user_id} on ${order.symbol} ${order.timeframe}`);
        }
      } catch (err) {
        console.error("[resolver] auto_reopen error:", err);
      }
    })();

    // Fire-and-forget: create notifications for all position holders + followers
    (async () => {
      try {
        const BIG_TRADE_THRESHOLD = 50;
        const { rows: allPositions } = await db.query(
          `SELECT p.*, u.username FROM positions p JOIN users u ON u.id = p.user_id WHERE p.market_id = $1`,
          [market.id]
        );

        for (const pos of allPositions) {
          const won = pos.side === winnerSide;
          const posAmount = parseFloat(pos.amount);
          const pnl = won
            ? posAmount * (winPool > 0 ? (losePool * 0.95) / winPool : 0)
            : -posAmount;

          // market_resolved notification for the position holder
          await db.query(
            `INSERT INTO notifications (user_id, type, payload) VALUES ($1, 'market_resolved', $2)`,
            [pos.user_id, JSON.stringify({
              market_id: market.id,
              symbol: market.symbol,
              timeframe: market.timeframe,
              side: pos.side,
              winner_side: winnerSide,
              amount: posAmount,
              pnl: parseFloat(pnl.toFixed(2)),
            })]
          );

          // followed_big_trade notification for followers if |pnl| > threshold
          if (Math.abs(pnl) >= BIG_TRADE_THRESHOLD) {
            const { rows: followers } = await db.query(
              `SELECT follower_id FROM follows WHERE following_id = $1`,
              [pos.user_id]
            );
            const bigPayload = JSON.stringify({
              trader_username: pos.username,
              symbol: market.symbol,
              timeframe: market.timeframe,
              side: pos.side,
              amount: posAmount,
              pnl: parseFloat(pnl.toFixed(2)),
            });
            for (const f of followers) {
              await db.query(
                `INSERT INTO notifications (user_id, type, payload) VALUES ($1, 'followed_big_trade', $2)`,
                [f.follower_id, bigPayload]
              );
            }
          }
        }
      } catch (err) {
        console.error("[resolver] notification error:", err);
      }
    })();
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

  const future  = rows.filter(m => new Date(m.closes_at).getTime() > Date.now());
  const expired = rows.filter(m => new Date(m.closes_at).getTime() <= Date.now());

  // Schedule future markets normally
  for (const market of future) {
    scheduleResolution(market.id, new Date(market.closes_at));
  }

  // Resolve already-expired markets in batches of 5 to avoid DB exhaustion
  const BATCH = 5;
  for (let i = 0; i < expired.length; i += BATCH) {
    const batch = expired.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(m => resolveMarket(m.id)));
    if (i + BATCH < expired.length) {
      await new Promise(r => setTimeout(r, 200)); // brief pause between batches
    }
  }

  console.log(`[resolver] Rescheduled ${future.length} future market(s), resolved ${expired.length} expired market(s)`);
}

// Safety-net: resolve any markets that were missed (runs every 60s)
export async function resolveExpiredMarkets() {
  const { rows } = await db.query(`SELECT id FROM markets WHERE status = 'open' AND closes_at <= NOW() LIMIT 20`);
  const BATCH = 5;
  for (let i = 0; i < rows.length; i += BATCH) {
    await Promise.allSettled(rows.slice(i, i + BATCH).map(m => resolveMarket(m.id)));
    if (i + BATCH < rows.length) await new Promise(r => setTimeout(r, 200));
  }
}

// Expire unfilled orders and notify users (runs every 60s alongside resolver)
export async function expireUnfilledOrders() {
  try {
    const { rows } = await db.query(`
      UPDATE orders SET status = 'expired'
      WHERE status IN ('pending', 'partially_filled')
        AND expires_at IS NOT NULL AND expires_at <= NOW()
      RETURNING id, user_id, symbol, chain, timeframe, side, amount, remaining_amount, is_paper
    `);
    for (const o of rows) {
      // Refund remaining amount
      const refund = parseFloat(o.remaining_amount);
      if (refund > 0) {
        const col = o.is_paper ? "paper_balance_usd" : "balance_usd";
        await db.query(`UPDATE users SET ${col} = ${col} + $1 WHERE id = $2`, [refund, o.user_id]);
      }
      // Notify
      await db.query(
        `INSERT INTO notifications (user_id, type, payload) VALUES ($1, 'order_expired', $2)`,
        [o.user_id, JSON.stringify({
          symbol: o.symbol,
          timeframe: o.timeframe,
          side: o.side,
          amount: parseFloat(o.amount),
          refunded: refund,
        })]
      );
    }
    if (rows.length > 0) console.log(`[resolver] Expired ${rows.length} unfilled order(s)`);
  } catch (err) {
    console.error("[resolver] expireUnfilledOrders error:", err);
  }
}
