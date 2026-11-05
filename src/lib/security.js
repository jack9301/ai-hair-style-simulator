// Server-side security helpers.
//
// SERVER ONLY — this module imports `node:crypto`. It must never be imported
// from a Client Component, and it must not be pulled into the Edge runtime
// (the Edge Instrumentation bundle does). `src/lib/config.js` is safe to
// import client-side (it is bundled into the browser), so it must NOT import
// this file.
//
// The runtime-agnostic configuration checks live in `src/lib/secrets.js`.

import { createHash, timingSafeEqual } from "crypto";

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

/**
 * The image types the AI provider actually accepts as a reference image.
 *
 * MiniMax takes JPEG and PNG only, so this is narrower than the list above:
 * the browser converts whatever the user picked into a JPEG before uploading,
 * and the upload endpoint refuses anything that is still not one of these.
 */
export const AI_INPUT_IMAGE_TYPES = ["image/jpeg", "image/png"];

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
 * The AI provider answers in one request, so there is no callback URL and no
 * shared token to derive any more. The old MuAPI webhook helpers
 * (`deriveWebhookToken`, `buildMuapiWebhookUrl`, `isValidWebhookToken`) were
 * removed with the provider they belonged to.
 */