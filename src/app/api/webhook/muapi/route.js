import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { isValidWebhookToken } from "../../../../lib/security";

// MuAPI webhook writes through Prisma + pg, both of which need Node APIs on Cloudflare.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only http(s) image URLs are ever stored or rendered. */
function isSafeImageUrl(value) {
  if (typeof value !== "string" || !value) return false;
  return /^https:\/\//i.test(value) || /^data:image\//i.test(value);
}

export async function POST(req) {
  try {
    // The callback URL we hand to MuAPI carries a token derived from
    // NEXTAUTH_SECRET. Without this check anyone could POST to this endpoint
    // and point a creation's resultImage at a URL of their choosing.
    const token = new URL(req.url).searchParams.get("token");
    if (!isValidWebhookToken(token)) {
      console.warn("[MUAPI_WEBHOOK] Rejected callback with a missing or invalid token");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await req.json();
    const requestId = data.id || data.request_id;

    if (!requestId) {
      console.error("[MUAPI_WEBHOOK_ERROR] Missing request id in payload", data);
      return NextResponse.json({ error: "Missing request id" }, { status: 400 });
    }

    const creation = await prisma.hairStyle.findFirst({ where: { requestId } });
    if (!creation) {
      console.warn(`[MUAPI_WEBHOOK_WARN] Creation not found for request ID: ${requestId}`);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (data.error || data.status === "failed" || data.state === "failed") {
      await prisma.hairStyle.update({
        where: { id: creation.id },
        data: { status: "failed" },
      });
      console.log(`[MUAPI_WEBHOOK] Updated creation ${creation.id} to failed`);
    } else {
      const outputs = data.outputs || [];
      const imageUrl =
        outputs[0] ||
        (typeof data.output === "string" ? data.output : data.output?.urls?.get);

      if (imageUrl && isSafeImageUrl(imageUrl)) {
        await prisma.hairStyle.update({
          where: { id: creation.id },
          data: {
            status: "completed",
            resultImage: imageUrl,
          },
        });
        console.log(`[MUAPI_WEBHOOK] Updated creation ${creation.id} to completed`);
      } else {
        console.warn(
          `[MUAPI_WEBHOOK_WARN] No usable output URL found in webhook payload for request ${requestId}`
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[MUAPI_WEBHOOK_ERROR]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
