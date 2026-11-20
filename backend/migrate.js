// backend/migrations/*.sql 을 파일명 순서대로 적용한다. 이미 적용한 파일은 건너뛴다.
// 사용: cd backend && node migrate.js
// 접속 대상은 backend/.env 의 DB_* 값이 정한다. (로컬 Docker든 Supabase든 같은 방식)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Supabase 는 public 테이블을 API 로 노출하므로, 팀의 다른 테이블처럼 RLS 를 켜 둔다.
  // (백엔드는 DB 에 직접 접속하므로 영향이 없고, 정책이 없으므로 anon 키로는 읽을 수 없다.)
  await pool.query("ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY");

  const applied = new Set(
    (await pool.query("SELECT filename FROM public.schema_migrations")).rows.map(
      row => row.filename
    )
  );

  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".sql")).sort();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`건너뜀 (이미 적용됨): ${file}`);
      continue;
    }

    const sql = await fs.readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO public.schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`적용 완료: ${file}`);
      count += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`${file} 적용 실패: ${error.message}`);
    } finally {
      client.release();
    }
  }

  console.log(count ? `총 ${count}개 적용` : "적용할 마이그레이션이 없습니다.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
