/**
 * Password hashing helpers.
 *
 * Uses PBKDF2-HMAC-SHA256 from the Web Crypto API (`crypto.subtle`) rather than
 * a native bcrypt binding, for two reasons:
 *
 *  - `crypto.subtle` exists in every runtime this app targets — Node (Vercel),
 *    the Edge runtime, and Cloudflare Workers. There is no native addon to
 *    compile and nothing to bundle per platform.
 *  - The PBKDF2 work runs natively, so it does not burn the CPU budget that
 *    Cloudflare Workers meters per request the way a pure-JS bcrypt would.
 *
 * The encoded form is self-describing, so the work factor can be raised later
 * without invalidating existing passwords:
 *
 *     pbkdf2-sha256$<iterations>$<salt-base64>$<hash-base64>
 *
 * A password hashed with an older (or lower) iteration count still verifies;
 * `needsRehash` reports when it should be upgraded on the next sign-in.
 */

const ALGORITHM = "PBKDF2";
const HASH_NAME = "SHA-256";
const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;
const LABEL = "pbkdf2-sha256";

/**
 * Work factor.
 *
 * OWASP currently suggests 600,000 iterations for PBKDF2-HMAC-SHA256. This is
 * deliberately lower: the same work has to fit inside the CPU budget Cloudflare
 * Workers meters per request, and hashing runs on every sign-in. Raise it here
 * when the deployment can afford it — existing passwords keep working and are
 * re-hashed with the new factor the next time their owner signs in.
 */
export const PBKDF2_ITERATIONS = 210_000;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * A handful of the passwords that show up at the top of every breach corpus.
 * OWASP's guidance is to check against known-breached passwords rather than to
 * demand composition rules, which mostly produce `Password1!`.
 */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "iloveyou",
  "admin123",
  "welcome1",
  "letmein123",
  "monkey123",
  "football1",
  "baseball1",
  "sunshine1",
  "princess1",
  "trustno1",
  "starwars1",
  "abc12345",
  "passw0rd",
]);

const encoder = new TextEncoder();

/** Encode bytes as standard base64 without depending on Buffer. */
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Decode standard base64 into bytes without depending on Buffer. */
function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Compare two byte arrays without an early exit on the first difference.
 * The lengths are always equal for a real comparison (both are the digest
 * length), so nothing secret leaks through the length.
 */
function timingSafeEqualBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Run PBKDF2 over the password with the given salt and iteration count. */
async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    ALGORITHM,
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: ALGORITHM, salt, iterations, hash: HASH_NAME },
    key,
    KEY_LENGTH_BITS
  );
  return new Uint8Array(bits);
}

/**
 * Hash a password with a fresh random salt.
 *
 * @returns {Promise<string>} the encoded `pbkdf2-sha256$<iters>$<salt>$<hash>`
 */
export async function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("hashPassword requires a non-empty string");
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt, PBKDF2_ITERATIONS);
  return [
    LABEL,
    PBKDF2_ITERATIONS,
    bytesToBase64(salt),
    bytesToBase64(derived),
  ].join("$");
}

/**
 * Check a password against an encoded hash.
 *
 * Returns false for anything that is not a well-formed hash rather than
 * throwing, so a malformed value in the database cannot crash a sign-in.
 */
export async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string") return false;

  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== LABEL) return false;

  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < 1) return false;

  let salt;
  let expected;
  try {
    salt = base64ToBytes(parts[2]);
    expected = base64ToBytes(parts[3]);
  } catch {
    return false;
  }

  const actual = await derive(password, salt, iterations);
  return timingSafeEqualBytes(actual, expected);
}

/**
 * True when a stored hash was made with a weaker factor than the current one
 * and should be replaced the next time the password is correctly supplied.
 */
export function needsRehash(encoded) {
  if (typeof encoded !== "string") return true;
  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== LABEL) return true;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < 1) return true;
  return iterations < PBKDF2_ITERATIONS;
}

/**
 * Normalise an email address for storage and lookup.
 *
 * Returns an empty string when the address is not usable. Only the domain is
 * case-insensitive in the real world, but every mainstream provider treats the
 * local part that way too, and a single canonical form is what stops one
 * person from registering twice.
 */
export function normalizeEmail(email) {
  if (typeof email !== "string") return "";
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254) return "";

  const atCount = (trimmed.match(/@/g) || []).length;
  if (atCount !== 1) return "";

  const [local, domain] = trimmed.split("@");
  if (!local || local.length > 64) return "";
  if (!domain || domain.length > 253) return "";
  if (!domain.includes(".")) return "";
  if (!/^[a-z0-9._%+-]+$/.test(local)) return "";
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return "";
  }

  // Every dot-separated label must look like a hostname label: letters and
  // digits, hyphens allowed but never leading or trailing, at most 63 chars.
  const labels = domain.split(".");
  if (labels.length < 2) return "";
  for (const label of labels) {
    if (!label || label.length > 63) return "";
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) return "";
  }

  const tld = labels[labels.length - 1];
  if (tld.length < 2 || !/^[a-z]+$/.test(tld)) return "";

  return trimmed;
}

/**
 * Check a password against the policy this app enforces.
 *
 * Length is what matters; composition rules are deliberately not imposed
 * (OWASP guidance). Returns `{ ok: true }` or `{ ok: false, error }`.
 */
export function validatePassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, error: "Please enter a password." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password.trim().length === 0) {
    return { ok: false, error: "Password cannot be only whitespace." };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return {
      ok: false,
      error: "That password is too common. Please choose a different one.",
    };
  }
  return { ok: true };
}
