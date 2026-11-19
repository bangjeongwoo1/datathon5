
import pg from "pg";
import "dotenv/config";
import { readFileSync } from "node:fs";

const { Pool } = pg;

// Supabase SSL 인증서
const sslConfig =
  process.env.DB_SSL === "true"
    ? {
        rejectUnauthorized: true,
        ca: readFileSync(
          new URL("./certs/prod-ca-2021.crt", import.meta.url),
          "utf8"
        ),
      }
    : false;

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: sslConfig,
});

pool.on("error", (error) => {
  console.error("PostgreSQL 연결 오류:", error.message);
});
