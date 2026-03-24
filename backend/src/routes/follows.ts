import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";

export async function followRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // POST /users/:username/follow — follow a user
  app.post("/users/:username/follow", auth, async (req, reply) => {
    const { username } = req.params as any;
    const me = (req as any).user;

    const { rows: [target] } = await db.query(
      `SELECT id, username FROM users WHERE username = $1`, [username]
    );
    if (!target) return reply.status(404).send({ error: "User not found" });
    if (target.id === me.userId) return reply.status(400).send({ error: "Cannot follow yourself" });

    await db.query(
      `INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [me.userId, target.id]
    );

    // Notify the followed user (fire-and-forget)
    const { rows: [meUser] } = await db.query(`SELECT username FROM users WHERE id = $1`, [me.userId]);
    db.query(
      `INSERT INTO notifications (user_id, type, payload) VALUES ($1, 'new_follower', $2)`,
      [target.id, JSON.stringify({ from_username: meUser?.username ?? me.userId })]
    ).catch(() => {});

    return { following: true, notify_trades: false };
  });

  // DELETE /users/:username/follow — unfollow
  app.delete("/users/:username/follow", auth, async (req, reply) => {
    const { username } = req.params as any;
    const me = (req as any).user;

    const { rows: [target] } = await db.query(
      `SELECT id FROM users WHERE username = $1`, [username]
    );
    if (!target) return reply.status(404).send({ error: "User not found" });

    await db.query(
      `DELETE FROM follows WHERE follower_id = $1 AND following_id = $2`,
      [me.userId, target.id]
    );
    return { following: false };
  });

  // PATCH /users/:username/follow — toggle notify_trades
  app.patch("/users/:username/follow", auth, async (req, reply) => {
    const { username } = req.params as any;
    const { notify_trades } = req.body as any;
    const me = (req as any).user;

    const { rows: [target] } = await db.query(
      `SELECT id FROM users WHERE username = $1`, [username]
    );
    if (!target) return reply.status(404).send({ error: "User not found" });

    await db.query(
      `UPDATE follows SET notify_trades = $1 WHERE follower_id = $2 AND following_id = $3`,
      [!!notify_trades, me.userId, target.id]
    );
    return { notify_trades: !!notify_trades };
  });

  // GET /users/:username/follow-status — am I following this user?
  app.get("/users/:username/follow-status", auth, async (req, reply) => {
    const { username } = req.params as any;
    const me = (req as any).user;

    const { rows: [target] } = await db.query(
      `SELECT id FROM users WHERE username = $1`, [username]
    );
    if (!target) return { following: false, notify_trades: false };

    const { rows: [follow] } = await db.query(
      `SELECT notify_trades FROM follows WHERE follower_id = $1 AND following_id = $2`,
      [me.userId, target.id]
    );
    return { following: !!follow, notify_trades: follow?.notify_trades ?? false };
  });
}
