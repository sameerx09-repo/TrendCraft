import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Real Postgres (Supabase-hosted), not PGlite. Migrated off PGlite after 4
 * real WASM-runtime corruptions in one session — traced to PGlite being a
 * single-process embedded engine getting hit by multiple OS processes
 * (dev server + drizzle-kit CLI + one-off scripts) touching the same
 * on-disk files, concurrent HTTP/Inngest load, and at least one corruption
 * that coincided exactly with the local disk hitting 0 bytes free. None of
 * those failure modes exist with a real Postgres server — this is not a
 * defensive rewrite, it's fixing the actual cause.
 *
 * Supabase specifically (not just any Postgres) because it's the same
 * engine the eventual Vercel+Supabase production target uses — this local
 * connection is a real rehearsal of that, not a separate thing to migrate
 * away from later. Only DATABASE_URL changes between local dev and prod.
 *
 * `prepare: false` is required for Supabase's pooled connection (port
 * 6543, Supavisor/PgBouncer) — transaction-mode pooling doesn't support
 * prepared statements. Same setting will matter again at real Vercel
 * deploy time for the same reason (serverless functions + pooled
 * connections), so it's set here rather than left as a surprise later.
 */
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Local dev now requires a real Postgres connection string " +
      "(Supabase project → Settings → Database → Connection string → URI, pooled/port 6543). " +
      "See .env.local's DATABASE_URL line."
  );
}

const client =
  globalForDb.pgClient ?? postgres(connectionString, { prepare: false });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgClient = client;
}

export const db = drizzle(client, { schema });
