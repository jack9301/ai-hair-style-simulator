import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { stripSslMode } from "./db-url";

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
