import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { UserService } from "../../../lib/services/user";
import config from "../../../lib/config";
import {
  MAX_INPUT_IMAGE_LENGTH,
  MAX_PROMPT_LENGTH,
  buildMuapiWebhookUrl,
} from "../../../lib/security";

const FALLBACK_HAIRSTYLES = [
  "https://images.unsplash.com/photo-1595959183075-c1d09e77f050?q=80&w=800", // curly blonde
  "https://images.unsplash.com/photo-1605497746444-051d5236a28e?q=80&w=800", // long pink
  "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?q=80&w=800"  // short dark
];

// Hosts we accept a remote input image from. MuAPI's CDN is the only thing
// that should ever hand us a remote URL.
const ALLOWED_INPUT_HOSTS = ["cdn.muapi.ai"];

/** Only http(s) image URLs are ever stored or rendered. */
function isSafeImageUrl(value) {
  if (typeof value !== "string" || !value) return false;
  return /^https:\/\//i.test(value) || /^data:image\//i.test(value);
}

/** The uploaded image must be an inline image or a URL on a known host. */
function isValidInputImage(value) {
  if (typeof value !== "string" || !value || value.length > MAX_INPUT_IMAGE_LENGTH) {
    return false;
  }
  if (/^data:image\/(jpeg|png|webp|gif|heic|heif);base64,/i.test(value)) {
    return true;
  }
  if (!/^https:\/\//i.test(value)) return false;
  try {
    const { hostname } = new URL(value);
    return ALLOWED_INPUT_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    const { inputImage, gender, styleName, colorName, customPrompt } = body;

    if (!inputImage) {
      return new NextResponse("Input face image is required", { status: 400 });
    }

    if (!isValidInputImage(inputImage)) {
      return new NextResponse("Input face image is invalid", { status: 400 });
    }

    // Construct detailed prompt for AI style simulator
    const cleanGender = gender || "unisex";
    const cleanStyle = styleName || "short";
    const cleanColor = colorName || "black";
    const trimmedPrompt =
      typeof customPrompt === "string" ? customPrompt.slice(0, MAX_PROMPT_LENGTH) : "";
    const userPrompt = trimmedPrompt ? `, ${trimmedPrompt}` : "";
    const cleanPrompt = `A high quality professional realistic portrait photo of a ${cleanGender} with a beautiful styled ${cleanColor} ${cleanStyle} hairstyle${userPrompt}. The hairstyle must blend naturally on the person's head, retaining the original facial features, facial structure, skin tone and background of the photo.`;

    // ---------------------------------------------------------------------
    // Which API key are we using?
    //
    // A custom key is only honoured when it was saved on the account by the
    // signed-in user via /api/user/apikey. It is deliberately NOT read from a
    // request header or body: accepting one there let any caller claim "I'm
    // using my own key" and generate for free.
    // ---------------------------------------------------------------------
    const customApiKey =
      typeof session.user.customApiKey === "string"
        ? session.user.customApiKey.trim()
        : "";
    const usingCustomKey = customApiKey.length > 0;

    const serverApiKey =
      typeof config.ai.apiKey === "string" ? config.ai.apiKey.trim() : "";
    const hasServerKey = serverApiKey.length > 0 && !serverApiKey.includes("your_");

    const apiKey = usingCustomKey ? customApiKey : serverApiKey;

    // A request is served by the mock fallback (a stock hairstyle image) when
    // there is no usable key to call MuAPI with. That is not a real
    // generation, so it must never cost the user credits — otherwise an
    // unconfigured server silently charges every user for a fake result.
    const willUseMock =
      !apiKey || apiKey.trim() === "" || apiKey.includes("your_");

    const cost =
      usingCustomKey || willUseMock ? 0 : config.ai.generationCost || 18;

    // With the server's key we pay up front. With the user's own key we pay
    // nothing — but the key is proven below before it is treated as valid, so
    // an invalid key cannot buy free generations.
    if (!usingCustomKey && cost > 0) {
      try {
        await UserService.deductCredits(session.user.id, cost);
      } catch (err) {
        return new NextResponse("Insufficient credits", { status: 402 });
      }
    }

    // 2. Submit prediction
    let resultImage = "";
    let requestId = `mock_${Date.now()}`;
    let status = "processing";
    let refunded = false;

    if (!willUseMock) {
      const webhookUrl = buildMuapiWebhookUrl(config.auth.webhook_url);
      if (!webhookUrl) {
        console.warn(
          "[GENERATION] WEBHOOK_URL is not a valid URL — falling back to result polling."
        );
      }

      const submitUrl =
        "https://api.muapi.ai/api/v1/gpt-image-2-image-to-image" +
        (webhookUrl ? `?webhook=${encodeURIComponent(webhookUrl)}` : "");
      const submitBody = { prompt: cleanPrompt, images_list: [inputImage] };
      if (webhookUrl) submitBody.webhook = webhookUrl;

      try {
        const submitRes = await fetch(submitUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify(submitBody),
        });

        if (submitRes.status === 401 || submitRes.status === 403) {
          // The supplied key was rejected. With a custom key that means the
          // user saved an invalid key — report it instead of quietly running
          // their request on the server's key.
          if (usingCustomKey) {
            return NextResponse.json(
              { error: "Your saved MuAPI API key was rejected. Please save a valid key." },
              { status: 402 }
            );
          }
          throw new Error("MuAPI rejected the server API key");
        }

        if (!submitRes.ok) {
          throw new Error(`MuAPI submission failed with status ${submitRes.status}`);
        }

        const resJson = await submitRes.json();
        if (resJson.request_id) {
          requestId = resJson.request_id;

          // Poll for result (max 15s, checking every 2.5s)
          let completed = false;
          let attempts = 0;
          const maxAttempts = 6;

          while (!completed && attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 2500));
            attempts++;

            try {
              const pollRes = await fetch(
                `https://api.muapi.ai/api/v1/predictions/${requestId}/result`,
                {
                  method: "GET",
                  headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                  },
                }
              );

              if (pollRes.ok) {
                const pollJson = await pollRes.json();
                const state = pollJson.status || pollJson.state;
                if (state === "completed" || state === "succeeded") {
                  const outputs = pollJson.outputs || [];
                  const outputUrl =
                    outputs[0] ||
                    (typeof pollJson.output === "string"
                      ? pollJson.output
                      : pollJson.output?.urls?.get);

                  if (outputUrl && isSafeImageUrl(outputUrl)) {
                    resultImage = outputUrl;
                    status = "completed";
                    completed = true;
                  }
                } else if (state === "failed") {
                  console.error("MuAPI generation failed:", pollJson.error);
                  status = "failed";
                  break;
                }
              }
            } catch (pollErr) {
              console.error("MuAPI polling error:", pollErr);
            }
          }
        } else if (resJson.output && isSafeImageUrl(resJson.output)) {
          resultImage = resJson.output;
          status = "completed";
        }
      } catch (err) {
        // The request never reached a running generation, so the user got
        // nothing. Refund the credits they were charged for.
        console.warn("MuAPI call failed:", err.message);
        status = "failed";
        if (!usingCustomKey && cost > 0) {
          await UserService.addCredits(session.user.id, cost);
          refunded = true;
        }
      }
    } else {
      // Mock mode — no usable API key, so there is nothing real to call.
      if (!usingCustomKey && !hasServerKey) {
        console.warn(
          "[GENERATION] MUAPIAPP_API_KEY is missing or still a placeholder — " +
            "serving the stock-image fallback. No credits were charged."
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
      resultImage = FALLBACK_HAIRSTYLES[Math.floor(Math.random() * FALLBACK_HAIRSTYLES.length)];
      status = "completed";
    }

    // 3. Save DB record
    const creation = await prisma.hairStyle.create({
      data: {
        userId: session.user.id,
        inputImage,
        resultImage,
        gender: cleanGender,
        styleName: cleanStyle,
        colorName: cleanColor,
        prompt: cleanPrompt,
        requestId,
        status,
        creditCost: refunded ? 0 : cost,
      },
    });

    return NextResponse.json(creation);
  } catch (error) {
    console.error("[GENERATION_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
