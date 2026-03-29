import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { getPrice } from "../services/oracle.js";
import { nextWindowClose, calcMultiplier, type Timeframe } from "../lib/market.js";
import { scheduleResolution } from "../workers/resolver.js";

const VALID_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "12h", "24h"];

export async function orderRoutes(app: FastifyInstance) {

  // ── GET /orders/book?symbol=BTC&chain=SOL ───────────────────────────────────
  // Returns the full intent book for a token, grouped by timeframe.
  // Each timeframe entry includes both sides' pending totals + implied multipliers.
  app.get("/orders/book", async (req, reply) => {
    const { symbol, chain } = req.query as any;
    if (!symbol) return reply.status(400).send({ error: "symbol required" });

    const isPaper = (req.query as any).paper === "true";
    const params: any[] = [symbol.toUpperCase(), isPaper];
    let paramIdx = 3;
    const chainClause = chain ? `AND UPPER(o.chain) = UPPER($${paramIdx++})` : "";
    if (chain) params.push(chain);

    const { rows } = await db.query(`
      SELECT o.id, o.timeframe, o.side, o.remaining_amount, o.auto_reopen,
             o.created_at, o.is_paper,
             u.username, u.avatar_url, u.tier
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE UPPER(o.symbol) = $1
        AND o.is_paper = $2
        ${chainClause}
        AND o.status IN ('pending', 'partially_filled')
        AND (o.expires_at IS NULL OR o.expires_at > NOW())
      ORDER BY o.created_at ASC
    `, params);

    // Group by timeframe
    const book: Record<string, any> = {};
    for (const row of rows) {
      if (!book[row.timeframe]) {
        book[row.timeframe] = {
          timeframe: row.timeframe,
          short: { total: 0, orders: [] },
          long:  { total: 0, orders: [] },
        };
      }
      const side = row.side as "long" | "short";
      const rem = parseFloat(row.remaining_amount);
      book[row.timeframe][side].total += rem;
      book[row.timeframe][side].orders.push({
        id:               row.id,
        username:         row.username,
        avatar_url:       row.avatar_url,
        tier:             row.tier,
        remaining_amount: rem,
        auto_reopen:      row.auto_reopen,
        created_at:       row.created_at,
      });
    }

    // Compute implied multipliers per timeframe
    // long_multiplier  = "if you LONG X against the existing SHORT pool"
    // short_multiplier = "if you SHORT X against the existing LONG pool"
    // We show what you'd get if you matched your amount against the full other-side pool.
    // At equal amounts → 1.95x. At small vs large pool → can be much higher.
    for (const tf of Object.values(book) as any[]) {
      const s = tf.short.total;
      const l = tf.long.total;
      tf.long_multiplier  = s > 0 ? (l > 0 ? parseFloat(calcMultiplier(l, s).toFixed(3)) : 999) : 0;
      tf.short_multiplier = l > 0 ? (s > 0 ? parseFloat(calcMultiplier(s, l).toFixed(3)) : 999) : 0;
    }

    return {
      symbol: symbol.toUpperCase(),
      chain:  chain?.toUpperCase() ?? null,
      timeframes: book,
    };
  });

  // ── GET /orders/mine ─────────────────────────────────────────────────────────
  // Returns the authenticated user's own orders.
  // ?history=1 → include filled/cancelled/expired (last 50), default is active only.
  app.get("/orders/mine", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const user = (req as any).user;
    const history = (req.query as any).history === "1";
    const { rows } = history
      ? await db.query(`
          SELECT * FROM orders
          WHERE user_id = $1
            AND status IN ('filled', 'cancelled', 'expired')
          ORDER BY created_at DESC LIMIT 50
        `, [user.userId])
      : await db.query(`
          SELECT * FROM orders
          WHERE user_id = $1
            AND status IN ('pending', 'partially_filled')
          ORDER BY created_at DESC
        `, [user.userId]);
    return rows;
  });

  // ── POST /orders ─────────────────────────────────────────────────────────────
  // Create 1 or N orders in a single batch. Reserves balance immediately.
  // Body: single order object OR array of order objects.
  app.post("/orders", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const user = (req as any).user;
    const body = req.body as any;

    const items: any[] = Array.isArray(body) ? body : [body];
    if (items.length === 0) return reply.status(400).send({ error: "No orders provided" });
    if (items.length > 10) return reply.status(400).send({ error: "Max 10 orders per batch" });

    // Validate all items before touching the DB
    for (const item of items) {
      if (!item.symbol || !item.chain || !item.timeframe || !item.side || !item.amount) {
        return reply.status(400).send({ error: "symbol, chain, timeframe, side, amount are required" });
      }
      if (!VALID_TIMEFRAMES.includes(item.timeframe)) {
        return reply.status(400).send({ error: `Invalid timeframe: ${item.timeframe}` });
      }
      if (!["long", "short"].includes(item.side)) {
        return reply.status(400).send({ error: "side must be 'long' or 'short'" });
      }
      if (parseFloat(item.amount) <= 0) {
        return reply.status(400).send({ error: "amount must be > 0" });
      }
    }

    const isPaper     = items[0].is_paper ?? false;
    const totalAmount = items.reduce((s: number, i: any) => s + parseFloat(i.amount), 0);
    const balanceCol  = isPaper ? "paper_balance_usd" : "balance_usd";

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Lock user row and check balance
      const { rows: [userRow] } = await client.query(
        `SELECT ${balanceCol} FROM users WHERE id = $1 FOR UPDATE`, [user.userId]
      );
      if (!userRow) { await client.query("ROLLBACK"); return reply.status(404).send({ error: "User not found" }); }

      const available = parseFloat(userRow[balanceCol]);
      if (available < totalAmount) {
        await client.query("ROLLBACK");
        return reply.status(400).send({
          error: `Insufficient balance. Need $${totalAmount.toFixed(2)}, have $${available.toFixed(2)}`,
        });
      }

      // Reserve balance upfront
      await client.query(
        `UPDATE users SET ${balanceCol} = ${balanceCol} - $1 WHERE id = $2`,
        [totalAmount, user.userId]
      );

      // Insert orders
      const created = [];
      for (const item of items) {
        const amt = parseFloat(item.amount);
        const { rows: [order] } = await client.query(`
          INSERT INTO orders
            (user_id, symbol, chain, ca, timeframe, side, amount, remaining_amount, reserved_amount,
             is_paper, auto_reopen, expires_at, tagline)
          VALUES ($1, UPPER($2), UPPER($3), $4, $5, $6, $7, $7, $7, $8, $9, $10, $11)
          RETURNING *
        `, [
          user.userId,
          item.symbol,
          item.chain,
          item.ca         ?? null,
          item.timeframe,
          item.side,
          amt,
          isPaper,
          item.auto_reopen ?? false,
          item.expires_at  ?? null,
          item.tagline     ?? "",
        ]);
        created.push(order);
      }

      const { rows: [updated] } = await client.query(
        `SELECT balance_usd, paper_balance_usd FROM users WHERE id = $1`, [user.userId]
      );

      await client.query("COMMIT");
      return reply.status(201).send({
        orders:            created,
        new_balance:       updated.balance_usd,
        new_paper_balance: updated.paper_balance_usd,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // ── PATCH /orders/:id ────────────────────────────────────────────────────────
  // Toggle auto_reopen on a pending/partially_filled order.
  app.patch("/orders/:id", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { id }       = req.params as any;
    const user         = (req as any).user;
    const { auto_reopen } = req.body as any;
    if (typeof auto_reopen !== "boolean") return reply.status(400).send({ error: "auto_reopen must be a boolean" });

    const { rows: [order] } = await db.query(
      `UPDATE orders SET auto_reopen = $1
       WHERE id = $2 AND user_id = $3 AND status IN ('pending', 'partially_filled')
       RETURNING *`,
      [auto_reopen, id, user.userId]
    );
    if (!order) return reply.status(404).send({ error: "Order not found or already closed" });
    return { ok: true, auto_reopen: order.auto_reopen };
  });

  // ── DELETE /orders/:id ───────────────────────────────────────────────────────
  // Cancel a pending/partially_filled order and refund remaining reserved balance.
  app.delete("/orders/:id", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const { id } = req.params as any;
    const user   = (req as any).user;

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const { rows: [order] } = await client.query(
        `SELECT * FROM orders WHERE id = $1 AND status IN ('pending','partially_filled') FOR UPDATE`, [id]
      );
      if (!order) {
        await client.query("ROLLBACK");
        return reply.status(404).send({ error: "Order not found or already filled/cancelled" });
      }
      if (order.user_id !== user.userId) {
        await client.query("ROLLBACK");
        return reply.status(403).send({ error: "Not your order" });
      }

      const balanceCol = order.is_paper ? "paper_balance_usd" : "balance_usd";
      await client.query(
        `UPDATE users SET ${balanceCol} = ${balanceCol} + $1 WHERE id = $2`,
        [order.reserved_amount, user.userId]
      );
      await client.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [id]);

      const { rows: [updated] } = await client.query(
        `SELECT balance_usd, paper_balance_usd FROM users WHERE id = $1`, [user.userId]
      );

      await client.query("COMMIT");
      return {
        ok:                true,
        refunded:          order.reserved_amount,
        new_balance:       updated.balance_usd,
        new_paper_balance: updated.paper_balance_usd,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // ── POST /orders/sweep ───────────────────────────────────────────────────────
  // Taker sweeps all pending orders on the opposite side for a given symbol+timeframe.
  //
  // Pool model: ALL maker orders go into the market pool (makerPool).
  // Taker pays min(requested, available). This creates an asymmetric pool where
  // small taker amounts get much higher multipliers when short/long bias is heavy.
  //
  // Example: $450 SHORT pending, taker puts in $100 LONG →
  //   long_multiplier  = 1 + (450 * 0.95) / 100 = 5.275x
  //   short_multiplier = 1 + (100 * 0.95) / 450 = 1.21x
  app.post("/orders/sweep", { preHandler: [(app as any).authenticate] }, async (req, reply) => {
    const taker = (req as any).user;
    const {
      symbol, chain, timeframe,
      side: takerSide,
      amount: rawAmount,
      is_paper = false,
      message: takerMessage,
    } = req.body as any;

    if (!symbol || !chain || !timeframe || !takerSide || !rawAmount) {
      return reply.status(400).send({ error: "symbol, chain, timeframe, side, amount required" });
    }
    if (!VALID_TIMEFRAMES.includes(timeframe)) {
      return reply.status(400).send({ error: "Invalid timeframe" });
    }
    if (!["long", "short"].includes(takerSide)) {
      return reply.status(400).send({ error: "side must be 'long' or 'short'" });
    }

    const takerWants = parseFloat(rawAmount);
    if (takerWants <= 0) return reply.status(400).send({ error: "amount must be > 0" });

    const makerSide  = takerSide === "long" ? "short" : "long";
    const balanceCol = is_paper ? "paper_balance_usd" : "balance_usd";

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Lock taker balance
      const { rows: [takerRow] } = await client.query(
        `SELECT ${balanceCol} FROM users WHERE id = $1 FOR UPDATE`, [taker.userId]
      );
      if (!takerRow) { await client.query("ROLLBACK"); return reply.status(404).send({ error: "User not found" }); }

      const takerBalance = parseFloat(takerRow[balanceCol]);
      const takerAmount  = Math.min(takerWants, takerBalance);
      if (takerAmount <= 0) {
        await client.query("ROLLBACK");
        return reply.status(400).send({ error: "Insufficient balance" });
      }

      // Fetch + lock all matching maker orders (FIFO)
      const { rows: makerOrders } = await client.query(`
        SELECT o.*
        FROM orders o
        WHERE UPPER(o.symbol) = UPPER($1)
          AND UPPER(o.chain)  = UPPER($2)
          AND o.timeframe     = $3
          AND o.side          = $4
          AND o.status       IN ('pending', 'partially_filled')
          AND o.is_paper      = $5
          AND o.user_id      != $6
          AND (o.expires_at IS NULL OR o.expires_at > NOW())
        ORDER BY o.created_at ASC
        FOR UPDATE
      `, [symbol, chain, timeframe, makerSide, is_paper, taker.userId]);

      if (makerOrders.length === 0) {
        await client.query("ROLLBACK");
        return reply.status(400).send({ error: "No orders available on the other side" });
      }

      // Total available from makers
      const makerPoolTotal = makerOrders.reduce(
        (s: number, o: any) => s + parseFloat(o.remaining_amount), 0
      );

      // Taker fills up to what's available
      const fillAmount = Math.min(takerAmount, makerPoolTotal);

      // Fetch oracle price once for the whole sweep
      let entryPrice: number;
      try {
        entryPrice = await getPrice(symbol, chain);
      } catch (e: any) {
        await client.query("ROLLBACK");
        return reply.status(503).send({ error: `Price unavailable: ${e.message}` });
      }

      const sweepId  = crypto.randomUUID();
      const closesAt = nextWindowClose(timeframe as Timeframe);

      // Pool composition: ALL maker orders form one side, taker forms the other.
      // This is intentional — asymmetric pools create the variable multiplier that
      // makes taking the minority side attractive.
      const shortPool = makerSide === "short" ? makerPoolTotal : fillAmount;
      const longPool  = makerSide === "long"  ? makerPoolTotal : fillAmount;

      // Create ONE market for this sweep
      const { rows: [market] } = await client.query(`
        INSERT INTO markets
          (symbol, chain, timeframe, entry_price, tagline, opener_id,
           short_pool, long_pool, closes_at, is_paper, sweep_id)
        VALUES (UPPER($1), UPPER($2), $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `, [
        symbol, chain, timeframe, entryPrice,
        `${symbol.toUpperCase()} order book — ${takerSide.toUpperCase()} sweep`,
        taker.userId,
        shortPool, longPool,
        closesAt, is_paper, sweepId,
      ]);

      // Deduct taker balance + create taker position
      await client.query(
        `UPDATE users SET ${balanceCol} = ${balanceCol} - $1 WHERE id = $2`,
        [fillAmount, taker.userId]
      );
      await client.query(`
        INSERT INTO positions (user_id, market_id, side, amount, is_paper, message)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [taker.userId, market.id, takerSide, fillAmount, is_paper, takerMessage?.trim() || null]);

      // Process maker orders — ALL go into the market (mark filled, create positions + fills)
      let remaining = fillAmount;
      let fillsCount = 0;

      for (const order of makerOrders) {
        const orderAmt  = parseFloat(order.remaining_amount);
        // Each maker contributes their full remaining amount to the pool.
        // Taker "consumed" the first fillAmount worth; remaining orders still
        // participate in the pool but aren't decremented beyond what was consumed.
        const consumed  = remaining > 0 ? Math.min(orderAmt, remaining) : 0;
        remaining      -= consumed;

        // Insert maker position for their full remaining amount (use order tagline as message)
        await client.query(`
          INSERT INTO positions (user_id, market_id, side, amount, is_paper, message)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [order.user_id, market.id, makerSide, orderAmt, is_paper, order.tagline?.trim() || null]);

        // Record the fill (tracks which makers are in this sweep)
        await client.query(`
          INSERT INTO fills (sweep_id, maker_order_id, taker_user_id, market_id, filled_amount)
          VALUES ($1, $2, $3, $4, $5)
        `, [sweepId, order.id, taker.userId, market.id, consumed]);

        // Mark order as filled (reserved balance was already deducted at order creation)
        await client.query(
          `UPDATE orders SET status = 'filled', remaining_amount = 0, reserved_amount = 0 WHERE id = $1`,
          [order.id]
        );

        fillsCount++;
      }

      await client.query("COMMIT");

      // Schedule oracle resolution
      scheduleResolution(market.id, closesAt);

      const takerMultiplier = parseFloat(calcMultiplier(fillAmount, makerPoolTotal).toFixed(4));
      const makerMultiplier = parseFloat(calcMultiplier(makerPoolTotal, fillAmount).toFixed(4));

      const { rows: [updated] } = await db.query(
        `SELECT balance_usd, paper_balance_usd FROM users WHERE id = $1`, [taker.userId]
      );

      // Fire-and-forget: notify each maker their order was filled
      (async () => {
        try {
          for (const order of makerOrders) {
            await db.query(
              `INSERT INTO notifications (user_id, type, payload) VALUES ($1, 'order_filled', $2)`,
              [order.user_id, JSON.stringify({
                sweep_id: sweepId, market_id: market.id,
                symbol: market.symbol, timeframe: market.timeframe,
                side: makerSide, amount: parseFloat(order.remaining_amount),
              })]
            );
          }
        } catch (err) {
          console.error("[orders] maker notification error:", err);
        }
      })();

      return reply.status(201).send({
        sweep_id:          sweepId,
        market_id:         market.id,
        symbol:            market.symbol,
        timeframe:         market.timeframe,
        closes_at:         closesAt,
        requested_amount:  takerWants,
        filled_amount:     fillAmount,
        unfilled_amount:   parseFloat(Math.max(0, takerWants - fillAmount).toFixed(6)),
        fills_count:       fillsCount,
        maker_pool:        makerPoolTotal,
        taker_pool:        fillAmount,
        taker_multiplier:  takerMultiplier,
        maker_multiplier:  makerMultiplier,
        new_balance:       updated.balance_usd,
        new_paper_balance: updated.paper_balance_usd,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });
}
