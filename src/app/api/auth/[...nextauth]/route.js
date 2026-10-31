import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { probeSchema } from "@/lib/prisma";

const handler = NextAuth(authOptions);

/**
 * Report once per cold start which database this deployment is using and
 * whether its schema matches the app.
 *
 * The probe is memoised, so this costs one query per function instance
 * rather than one per request.
 */
function checkDatabase() {
  probeSchema();
}

/**
 * The route context has to be passed on to next-auth.
 *
 * next-auth decides between its App Router and its Pages Router
 * implementation by looking at the second argument: if it carries `params`,
 * the App Router path is used, and only that path knows how to read the
 * route's dynamic segment. Calling the handler without it sends next-auth
 * down the Pages Router path, where `req.query` does not exist and every
 * request fails with a TypeError.
 */
export async function GET(req, ctx) {
  checkDatabase();
  return handler(req, ctx);
}

export async function POST(req, ctx) {
  checkDatabase();
  return handler(req, ctx);
}
