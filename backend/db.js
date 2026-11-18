
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  // Neon은 SSL 연결 사용
  ssl: process.env.DB_SSL === "true"
    ? { rejectUnauthorized: true }
    : false,
});

pool.on("error", (error) => {
  console.error("PostgreSQL 연결 오류:", error.message);
});
