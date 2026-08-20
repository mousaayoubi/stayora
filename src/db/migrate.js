/**
 * Applies db/schema.sql to whatever database DATABASE_URL points at.
 * schema.sql is written to be idempotent (CREATE TABLE/INDEX IF NOT
 * EXISTS), so this is safe to re-run - there's no separate migration
 * history table to track for a schema this small (3 tables, one file).
 * Run via `npm run db:migrate`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { query, closePool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "..", "..", "db", "schema.sql");

async function main() {
  console.log(`Applying ${path.relative(process.cwd(), SCHEMA_PATH)} ...`);
  const sql = await readFile(SCHEMA_PATH, "utf-8");
  await query(sql);
  console.log("Schema applied: sessions, reservations, saved_preferences.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  })
  .finally(closePool);
