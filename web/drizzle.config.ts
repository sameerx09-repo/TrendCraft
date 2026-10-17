import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit is a standalone CLI, not Next.js — it doesn't auto-load
// .env.local the way `next dev` does, so DATABASE_URL was silently
// undefined here until this was added (confirmed live: drizzle-kit push
// failed with "Either connection url or host... are required" despite
// .env.local having a real, working DATABASE_URL).
config({ path: ".env.local" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Without this, drizzle-kit introspects the WHOLE Supabase project —
  // including auth/storage/realtime's own schemas — and crashes parsing one
  // of their multi-line check constraints (confirmed live: a bare `npm run
  // db:push` throws `TypeError: Cannot read properties of undefined
  // (reading 'replace')` inside drizzle-kit's constraint parser, before it
  // even gets to our own tables). Our app only ever owns `public`.
  schemaFilter: ["public"],
});
