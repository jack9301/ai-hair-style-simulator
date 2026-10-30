// Configuration checks that must work in any runtime.
//
// Kept separate from `src/lib/security.js` on purpose: that module imports
// `node:crypto`, which the Edge runtime does not support, and Next.js builds
// an Edge variant of the instrumentation hook. This file has no imports at all,
// so it is safe to use from both.

// Values that ship in `.env.example`. Any of these means "not configured yet".
const PLACEHOLDER_PATTERNS = [
  /your_/i,
  /replace[_-]?me/i,
  /changeme/i,
  /placeholder/i,
  /example/i,
  /secret_?here/i,
];

/** True when a config value is empty or still one of the shipped placeholders. */
export function looksLikePlaceholder(value) {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * The NextAuth secret signs the session cookie. A missing or placeholder value
 * means anyone can forge a session for any user, so the server refuses to serve
 * traffic until a real secret is configured.
 *
 * Throws on failure — call this at the top of anything that depends on the
 * session being trustworthy.
 */
export function assertSecureServerConfig() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (looksLikePlaceholder(secret)) {
    throw new Error(
      "[security] NEXTAUTH_SECRET is missing or still set to a placeholder. " +
        "Generate one with `openssl rand -base64 32` and set it in .env (and in " +
        "your hosting provider's secret store). Refusing to continue."
    );
  }
  return secret;
}
