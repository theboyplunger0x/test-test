// Market resolver — schedules exact resolution at close time using setTimeout.
// On startup, reschedules all open markets (handles backend restarts).

import { db } from "../db/client.js";
import { getPriceForResolution as getPrice } from "../services/oracle.js";
import { calcPayout, calcHouseFee } from "../lib/market.js";

/** Fire-and-forget on-chain cancel for Real mode markets with an on-chain ID. */
function cancelOnChainIfReal(market: any) {
  if (!market.is_paper && !market.is_testnet && market.onchain_market_id != null) {
    (async () => {
      try {
        const { cancelMarketOnChain } = await import("../services/vaultService.js");
        const txHash = await cancelMarketOnChain(BigInt(market.onchain_market_id));
        console.log(`[resolver] On-chain cancel: market ${market.onchain_market_id} TX: ${txHash}`);
      } catch (err: any) {
        console.error(`[resolver] On-chain cancel failed for market ${market.id}:`, err.message);
      }
    })();
  }
}

/** Resolve a single market by ID. Safe to call multiple times (idempotent via FOR UPDATE). */
export async function resolveMarket(marketId: string) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows: [market] } = await client.query(
      `SELECT * FROM markets WHERE id = $1 AND status = 'open' FOR UPDATE`, [marketId]
    );
    if (!market) { await client.query("COMMIT"); return; } // already resolved

    const longPool  = parseFloat(market.long_pool);
    const shortPool = parseFloat(market.short_pool);

    // No counterparty — cancel and refund, no oracle needed
    if (longPool === 0 || shortPool === 0) {
      await client.query(`UPDATE markets SET status = 'cancelled' WHERE id = $1`, [market.id]);
      const { rows: positions } = await client.query(
        `SELECT * FROM positions WHERE market_id = $1`, [market.id]
      );
      for (const pos of positions) {
        const col = pos.is_testnet ? "testnet_balance_gen" : pos.is_paper ? "paper_balance_usd" : "balance_usd";
        await client.query(`UPDATE users SET ${col} = ${col} + $1 WHERE id = $2`, [pos.amount, pos.user_id]);
      }
      await client.query("COMMIT");
      cancelOnChainIfReal(market);
      console.log(`[resolver] Market ${market.id} (${market.symbol}) cancelled — no counterparty (L:$${longPool} S:$${shortPool})`);
      return;
    }

    let exitPrice: number;
    try {
      exitPrice = await getPrice(market.symbol, market.chain, market.ca, market.is_testnet ? "bradbury" : market.ca ? "studionet" : false);
    } catch {
      // Oracle failed — cancel and refund
      await client.query(`UPDATE markets SET status = 'cancelled' WHERE id = $1`, [market.id]);
      const { rows: positions } = await client.query(
        `SELECT * FROM positions WHERE market_id = $1`, [market.id]
      );
      for (const pos of positions) {
        const col = pos.is_testnet ? "testnet_balance_gen" : pos.is_paper ? "paper_balance_usd" : "balance_usd";
        await client.query(
          `UPDATE users SET ${col} = ${col} + $1 WHERE id = $2`,
          [pos.amount, pos.user_id]
        );
      }
      await client.query("COMMIT");
      cancelOnChainIfReal(market);
      console.log(`[resolver] Market ${market.id} (${market.symbol}) cancelled — oracle failure`);
      return;
    }

    const entryPrice = parseFloat(market.entry_price);

    // Price unchanged = draw — refund everyone, no winner
    if (exitPrice === entryPrice) {
      await client.query(`UPDATE markets SET status = 'cancelled', exit_price = $1 WHERE id = $2`, [exitPrice, market.id]);
      const { rows: positions } = await client.query(`SELECT * FROM positions WHERE market_id = $1`, [market.id]);
      for (const pos of positions) {
        const col = pos.is_testnet ? "testnet_balance_gen" : pos.is_paper ? "paper_balance_usd" : "balance_usd";
        await client.query(`UPDATE users SET ${col} = ${col} + $1 WHERE id = $2`, [pos.amount, pos.user_id]);
      }
      await client.query("COMMIT");
      cancelOnChainIfReal(market);
      console.log(`[resolver] Market ${market.id} (${market.symbol}) draw — price unchanged @ $${exitPrice}, refunded`);
      return;
    }

    const winnerSide = exitPrice > entryPrice ? "long" : "short";
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
      const col = pos.is_testnet ? "testnet_balance_gen" : pos.is_paper ? "paper_balance_usd" : "balance_usd";
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

    // Real mode: resolve on-chain + accrue rewards from reserve
    if (!market.is_paper && !market.is_testnet && market.onchain_market_id != null) {
      (async () => {
        try {
          const { resolveMarketOnChain, accrueRewardsOnChain } = await import("../services/vaultService.js");
          const toUsdc = (usd: number) => BigInt(Math.round(usd * 1_000_000));

          // 1. Resolve market on-chain
          const txHash = await resolveMarketOnChain(BigInt(market.onchain_market_id), exitPrice);
          console.log(`[resolver] On-chain resolve: market ${market.onchain_market_id} TX: ${txHash}`);

          // 2. Calculate cashback + referral rewards for all positions in this market
          const { rows: positions } = await db.query(
            `SELECT p.user_id, p.amount, p.side, u.wallet_address, u.tier, u.referred_by
             FROM positions p JOIN users u ON p.user_id = u.id
             WHERE p.market_id = $1`,
            [market.id]
          );

          // Tier → cashback/referral rates (in BPS)
          const CASHBACK_RATES: Record<string, number> = { basic: 0, pro: 1000, top: 2000, elite: 2500 };
          const REFERRAL_RATES: Record<string, number> = { basic: 500, pro: 1000, top: 1500, elite: 2000 };

          const rewardUsers: `0x${string}`[] = [];
          const rewardAmounts: bigint[] = [];

          for (const pos of positions) {
            if (!pos.wallet_address) continue;
            // Fee attributable to this position = position_amount / total_pool * total_fee
            // Simplified: only losers generate fee, so only process losing positions
            if (pos.side === winnerSide) continue; // winners don't generate fee
            const posAmount = parseFloat(pos.amount);
            const feeFromThisPos = posAmount * 0.05; // 5% fee
            const rewardPoolFromPos = feeFromThisPos * 0.5; // 50% goes to reward reserve

            // Cashback to the bettor
            const tier = pos.tier || "basic";
            const cashbackRate = CASHBACK_RATES[tier] ?? 0;
            if (cashbackRate > 0) {
              const cashback = rewardPoolFromPos * cashbackRate / 10000;
              if (cashback > 0.001) { // min threshold
                rewardUsers.push(pos.wallet_address as `0x${string}`);
                rewardAmounts.push(toUsdc(cashback));
              }
            }

            // Referral to the referrer
            if (pos.referred_by) {
              const { rows: [referrer] } = await db.query(
                `SELECT wallet_address, tier FROM users WHERE id = $1`, [pos.referred_by]
              );
              if (referrer?.wallet_address) {
                const refRate = REFERRAL_RATES[referrer.tier || "basic"] ?? 500;
                const referralReward = rewardPoolFromPos * refRate / 10000;
                if (referralReward > 0.001) {
                  rewardUsers.push(referrer.wallet_address as `0x${string}`);
                  rewardAmounts.push(toUsdc(referralReward));
                }
              }
            }
          }

          // 3. Accrue rewards on-chain (batch)
          if (rewardUsers.length > 0) {
            const accrueTx = await accrueRewardsOnChain(
              rewardUsers, rewardAmounts, BigInt(market.onchain_market_id)
            );
            console.log(`[resolver] Accrued ${rewardUsers.length} rewards on-chain TX: ${accrueTx}`);
          }
        } catch (err: any) {
          console.error(`[resolver] On-chain resolve/rewards failed for market ${market.id}:`, err.shortMessage ?? err.message, err.stack?.split("\n").slice(0, 3).join(" "));
        }
      })();
    }

    // Testnet: pay winners on-chain via GEN transfer from treasury
    if (market.is_testnet) {
      (async () => {
        try {
          const { createWalletClient, createPublicClient, http, parseEther } = await import("viem");
          const { privateKeyToAccount } = await import("viem/accounts");
          const CHAIN_RPC = "https://zksync-os-testnet-genlayer.zksync.dev";
          const chain = { id: 4221, name: "Bradbury", nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 }, rpcUrls: { default: { http: [CHAIN_RPC] } } };
          const account = privateKeyToAccount(`0x${process.env.GENLAYER_PRIVATE_KEY!.replace(/^0x/, "")}` as `0x${string}`);
          const wallet = createWalletClient({ account, chain, transport: http(CHAIN_RPC) });

          for (const pos of winners) {
            const { rows: [u] } = await db.query(`SELECT wallet_address FROM users WHERE id = $1`, [pos.user_id]);
            if (!u?.wallet_address) continue;
            const payout = calcPayout(parseFloat(pos.amount), winPool, losePool);
            const payoutWei = parseEther(payout.toFixed(6));
            const txHash = await wallet.sendTransaction({ to: u.wallet_address as `0x${string}`, value: payoutWei });
            console.log(`[resolver] Testnet payout: ${payout.toFixed(4)} GEN → ${u.wallet_address.slice(0, 10)}... TX: ${txHash}`);
          }
        } catch (err) {
          console.error("[resolver] Testnet payout error:", err);
        }
      })();
    }

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
          const col = order.is_testnet ? "testnet_balance_gen" : order.is_paper ? "paper_balance_usd" : "balance_usd";
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
        const col = o.is_testnet ? "testnet_balance_gen" : o.is_paper ? "paper_balance_usd" : "balance_usd";
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
