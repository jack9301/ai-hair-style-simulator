import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";

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
        creation = await prisma.hairStyle.update({
          where: { id: creation.id },
          data: { status: "failed" }
        });
      }

      return NextResponse.json(creation);
    }

    // 1. Fetch user's creations
    const creations = await prisma.hairStyle.findMany({
      where: { userId: session.user.id },
      orderBy: { createTime: "desc" }
    });

    // 2. Retire the ones that never finished.
    const stale = creations.filter(isStale);
    if (stale.length > 0) {
      await prisma.hairStyle.updateMany({
        where: { id: { in: stale.map((c) => c.id) } },
        data: { status: "failed" }
      });
      for (const creation of creations) {
        if (stale.includes(creation)) creation.status = "failed";
      }
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
