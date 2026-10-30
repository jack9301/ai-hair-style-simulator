import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import config from "../../../lib/config";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "../../../lib/security";

// Uses `Buffer.from(...)` which is a Node API; pin to the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    // Uploading spends the server's MuAPI quota, so it must not be open to
    // anonymous callers.
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

    // Only allow image types we recognise, and use the validated type in the
    // data: URL rather than whatever the client claimed.
    const mimeType = (file.type || "").toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload a JPEG, PNG, WebP or GIF image." },
        { status: 415 }
      );
    }

    const apiKey = config.ai.apiKey;

    if (!apiKey || apiKey.includes("your_") || apiKey.trim() === "") {
      // Local Base64 Fallback
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      return NextResponse.json({ url: `data:${mimeType};base64,${buffer.toString("base64")}` });
    }

    const fd = new FormData();
    fd.append("file", file);

    const uploadRes = await fetch("https://api.muapi.ai/api/v1/upload_file", {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: fd,
    });

    if (!uploadRes.ok) {
      console.warn("MuAPI upload failed, falling back to base64");
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      return NextResponse.json({ url: `data:${mimeType};base64,${buffer.toString("base64")}` });
    }

    const result = await uploadRes.json();
    return NextResponse.json({ url: result.url || result.file_url || result.data?.url });
  } catch (error) {
    console.error("[UPLOAD_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
