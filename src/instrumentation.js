// Runs once when a new server instance starts, before it handles requests.
//
// The main purpose here is to fail fast: if NEXTAUTH_SECRET is still a
// placeholder, every session cookie is forgeable, so the server refuses to
// come up rather than serving traffic it cannot authenticate.
//
// `register` is also called during `next build`, so the check is skipped there
// to avoid breaking builds that run without a .env file.

export async function register() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // `secrets` (not `security`) because Next.js also builds an Edge variant of
  // this hook, and the Edge runtime cannot load `node:crypto`.
  const { assertSecureServerConfig } = await import("./lib/secrets");
  assertSecureServerConfig();
}
