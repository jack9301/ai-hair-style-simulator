/**
 * Postgres connection-string helpers.
 *
 * Dependency-free and side-effect-free, so the same code can be used by the
 * Next.js runtime (`src/lib/prisma.js`) and by the Prisma CLI
 * (`prisma.config.ts`).
 *
 * Two Supabase-specific facts are encoded here:
 *
 *  1. Supabase exposes two pooler ports on the same host.
 *     - 6543 "transaction mode": pgbouncer multiplexes many clients onto one
 *       server connection. Fine for ordinary queries, but the Prisma schema
 *       engine HANGS against it — it needs session-scoped behaviour
 *       (SET, transaction control, prepared statements) that transaction mode
 *       does not provide. Measured: the engine times out on 6543 and connects
 *       in ~2.5 s on 5432.
 *     - 5432 "session mode": each client owns its own server connection for
 *       the life of the session, so DDL and introspection work.
 *
 *  2. The `?sslmode=require` parameter that Supabase's dashboard copies into
 *     the connection string no longer means what it says. pg-connection-string
 *     >= 2.11 treats `require` as an alias for `verify-full` and merely
 *     prints a deprecation warning. Supabase's certificates are self-signed,
 *     so verification fails with `SELF_SIGNED_CERT_IN_CHAIN` and every query
 *     errors out. The caller is expected to request the intended behaviour
 *     explicitly instead.
 */

/** Host suffix of Supabase's pooled connection endpoints. */
const POOLER_HOST = /\.pooler\.supabase\.com$/i;

/** Port of Supabase's transaction-mode pooler. */
const TRANSACTION_POOLER_PORT = "6543";

/** Port of Supabase's session-mode pooler. */
const SESSION_POOLER_PORT = "5432";

/**
 * Split a Postgres URL around its host, so the host can be rewritten without
 * touching the credentials.
 *
 * Returns null when the URL has no `user:password@host:port` shape.
 */
function splitAtHost(url) {
  const at = url.lastIndexOf("@");
  if (at === -1) return null;

  const rest = url.slice(at + 1);
  const slash = rest.indexOf("/");
  const hostPort = slash === -1 ? rest : rest.slice(0, slash);
  const tail = slash === -1 ? "" : rest.slice(slash);

  const colon = hostPort.lastIndexOf(":");
  if (colon === -1) return null;

  return {
    prefix: url.slice(0, at + 1),
    host: hostPort.slice(0, colon),
    port: hostPort.slice(colon + 1),
    tail,
  };
}

/**
 * Point a Supabase transaction-mode pooler URL at the session-mode pooler.
 *
 * Used by the Prisma CLI (schema engine) so that `db push` and `migrate` can
 * run DDL. The running application should keep using the transaction pooler
 * on 6543 — it is the one that pools properly for serverless workloads.
 *
 * Any URL that is not a Supabase transaction-pooler URL is returned unchanged.
 */
export function toSessionPoolerUrl(url) {
  if (typeof url !== "string" || !url) return url;

  const parts = splitAtHost(url);
  if (!parts) return url;
  if (!POOLER_HOST.test(parts.host)) return url;
  if (parts.port !== TRANSACTION_POOLER_PORT) return url;

  return `${parts.prefix}${parts.host}:${SESSION_POOLER_PORT}${parts.tail}`;
}

/**
 * Remove the `sslmode` parameter from a Postgres URL.
 *
 * The URL keeps every other parameter (`sslrootcert` and friends) intact. If
 * `sslmode` was the only parameter, the now-empty query string is dropped.
 */
export function stripSslMode(url) {
  if (typeof url !== "string" || !url) return url;

  const questionMark = url.indexOf("?");
  if (questionMark === -1) return url;

  const params = url
    .slice(questionMark + 1)
    .split("&")
    .filter((param) => param && !/^sslmode=/i.test(param));

  if (params.length === 0) return url.slice(0, questionMark);
  return `${url.slice(0, questionMark + 1)}${params.join("&")}`;
}
