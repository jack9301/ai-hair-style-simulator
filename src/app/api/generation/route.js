import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { UserService } from "../../../lib/services/user";
import config from "../../../lib/config";
import { generateHairstyleImage } from "../../../lib/minimax";
import { looksLikePlaceholder } from "../../../lib/secrets";
import {
  MAX_INPUT_IMAGE_LENGTH,
  MAX_PROMPT_LENGTH,
} from "../../../lib/security";

// The provider answers in a single request, so this function stays open for
// the whole generation — around 20-30 seconds in practice, longer when
// MiniMax is busy. 60 seconds is the ceiling on the Hobby plan; declaring it
// stops the platform falling back to a much shorter default.
export const maxDuration = 60;

const FALLBACK_HAIRSTYLES = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=800", // blonde bob
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=800", // long waves
  "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?q=80&w=800"  // short dark
];

/**
 * The reference image has to be a JPEG or PNG data: URL.
 *
 * MiniMax takes the picture inline as base64, so there is no remote host to
 * allow here any more — and no chance of the app being pointed at a URL
 * somebody else controls.
 */
function isValidInputImage(value) {
  if (typeof value !== "string" || !value || value.length > MAX_INPUT_IMAGE_LENGTH) {
    return false;
  }
  return /^data:image\/(jpeg|png);base64,/i.test(value);
}

/** Only http(s) or inline image URLs are ever stored or rendered. */
function isSafeImageUrl(value) {
  if (typeof value !== "string" || !value) return false;
  return /^https:\/\//i.test(value) || /^data:image\//i.test(value);
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
    const hasServerKey = !looksLikePlaceholder(serverApiKey);

    const apiKey = usingCustomKey ? customApiKey : serverApiKey;

    // A request is served by the mock fallback (a stock hairstyle image) when
    // there is no usable key to call the provider with. That is not a real
    // generation, so it must never cost the user credits — otherwise an
    // unconfigured server silently charges every user for a fake result.
    const willUseMock = !usingCustomKey && !hasServerKey;

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

    // 2. Generate the image
    let resultImage = "";
    let requestId = `mock_${Date.now()}`;
    let status = "processing";
    let refunded = false;
    let failureMessage = "";

    if (!willUseMock) {
      try {
        // MiniMax answers in one request — the finished image comes back in
        // the response, so there is nothing to poll for.
        const generated = await generateHairstyleImage({
          apiKey,
          prompt: cleanPrompt,
          inputImage,
        });

        if (!isSafeImageUrl(generated.image)) {
          throw new Error("The provider returned an unusable image reference.");
        }

        resultImage = generated.image;
        requestId = generated.requestId;
        status = "completed";
      } catch (err) {
        // The request never produced an image, so the user got nothing.
        // Refund the credits they were charged for.
        console.warn("MiniMax generation failed:", err);
        status = "failed";
        failureMessage = err?.message || "The image provider could not complete this request.";
        if (!usingCustomKey && cost > 0) {
          await UserService.addCredits(session.user.id, cost);
          refunded = true;
        }
      }
    } else {
      // Mock mode — no usable API key, so there is nothing real to call.
      console.warn(
        "[GENERATION] MINIMAX_API_KEY is missing or still a placeholder — " +
          "serving the stock-image fallback. No credits were charged."
      );
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

    // A failed generation carries the reason, so the page can say what went
    // wrong instead of "please try again".
    return NextResponse.json(
      status === "failed" ? { ...creation, error: failureMessage } : creation
    );
  } catch (error) {
    console.error("[GENERATION_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
