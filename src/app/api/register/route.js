import { NextResponse } from "next/server";
import { prisma, probeSchema } from "@/lib/prisma";
import { classifyError, failureFor } from "@/lib/auth-errors";
import { hashPassword, normalizeEmail, validatePassword } from "@/lib/password";

// Prisma + pg need Node APIs; pin the route to the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Free credits a brand new account starts with. */
const INITIAL_CREDITS = 10;

export async function POST(req) {
  try {
    // A deployment with no DATABASE_URL cannot do anything at all, and the
    // failure it would otherwise produce is indistinguishable from a database
    // that is merely unreachable.
    if (!process.env.DATABASE_URL) {
      const failure = failureFor("database_not_configured");
      console.error("[REGISTER] database_not_configured: DATABASE_URL is not set");
      return NextResponse.json(
        { error: failure.registration, code: "database_not_configured" },
        { status: failure.status }
      );
    }

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
      const failure = failureFor("account_exists");
      return NextResponse.json(
        { error: failure.registration, code: "account_exists" },
        { status: failure.status }
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
        const failure = failureFor("account_exists");
        return NextResponse.json(
          { error: failure.registration, code: "account_exists" },
          { status: failure.status }
        );
      }
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    let kind = classifyError(error);

    if (kind === "internal") {
      // The raw error was not recognisable. Ask the database directly rather
      // than guess: whether it can be reached at all is the single most
      // useful thing to know, and it is what separates "fix the connection
      // string" from "push the schema".
      const schema = await probeSchema();
      if (schema.reason === "missing_user_table" || schema.reason === "missing_columns") {
        kind = "schema_out_of_date";
      } else if (schema.reason === "unreachable") {
        kind = "database_unreachable";
      }
    }

    const failure = failureFor(kind);
    // The full error goes to the server log; the client gets the category and
    // a message that says which fix is needed.
    console.error(`[REGISTER] ${kind}`, error);
    return NextResponse.json(
      { error: failure.registration, code: kind },
      { status: failure.status }
    );
  }
}
