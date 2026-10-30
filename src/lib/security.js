// Server-side security helpers.
//
// SERVER ONLY — this module imports `node:crypto`. It must never be imported
// from a Client Component, and it must not be pulled into the Edge runtime
// (the Edge Instrumentation bundle does). `src/lib/config.js` is safe to
// import client-side (it is bundled into the browser), so it must NOT import
// this file.
//
// The runtime-agnostic configuration checks live in `src/lib/secrets.js`.

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { assertSecureServerConfig } from "./secrets";

export { assertSecureServerConfig, looksLikePlaceholder } from "./secrets";

/** Largest image we accept on the upload endpoint. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Largest `inputImage` we accept. A data: URL base64-encodes to ~4/3 of the
 * original size, so this allows a slightly larger payload than MAX_UPLOAD_BYTES.
 */
export const MAX_INPUT_IMAGE_LENGTH = 15 * 1024 * 1024;

/** Cap on the free-text part of the generation prompt. */
export const MAX_PROMPT_LENGTH = 500;

/** Image types we are willing to accept and to inline as a data: URL. */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];

/** SHA-256 of a string, hex encoded. */
export function sha256Hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

/**
 * Constant-time string comparison. Both sides are hashed first so the
 * comparison always runs over equal-length buffers.
 */
export function timingSafeStringEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(sha256Hex(a), "utf8");
  const right = Buffer.from(sha256Hex(b), "utf8");
  return timingSafeEqual(left, right);
}

/**
 * Token embedded in the MuAPI callback URL. Derived from NEXTAUTH_SECRET so it
 * needs no extra environment variable, and is unguessable once that secret is
 * real (which assertSecureServerConfig guarantees before we get here).
 */
export function deriveWebhookToken(secret) {
  return createHmac("sha256", secret).update("muapi-webhook:v1").digest("hex");
}

/**
 * Build the callback URL handed to MuAPI, including the shared token.
 * Returns null when the configured base URL is unusable, in which case the
 * caller should omit the webhook entirely and rely on result polling.
 */
export function buildMuapiWebhookUrl(baseUrl) {
  const secret = assertSecureServerConfig();
  const token = deriveWebhookToken(secret);
  try {
    const url = new URL("/api/webhook/muapi", baseUrl);
    url.searchParams.set("token", token);
    return url.toString();
  } catch {
    return null;
  }
}

/** Verify a webhook callback token in constant time. */
export function isValidWebhookToken(providedToken) {
  if (typeof providedToken !== "string" || !providedToken) return false;
  const secret = assertSecureServerConfig();
  return timingSafeStringEqual(providedToken, deriveWebhookToken(secret));
}
