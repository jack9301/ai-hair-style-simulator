import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";

/**
 * How long a creation may stay "processing" before we call it failed.
 *
 * The image provider answers in a single request, so a creation is finished by
 * the time the response is sent. A row that is still "processing" long after
 * that means the request died half-way through, and it would otherwise stay
 * unfinished for ever.
 */
const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { id } = await params;

    let creation = await prisma.hairStyle.findFirst({
      where: { id, userId: session.user.id }
    });

    if (!creation) {
      return new NextResponse("Not Found", { status: 404 });
    }

    if (creation.status === "processing") {
      const started = creation.createTime ? new Date(creation.createTime).getTime() : 0;
      if (Date.now() - started > PROCESSING_TIMEOUT_MS) {
        creation = await prisma.hairStyle.update({
          where: { id: creation.id },
          data: { status: "failed" }
        });
      }
    }

    return NextResponse.json(creation);
  } catch (error) {
    console.error("[CREATION_ID_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { id } = await params;

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
    console.error("[CREATION_ID_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
