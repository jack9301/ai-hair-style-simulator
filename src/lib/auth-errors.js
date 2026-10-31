/**
 * The vocabulary of authentication failures.
 *
 * The registration endpoint and the sign-in failure page both need to turn a
 * low-level error into something that names the fix, and they have to agree on
 * the names. Keeping them in one place is what makes the two endpoints tell
 * the same story — and what makes a failure diagnosable from the outside,
 * which matters most when the deployment is the thing that is misconfigured.
 */

/**
 * Every failure category, the HTTP status it maps to, and the message shown
 * for each of the two contexts it can appear in.
 *
 * The statuses are chosen so that the difference between "the database cannot
 * be reached" (503) and "the database is there but its schema does not match
 * this app" (500) survives all the way to a request log — that single bit of
 * information is what separates "check the connection string" from "push the
 * schema".
 */
export const FAILURES = {
  database_not_configured: {
    status: 503,
    registration:
      "Registration is unavailable: this deployment has no database configured.",
    signIn: "Sign-in is unavailable: this deployment has no database configured.",
  },
  database_unreachable: {
    status: 503,
    registration:
      "Registration is unavailable right now: the database could not be reached.",
    signIn: "Sign-in is unavailable right now: the database could not be reached.",
  },
  schema_out_of_date: {
    status: 500,
    registration:
      "Registration is unavailable: the server's database schema is out of date and needs updating.",
    signIn:
      "Sign-in is unavailable: the server's database schema is out of date and needs updating.",
  },
  client_out_of_date: {
    status: 500,
    registration:
      "Registration is unavailable: the app needs to be rebuilt and redeployed.",
    signIn: "Sign-in is unavailable: the app needs to be rebuilt and redeployed.",
  },
  hashing_failed: {
    status: 500,
    registration:
      "Registration is unavailable: this runtime could not hash the password.",
    signIn: "Sign-in is unavailable: this runtime could not hash the password.",
  },
  account_exists: {
    status: 409,
    registration:
      "Unable to create the account. If you already have one, try signing in.",
    signIn:
      "This email address already has an account. Sign in with email and password instead.",
  },
  invalid_credentials: {
    status: 401,
    registration:
      "Unable to create the account. If you already have one, try signing in.",
    signIn: "That email address and password combination was not accepted.",
  },
  internal: {
    status: 500,
    registration: "Failed to create the account.",
    signIn: "Sign-in failed. Please try again.",
  },
};

/**
 * Work out which category a low-level failure belongs to.
 *
 * Accepts an Error (as thrown by Prisma or pg) or a bare message, because
 * next-auth only ever hands on a message.
 *
 * The order of the checks matters: a missing table and a missing column are
 * both "the schema is out of date", and that has to be recognised before the
 * broader "could not be reached" patterns, which some connection errors also
 * match.
 */
export function classifyError(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = String(error?.message ?? error ?? "");

  // P2002 = unique constraint violated.
  if (code === "P2002") return "account_exists";

  // P2021 = the table is missing, P2022 = the column is missing. In both cases
  // the database answered, so it is reachable — it is simply not the schema
  // this app was written against.
  if (
    code === "P2021" ||
    code === "P2022" ||
    /does not exist in the current database|column .* does not exist/i.test(message)
  ) {
    return "schema_out_of_date";
  }

  // P1001 = the server could not be reached at all.
  if (
    code === "P1001" ||
    /can't reach database server|econnrefused|econnreset|enotfound|etimedout|eai_again|timeout expired|terminating connection|connection terminated|self signed cert/i.test(
      message
    )
  ) {
    return "database_unreachable";
  }

  // "Unknown argument `password`" — the generated Prisma client on the server
  // predates the field, which happens when the build did not regenerate it.
  if (/unknown argument|unknown field|invalid `prisma\.user\.create`/i.test(message)) {
    return "client_out_of_date";
  }

  if (/subtle|webcrypto|pbkdf2|randomvalues/i.test(message)) {
    return "hashing_failed";
  }

  // next-auth's own error codes, plus the message the email provider throws.
  if (
    /credentials_signin|invalid email or password|invalid credentials/i.test(
      message
    )
  ) {
    return "invalid_credentials";
  }
  if (/oauthaccountnotlinked|oauthcreateaccount|emailcreateaccount/i.test(message)) {
    return "account_exists";
  }
  if (/oauthcallback|oauthsignin|^callback$/i.test(message)) {
    // next-auth collapses every uncaught failure in the OAuth callback into
    // this one code, so it says nothing on its own — the real reason is in
    // the server log.
    return "internal";
  }

  return "internal";
}

/** The failure record for a category, with a safe fallback. */
export function failureFor(category) {
  return FAILURES[category] || FAILURES.internal;
}

/** The message to show for a category in a given context. */
export function messageFor(category, context = "signIn") {
  const failure = failureFor(category);
  return failure[context] || failure.signIn;
}
