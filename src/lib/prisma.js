import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { stripSslMode } from "./db-url";
import { describeDatabase } from "./db-diagnostics";

const globalForPrisma = globalThis;

// The `sslmode=require` that Supabase's dashboard puts in the URL is stripped
// here: see src/lib/db-url.js for why it no longer means "encrypt but don't
// verify". The equivalent behaviour is requested through the `ssl` option on
// the pool below.
const connectionString = process.env.DATABASE_URL
  ? stripSslMode(process.env.DATABASE_URL)
  : undefined;

if (!connectionString) {
  // This will surface as a runtime error when the first query is attempted, which is
  // what we want: deployment shouldn't fail just because the env isn't set yet.
  console.warn(
    "[prisma] DATABASE_URL is not set. Database queries will fail until it is provided."
  );
}

// Say which database this deployment is aimed at, once, in a form that is safe
// to log. A deployment pointed at the wrong database is indistinguishable
// from one with no database at all, and this line is what tells the two apart.
const databaseTarget = describeDatabase(process.env.DATABASE_URL);
if (databaseTarget.configured && databaseTarget.parsable) {
  console.log(
    `[prisma] database target: ${databaseTarget.host}:${databaseTarget.port} ` +
      `project=${databaseTarget.projectRef ?? "unknown"} ` +
      `fingerprint=${databaseTarget.fingerprint}`
  );
} else if (databaseTarget.configured) {
  console.warn("[prisma] DATABASE_URL could not be parsed as a connection string.");
}

const pool = new Pool({
  connectionString,
  // Supabase serves a self-signed certificate. `sslmode=require` is supposed to mean
  // "encrypt, but don't verify the certificate", but pg-connection-string >= 2.11
  // treats it as `verify-full` and only prints a deprecation warning — the connection
  // then fails with SELF_SIGNED_CERT_IN_CHAIN. We strip that parameter from the URL
  // and ask for the intended behaviour here instead: the connection is still
  // encrypted, the (unverifiable) certificate just isn't checked.
  //
  // To verify properly, download Supabase's CA certificate and set `sslrootcert`
  // in DATABASE_URL; `ssl` can then be dropped.
  ssl: { rejectUnauthorized: false },
  // A Vercel function instance handles requests concurrently, so the pool has to
  // hold more than one connection — a pool of 1 would serialise every query
  // behind the last one. The connection string points at Supabase's transaction
  // pooler, which multiplexes these over a single Postgres backend.
  max: 10,
  idleTimeoutMillis: 10_000,
});

const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Columns the app cannot run without.
 *
 * `password` is the one that is easy to forget: it was added to the schema
 * after the first version of the app, so a database that was set up before
 * that has everything else and is still missing it.
 */
const REQUIRED_USER_COLUMNS = ["email", "name", "credits", "password"];

let schemaProbe = null;

/**
 * Check that the database this deployment points at actually has the tables
 * and columns the app needs.
 *
 * A deployment aimed at the wrong database fails exactly like a deployment
 * with no database at all — "sign-in is broken", with nothing to go on. One
 * query per cold start settles it, and the answer goes to the server log
 * where the owner of the deployment can read it.
 *
 * The result is remembered, so the probe costs one query per function
 * instance rather than one per request.
 */
export function probeSchema() {
  if (!schemaProbe) {
    schemaProbe = (async () => {
      try {
        const columns = await prisma.$queryRaw`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'User'
        `;

        if (columns.length === 0) {
          console.error(
            "[prisma] schema check: the 'User' table does not exist in this database. " +
              "Point DATABASE_URL at the database the schema was pushed to, then run `npx prisma db push`."
          );
          return { ok: false, reason: "missing_user_table" };
        }

        const names = columns.map((column) => column.column_name);
        const missing = REQUIRED_USER_COLUMNS.filter((name) => !names.includes(name));

        if (missing.length > 0) {
          console.error(
            `[prisma] schema check: the 'User' table is missing ${missing.join(", ")}. ` +
              "Run `npx prisma db push` against this database."
          );
          return { ok: false, reason: "missing_columns", missing };
        }

        console.log("[prisma] schema check: ok");
        return { ok: true };
      } catch (err) {
        console.error(`[prisma] schema check failed: ${err?.message}`);
        return { ok: false, reason: "unreachable" };
      }
    })();
  }

  return schemaProbe;
}
