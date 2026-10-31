import { NextResponse } from "next/server";
import { classifyError } from "@/lib/auth-errors";
import { probeSchema } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where next-auth sends the browser when a sign-in fails.
 *
 * next-auth's own error page says only "there was a problem", and it collapses
 * every uncaught failure in the OAuth callback into a single code called
 * "Callback" — which is no help at all when the problem is a deployment aimed
 * at the wrong database.
 *
 * This route classifies the failure and hands the login page a category it can
 * explain in words. The reason is written to the server log, where the owner
 * of the deployment can read the full detail.
 *
 * Visiting it without an error code works as a diagnostic: it reports the
 * state of the database the deployment is actually using.
 */
export async function GET(req) {
  const raw = req.nextUrl.searchParams.get("error") || "";

  let category = raw ? classifyError(raw) : "";

  if (!category || category === "internal") {
    // Either there was nothing to classify, or what came back was not
    // recognisable. Ask the database directly rather than guess: whether it
    // can be reached at all, and whether its schema matches this app, is the
    // question that matters.
    const schema = await probeSchema();
    if (
      schema.reason === "missing_user_table" ||
      schema.reason === "missing_columns"
    ) {
      category = "schema_out_of_date";
    } else if (schema.reason === "unreachable") {
      category = "database_unreachable";
    } else if (!category) {
      category = "internal";
    }
  }

  console.error(`[AUTH] sign-in failed (${category}):`, raw || "(no error code)");

  const url = new URL("/login", req.nextUrl);
  url.search = "";
  url.searchParams.set("reason", category);
  // The category is also sent as a code so the login page can style the
  // message without having to know the wording.
  url.searchParams.set("code", category);

  return NextResponse.redirect(url, {
    headers: { "Cache-Control": "no-store" },
  });
}
