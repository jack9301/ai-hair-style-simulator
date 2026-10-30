// Prisma CLI config. `dotenv/config` is loaded here ONLY for the local Prisma CLI
// (it reads .env from the project root). Cloudflare Workers does not bundle this file —
// at deploy time it uses wrangler secrets/bindings instead. Safe to keep.
import "dotenv/config";
import { defineConfig } from "prisma/config";
import { toSessionPoolerUrl } from "./src/lib/db-url.js";

/**
 * Resolve the connection URL the Prisma CLI (schema engine) should use.
 *
 * The schema engine needs session-scoped database behaviour (SET statements,
 * transaction control, prepared statements) so that it can run DDL. Supabase's
 * *transaction* pooler on port 6543 multiplexes many clients onto one server
 * connection and does not provide that — the engine connects to it and then
 * hangs indefinitely. The *session* pooler on port 5432 gives each client its
 * own server connection, so `db push` and `migrate` work.
 *
 * Measured against this project: engine timeout on :6543, engine connects in
 * ~2.5 s on :5432.
 *
 * The running application keeps using the transaction pooler (6543) — that is
 * the one that pools properly for serverless request lifetimes.
 *
 * Override with PRISMA_CLI_DATABASE_URL if you need to point the CLI
 * somewhere else entirely.
 */
function resolveDatasourceUrl(): string | undefined {
  const override = process.env["PRISMA_CLI_DATABASE_URL"];
  if (override) return override;

  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl) return toSessionPoolerUrl(databaseUrl);

  return process.env["DIRECT_URL"];
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: resolveDatasourceUrl(),
  },
});
