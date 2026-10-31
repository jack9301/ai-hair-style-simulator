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

export async function GET(req) {
  checkDatabase();
  return handler(req);
}

export async function POST(req) {
  checkDatabase();
  return handler(req);
}
