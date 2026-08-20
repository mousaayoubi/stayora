/**
 * Postgres connection pool. Every DB access in the app goes through this
 * one pool rather than opening ad-hoc connections, matching Week3Day5's
 * "Repositories are responsible for all direct communication with
 * PostgreSQL" pattern (knowledge/architecture.md) - repository.js is the
 * only other file that imports this one.
 */
import pg from "pg";
import { env } from "../config/env.js";

const { Pool, types } = pg;

// pg's default DATE parser returns a JS Date at local midnight. Once that
// gets serialized to JSON (toISOString(), always UTC), a positive UTC
// offset shifts the calendar date backward - "2026-08-28" round-tripped
// through the app came back as "2026-08-27T21:00:00.000Z". Found live
// while verifying the repository layer. check_in/check_out are always
// plain YYYY-MM-DD strings at the application layer already (understand.js,
// search_hotels), so returning the raw string instead of a Date sidesteps
// the conversion entirely rather than trying to reformat it back correctly
// after the fact.
types.setTypeParser(types.builtins.DATE, (value) => value);

export class DatabaseNotConfiguredError extends Error {}

let pool = null;

/**
 * Returns the shared pool, creating it on first use. Fails fast with a
 * clear message if DATABASE_URL isn't set, rather than letting `pg` throw
 * an opaque connection error.
 */
export function getPool() {
  if (pool) return pool;

  if (!env.databaseUrl) {
    throw new DatabaseNotConfiguredError(
      "DATABASE_URL is not set. Add a Postgres connection string to .env " +
        "(a free Neon or Supabase instance works - see .env.example) before using the database."
    );
  }

  pool = new Pool({
    connectionString: env.databaseUrl,
    // Neon/Supabase both require TLS; rejectUnauthorized: false matches
    // their documented Node.js connection examples for a hosted free tier
    // where the pool doesn't have the provider's CA loaded locally.
    ssl: { rejectUnauthorized: false },
  });

  return pool;
}

/** Runs one query against the pool. Thin wrapper so callers never import `pg` directly. */
export async function query(text, params) {
  return getPool().query(text, params);
}

/** Closes the pool (used by the migration script and tests, not the running server). */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
