import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, normalizeEmail, validatePassword } from "@/lib/password";

// Prisma + pg need Node APIs on Cloudflare.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Free credits a brand new account starts with. */
const INITIAL_CREDITS = 10;

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);

    const email = normalizeEmail(body?.email);
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      // The response does not confirm that the address is registered. Saying
      // so would turn this endpoint into a way to discover which addresses
      // have accounts; the wording points at signing in instead.
      return NextResponse.json(
        {
          error:
            "Unable to create the account. If you already have one, try signing in.",
        },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    try {
      await prisma.user.create({
        data: {
          email,
          password: passwordHash,
          name: email.split("@")[0].slice(0, 64),
          credits: INITIAL_CREDITS,
        },
        select: { id: true },
      });
    } catch (err) {
      // P2002 = unique constraint. Two requests for the same address can race
      // past the lookup above; the database is the real arbiter.
      if (err?.code === "P2002") {
        return NextResponse.json(
          {
            error:
              "Unable to create the account. If you already have one, try signing in.",
          },
          { status: 409 }
        );
      }
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[REGISTER]", error);
    return NextResponse.json(
      { error: "Failed to create the account" },
      { status: 500 }
    );
  }
}
