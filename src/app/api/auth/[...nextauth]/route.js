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
  const response = await handler(req, ctx);
  return routeFailureToDiagnostic(response, req);
}

export async function POST(req, ctx) {
  checkDatabase();
  const response = await handler(req, ctx);
  return routeFailureToDiagnostic(response, req);
}

/**
 * Send a failed sign-in through the diagnostic page.
 *
 * next-auth collapses every uncaught failure in the OAuth callback into one
 * code, "Callback", and redirects to its own sign-in page. For that list of
 * codes it skips `pages.error` altogether, so the failure never reaches the
 * page that knows how to explain it — the browser just lands back on the
 * sign-in form with no reason given.
 *
 * The redirect is caught here, where it is still visible, and pointed at
 * /auth/failure instead. That page works out what actually went wrong and
 * hands the sign-in page a category it can put into words.
 */
function routeFailureToDiagnostic(response, req) {
  const location = response.headers.get("Location");
  if (!location) return response;

  let target;
  try {
    target = new URL(location, req.nextUrl.origin);
  } catch {
    return response;
  }

  const error = target.searchParams.get("error");
  if (!error) return response;

  // Only failures that point back at this app's own pages are worth
  // re-routing. Anything else — a provider's authorisation URL, say — is
  // left exactly as it was.
  const pointsAtApp =
    target.pathname.startsWith("/api/auth/") ||
    target.pathname === "/login" ||
    target.pathname === "/auth/failure";
  if (!pointsAtApp) return response;

  const failure = new URL("/auth/failure", req.nextUrl.origin);
  failure.searchParams.set("error", error);
  // Keep the page the visitor was heading for, so signing in again takes
  // them back where they meant to go.
  const callbackUrl = target.searchParams.get("callbackUrl");
  if (callbackUrl) failure.searchParams.set("callbackUrl", callbackUrl);

  response.headers.set("Location", failure.toString());
  return response;
}
