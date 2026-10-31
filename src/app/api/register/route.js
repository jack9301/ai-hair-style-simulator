import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, normalizeEmail, validatePassword } from "@/lib/password";

// Prisma + pg need Node APIs; pin the route to the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Free credits a brand new account starts with. */
const INITIAL_CREDITS = 10;

/**
 * Work out what actually went wrong.
 *
 * A registration can fail for several quite different reasons — the database
 * is unreachable, the schema on the server is older than the schema in this
 * repo, the generated Prisma client is stale — and they need completely
 * different fixes. Reporting them all as one generic "Failed to create the
 * account" makes the problem impossible to diagnose from the browser, so each
 * one gets its own message.
 */
function classifyError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = String(error?.message || "");

  if (code === "P2002") return "duplicate";
  if (
    code === "P1001" ||
    /can't reach database server|econnrefused|econnreset|enotfound|etimedout|eai_again|timeout|terminating connection/i.test(
      message
    )
  ) {
    return "database_unreachable";
  }
  // P2022 = "the column does not exist in the database" — the server is still
  // on the schema from before `User.password` was added.
  if (code === "P2022" || /column .* does not exist/i.test(message)) {
    return "schema_out_of_date";
  }
  // "Unknown argument `password`" — the generated Prisma client on the server
  // predates the field, which happens when the build did not regenerate it.
  if (/unknown argument|unknown field|invalid `prisma\.user\.create`/i.test(message)) {
    return "client_out_of_date";
  }
  if (/subtle|webcrypto|pbkdf2|randomvalues/i.test(message)) {
    return "hashing_failed";
  }
  return "internal";
}

const FAILURES = {
  database_unreachable: {
    status: 503,
    error:
      "Registration is unavailable right now: the database could not be reached.",
  },
  schema_out_of_date: {
    status: 500,
    error:
      "Registration is unavailable: the server's database schema is out of date and needs updating.",
  },
  client_out_of_date: {
    status: 500,
    error:
      "Registration is unavailable: the app needs to be rebuilt and redeployed.",
  },
  hashing_failed: {
    status: 500,
    error:
      "Registration is unavailable: this runtime could not hash the password.",
  },
  internal: {
    status: 500,
    error: "Failed to create the account",
  },
};

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
    const kind = classifyError(error);
    const failure = FAILURES[kind] || FAILURES.internal;
    // The full error goes to the server log; the client gets the category and
    // a message that says which fix is needed.
    console.error(`[REGISTER] ${kind}`, error);
    return NextResponse.json(
      { error: failure.error, code: kind },
      { status: failure.status }
    );
  }
}
