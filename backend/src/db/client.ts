import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

db.on("error", (err) => {
  console.error("Postgres pool error:", err);
});
