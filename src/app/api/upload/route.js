import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { AI_INPUT_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "../../../lib/security";

// Uses `Buffer.from(...)` which is a Node API; pin to the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    // Uploading is free now — the image is handed straight to the AI provider
    // with the generation request — but the endpoint still only serves
    // signed-in users.
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to upload an image." },
        { status: 401 }
      );
    }

    // Cheap early rejection before we buffer anything.
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_UPLOAD_BYTES + 1024) {
      return NextResponse.json(
        { error: "Image is too large." },
        { status: 413 }
      );
    }

    const data = await req.formData();
    const file = data.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Image is too large." },
        { status: 413 }
      );
    }

    // The AI provider takes JPEG and PNG only, so only those are accepted.
    // The browser converts whatever the user picked into a JPEG before it
    // gets here; this is the guard for anything that slipped past that.
    const mimeType = (file.type || "").toLowerCase();
    if (!AI_INPUT_IMAGE_TYPES.includes(mimeType)) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Please upload a JPEG or PNG image — most phones can save a photo as JPEG.",
        },
        { status: 415 }
      );
    }

    // The image is inlined as a data: URL rather than uploaded somewhere.
    // MiniMax accepts a reference image as base64, so there is no need for a
    // third party to host it for us.
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    return NextResponse.json({
      url: `data:${mimeType};base64,${buffer.toString("base64")}`,
    });
  } catch (error) {
    console.error("[UPLOAD_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
