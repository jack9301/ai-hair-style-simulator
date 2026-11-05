import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { UserService } from "../../../lib/services/user";

/**
 * How long a creation may stay "processing" before we call it failed.
 *
 * The image provider answers in a single request, so a creation is finished
 * by the time the response is sent. A row that is still "processing" long
 * after that means the request died half-way through — the process was
 * restarted, say — and it would otherwise stay unfinished for ever, with the
 * gallery spinning on it.
 */
const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      let creation = await prisma.hairStyle.findFirst({
        where: { id, userId: session.user.id }
      });
      if (!creation) {
        return new NextResponse("Not Found", { status: 404 });
      }

      if (isStale(creation)) {
        // Retire it and give the credits back — see the list branch below.
        const { count } = await prisma.hairStyle.updateMany({
          where: { id: creation.id, status: "processing" },
          data: { status: "failed", creditCost: 0 },
        });
        if (count === 1) {
          const cost = creation.creditCost || 0;
          if (cost > 0) {
            await UserService.addCredits(creation.userId, cost);
          }
        }
        creation = await prisma.hairStyle.findFirst({
          where: { id, userId: session.user.id }
        });
      }

      return NextResponse.json(creation);
    }

    // 1. Fetch user's creations
    //
    // `inputImage` is left out on purpose. It is the original photo, stored
    // inline as base64, and the gallery only needs it for the one result the
    // user opens — the detail view fetches it on demand from the single-row
    // endpoint. Carrying it in every row of the list doubled the size of the
    // response for nothing.
    const creations = await prisma.hairStyle.findMany({
      where: { userId: session.user.id },
      orderBy: { createTime: "desc" },
      select: {
        id: true,
        userId: true,
        resultImage: true,
        gender: true,
        styleName: true,
        colorName: true,
        prompt: true,
        requestId: true,
        status: true,
        creditCost: true,
        createTime: true,
        updateTime: true,
      },
    });

    // 2. Retire the ones that never finished.
    //
    // A generation that never came back was paid for and never delivered —
    // most likely the function was killed by the platform's timeout — so the
    // credits go back. The update is conditional on the row still being
    // "processing", so when two requests race, only the one that actually
    // retired the row refunds it.
    const stale = creations.filter(isStale);
    for (const creation of stale) {
      const { count } = await prisma.hairStyle.updateMany({
        where: { id: creation.id, status: "processing" },
        data: { status: "failed", creditCost: 0 },
      });
      if (count === 1) {
        const cost = creation.creditCost || 0;
        if (cost > 0) {
          await UserService.addCredits(creation.userId, cost);
        }
      }
      creation.status = "failed";
    }

    return NextResponse.json(creations);
  } catch (error) {
    console.error("[CREATIONS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

/** True when a creation has been "processing" for too long to still be real. */
function isStale(creation) {
  if (creation.status !== "processing") return false;
  const started = creation.createTime ? new Date(creation.createTime).getTime() : 0;
  return Date.now() - started > PROCESSING_TIMEOUT_MS;
}

export async function DELETE(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return new NextResponse("Missing creation ID", { status: 400 });
    }

    const creation = await prisma.hairStyle.findFirst({
      where: { id, userId: session.user.id }
    });

    if (!creation) {
      return new NextResponse("Not Found", { status: 404 });
    }

    await prisma.hairStyle.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[CREATIONS_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
