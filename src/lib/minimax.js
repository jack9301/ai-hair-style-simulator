// MiniMax image generation.
//
// SERVER ONLY — this module talks to MiniMax with the server's API key. It
// must never be imported from a Client Component.
//
// MiniMax's image model works synchronously: one request returns the finished
// image. There is no job queue to poll and no callback to wait for, so the
// whole submit/poll/webhook dance the previous provider needed is gone.

/**
 * Where MiniMax's API lives.
 *
 * MiniMax runs two isolated platforms and the keys do not cross between them:
 * a key from platform.minimax.cn only works against api.minimax.cn, and a key
 * from platform.minimax.io only works against api.minimax.io. Sending a key
 * to the wrong host gets `base_resp.status_code: 2049, "invalid api key"`.
 *
 * The default is the China platform. Override it with MINIMAX_API_BASE_URL
 * if your key comes from the international one.
 */
const DEFAULT_BASE_URL = "https://api.minimax.cn";

/** The image model. `image-01` is the one that accepts a reference image. */
const DEFAULT_MODEL = "image-01";

/** MiniMax rejects prompts longer than this. */
const PROMPT_MAX_LENGTH = 1500;

/**
 * A failure that came back from MiniMax, carrying enough detail for the
 * caller to decide what to say and whether to refund.
 */
export class MiniMaxError extends Error {
  constructor(message, { status = 502, code = "minimax_error" } = {}) {
    super(message);
    this.name = "MiniMaxError";
    this.status = status;
    this.code = code;
  }
}

/**
 * MiniMax reports its own error codes inside the response body, and it
 * answers HTTP 200 even when the request failed. These are the codes worth
 * translating — the raw `status_msg` for the rest is already descriptive
 * and is passed through untouched.
 */
const ERROR_CODE_MESSAGES = {
  // "login fail: Please carry the API secret key..." — the key is wrong.
  1004: {
    message: "MiniMax rejected the API key. Check that the key is correct.",
    code: "invalid_key",
  },
  // Same thing, reported by a different MiniMax gateway.
  2013: {
    message: "MiniMax rejected the API key. Check that the key is correct.",
    code: "invalid_key",
  },
  // "invalid api key" — in practice this is almost always the key being sent
  // to the other platform, because the two do not share keys.
  2049: {
    message:
      "MiniMax rejected the API key. A key from platform.minimax.cn only works against api.minimax.cn — check MINIMAX_API_BASE_URL.",
    code: "invalid_key",
  },
  // The account is out of credit.
  1008: {
    message: "The MiniMax account has no credit left.",
    code: "insufficient_balance",
  },
};

/**
 * Work out the MIME type of a base64 image by looking at its first bytes.
 *
 * MiniMax returns the raw base64 payload without saying what format it is,
 * and the data: URL has to carry the right MIME type or the browser will not
 * render it.
 */
function detectImageMime(base64) {
  if (base64.startsWith("iVBORw0KGgo")) return "image/png"; // PNG signature
  if (base64.startsWith("/9j/")) return "image/jpeg"; // JPEG signature
  return "image/jpeg";
}

/** Turn MiniMax's base64 payload into a data: URL the browser can render. */
function toDataUrl(base64) {
  // Some deployments hand back a complete data: URL rather than raw base64.
  if (base64.startsWith("data:")) return base64;
  return `data:${detectImageMime(base64)};base64,${base64}`;
}

/**
 * Generate one image from a prompt and a reference image.
 *
 * The reference image is the person's own photo, and MiniMax's
 * `subject_reference` with type "character" is what keeps their face, their
 * features and their background in the result while the hairstyle changes.
 * MiniMax accepts one reference per request, so only one is sent.
 *
 * Returns `{ requestId, image, format }`. `image` is a data: URL, so it stays
 * valid for as long as the row that stores it exists — MiniMax's own image
 * URLs expire after a day, which would leave the gallery full of broken
 * images.
 *
 * Throws a MiniMaxError on any failure.
 */
export async function generateHairstyleImage({
  apiKey,
  prompt,
  inputImage,
  aspectRatio = "1:1",
}) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new MiniMaxError("No MiniMax API key is configured.", {
      status: 503,
      code: "missing_key",
    });
  }
  if (!inputImage) {
    throw new MiniMaxError("No input image was supplied.", {
      status: 400,
      code: "missing_input",
    });
  }

  const baseUrl = (process.env.MINIMAX_API_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );
  const model = process.env.MINIMAX_IMAGE_MODEL || DEFAULT_MODEL;

  const body = {
    model,
    prompt: String(prompt).slice(0, PROMPT_MAX_LENGTH),
    aspect_ratio: aspectRatio,
    n: 1,
    response_format: "base64",
    // The prompt already says exactly what must be preserved — the face, the
    // features, the background. The optimiser rewrites prompts, which would
    // throw those instructions away.
    prompt_optimizer: false,
    subject_reference: [{ type: "character", image_file: inputImage }],
  };

  let res;
  try {
    res = await fetch(`${baseUrl}/v1/image_generation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    throw new MiniMaxError(`Could not reach MiniMax: ${err.message}`, {
      status: 502,
      code: "unreachable",
    });
  }

  if (res.status === 401 || res.status === 403) {
    throw new MiniMaxError("MiniMax rejected the API key.", {
      status: 401,
      code: "invalid_key",
    });
  }
  if (res.status === 429) {
    throw new MiniMaxError("MiniMax rate limit reached. Please try again shortly.", {
      status: 429,
      code: "rate_limited",
    });
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const message =
      payload?.base_resp?.status_msg ||
      payload?.message ||
      `MiniMax returned HTTP ${res.status}.`;
    throw new MiniMaxError(message, { status: 502, code: "request_failed" });
  }

  // MiniMax reports business-level failures inside a 200 response — including
  // a rejected API key, which does not come back as an HTTP 401.
  const statusCode = payload?.base_resp?.status_code;
  if (statusCode !== undefined && Number(statusCode) !== 0) {
    const known = ERROR_CODE_MESSAGES[Number(statusCode)];
    throw new MiniMaxError(
      known?.message ||
        payload?.base_resp?.status_msg ||
        "MiniMax could not generate that image.",
      { status: 502, code: known?.code || "business_error" }
    );
  }

  const requestId = payload?.id || `minimax_${Date.now()}`;

  // `image_base64` is an array of images; older API revisions hand back a
  // bare string instead, so accept both.
  const rawBase64 = payload?.data?.image_base64;
  const base64 = Array.isArray(rawBase64) ? rawBase64[0] : rawBase64;
  if (base64) {
    return { requestId, image: toDataUrl(base64), format: "base64" };
  }

  const rawUrls = payload?.data?.image_urls;
  const imageUrl = Array.isArray(rawUrls) ? rawUrls[0] : rawUrls;
  if (imageUrl && /^https:\/\//i.test(imageUrl)) {
    return { requestId, image: imageUrl, format: "url" };
  }

  throw new MiniMaxError("MiniMax returned no image.", {
    status: 502,
    code: "no_image",
  });
}
