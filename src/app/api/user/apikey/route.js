import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Prisma + pg need Node APIs on Cloudflare.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 256;

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const apiKey = body.apiKey ? String(body.apiKey).trim() : "";

    if (apiKey.length < MIN_KEY_LENGTH || apiKey.length > MAX_KEY_LENGTH) {
      return NextResponse.json(
        { error: `API key must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters.` },
        { status: 400 }
      );
    }

    if (/\s/.test(apiKey)) {
      return NextResponse.json(
        { error: "API key must not contain whitespace." },
        { status: 400 }
      );
    }

    // A key identifies exactly one account. If another account already stores
    // this key, saving it here would make the key -> account mapping
    // ambiguous, and whoever logs in with the key next would land on an
    // arbitrary account (and inherit its credits and stored key).
    const existingOwner = await prisma.user.findFirst({
      where: { customApiKey: apiKey },
      select: { id: true },
    });

    if (existingOwner && existingOwner.id !== session.user.id) {
      return NextResponse.json(
        { error: "This API key is already linked to another account." },
        { status: 409 }
      );
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: { customApiKey: apiKey },
      select: { id: true, credits: true, customApiKey: true },
    });

    return NextResponse.json({
      success: true,
      customApiKey: updatedUser.customApiKey,
    });
  } catch (error) {
    console.error("Error updating custom API key:", error);
    return NextResponse.json(
      { error: "Failed to update API key" },
      { status: 500 }
    );
  }
}

export async function DELETE(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { customApiKey: null },
    });

    return NextResponse.json({ success: true, customApiKey: null });
  } catch (error) {
    console.error("Error clearing custom API key:", error);
    return NextResponse.json(
      { error: "Failed to remove API key" },
      { status: 500 }
    );
  }
}
