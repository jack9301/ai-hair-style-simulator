import { createHash } from "node:crypto";

/**
 * Describe the database the app is configured to talk to, in a form that is
 * safe to write to a server log.
 *
 * The connection string never appears — not even hashed in a way that could be
 * checked against a candidate password. What is reported is the hostname, the
 * port and the Supabase project reference, which are identifiers rather than
 * credentials, plus a fingerprint that says "same database as before" without
 * naming it.
 *
 * This exists because the most common production failure is a deployment
 * pointed at a *different* database than the one the schema was pushed to,
 * and from the outside the two look identical: sign-in is simply broken.
 */
export function describeDatabase(raw) {
  if (!raw) {
    return { configured: false };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { configured: true, parsable: false };
  }

  const username = decodeURIComponent(url.username || "");
  // Supabase names the role after the project: "postgres.<project-ref>".
  const projectRef = username.startsWith("postgres.")
    ? username.slice("postgres.".length)
    : null;

  return {
    configured: true,
    parsable: true,
    host: url.hostname,
    port: url.port || "5432",
    projectRef,
    // Identifies the target without disclosing it: the same database always
    // produces the same fingerprint, a different one never does.
    fingerprint: createHash("sha256")
      .update(`${url.hostname}|${url.port}|${username}|${url.pathname}`)
      .digest("hex")
      .slice(0, 12),
  };
}
