import { FastifyInstance } from "fastify";
import { db } from "../db/client.js";

export async function notificationRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // GET /notifications — last 50 notifications for current user
  app.get("/notifications", auth, async (req) => {
    const me = (req as any).user;
    const { rows } = await db.query(
      `SELECT id, type, payload, read, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [me.userId]
    );
    return rows;
  });

  // GET /notifications/count — unread count (used for badge polling)
  app.get("/notifications/count", auth, async (req) => {
    const me = (req as any).user;
    const { rows: [row] } = await db.query(
      `SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND read = false`,
      [me.userId]
    );
    return { unread: row?.unread ?? 0 };
  });

  // POST /notifications/read-all — mark all read
  app.post("/notifications/read-all", auth, async (req) => {
    const me = (req as any).user;
    await db.query(`UPDATE notifications SET read = true WHERE user_id = $1`, [me.userId]);
    return { ok: true };
  });

  // POST /notifications/read — mark specific ids read
  app.post("/notifications/read", auth, async (req) => {
    const { ids } = req.body as { ids: string[] };
    const me = (req as any).user;
    if (!Array.isArray(ids) || ids.length === 0) return { ok: true };
    await db.query(
      `UPDATE notifications SET read = true WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [me.userId, ids]
    );
    return { ok: true };
  });
}
