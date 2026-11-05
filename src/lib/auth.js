import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { sha256Hex } from "./security";
import { assertSecureServerConfig } from "./secrets";
import { hashPassword, needsRehash, normalizeEmail, verifyPassword } from "./password";

/**
 * Wrap an adapter so that a database failure during sign-in is logged with
 * its reason attached.
 *
 * next-auth catches everything that goes wrong in the OAuth callback and turns
 * it into a redirect back to the sign-in page. The browser therefore sees
 * nothing but a dead end, and without this the reason never reaches the log
 * either — the only symptom is that the visitor ends up where they started.
 */
function withLogging(adapter) {
  return Object.fromEntries(
    Object.entries(adapter).map(([name, fn]) => [
      name,
      typeof fn === "function"
        ? async (...args) => {
            try {
              return await fn(...args);
            } catch (err) {
              console.error(`[auth] database call "${name}" failed:`, err);
              throw err;
            }
          }
        : fn,
    ])
  );
}

const adapter = withLogging(PrismaAdapter(prisma));

/**
 * A hash of a value nobody knows, used to spend the same amount of time when
 * an email address has no account. Without it, the response time would reveal
 * which addresses are registered.
 *
 * Computed once and then reused, so the cost is paid on the first sign-in
 * attempt rather than on every module load.
 */
let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(`timing-equalizer-${crypto.randomUUID()}`);
  }
  return dummyHashPromise;
}

export const authOptions = {
  adapter,
  session: {
    strategy: "jwt",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    // The email provider and the API-key provider below are both
    // CredentialsProvider, whose factory hardcodes the id "credentials" and
    // parks this config in `options`. next-auth resolves the real id from
    // `options.id` when it parses the provider list, so "email" here and
    // "credentials" below end up as two distinct, routable providers.
    CredentialsProvider({
      id: "email",
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = normalizeEmail(credentials?.email);
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        // One message for every failure below, so the response cannot be used
        // to work out whether an address has an account or whether the
        // password was simply wrong.
        const invalid = new Error("Invalid email or password");

        if (!email || !password) throw invalid;

        const dbUser = await prisma.user.findUnique({ where: { email } });

        if (!dbUser || !dbUser.password) {
          // Spend the time a real verification would take, so a missing
          // account is not distinguishable by how quickly it fails.
          await verifyPassword(password, await getDummyHash());
          throw invalid;
        }

        const matches = await verifyPassword(password, dbUser.password);
        if (!matches) throw invalid;

        // The work factor may have been raised since this password was set.
        // Re-hash it now that the plaintext is available.
        if (needsRehash(dbUser.password)) {
          try {
            const upgraded = await hashPassword(password);
            await prisma.user.update({
              where: { id: dbUser.id },
              data: { password: upgraded },
            });
          } catch (err) {
            // A failed upgrade must not block a valid sign-in.
            console.warn("[auth] Could not upgrade password hash:", err?.message);
          }
        }

        return {
          id: dbUser.id,
          name: dbUser.name,
          email: dbUser.email,
          image: dbUser.image || null,
          credits: dbUser.credits,
          customApiKey: dbUser.customApiKey,
          isApiKeyUser: false,
        };
      },
    }),
    CredentialsProvider({
      id: "credentials",
      name: "API Key",
      credentials: {
        apiKey: { label: "MiniMax API Key", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.apiKey) {
          throw new Error("API Key is required");
        }
        const apiKey = String(credentials.apiKey).trim();
        if (apiKey.length < 8 || apiKey.length > 256) {
          throw new Error("Invalid API key format");
        }

        // The account identity is derived from a hash of the FULL key.
        //
        // This used to be `apikey_${apiKey.slice(-8)}@muapi.local`, which meant
        // anyone who knew only the last few characters of somebody else's key
        // matched that account by email and was handed its stored key and
        // credits. A hash of the whole key cannot be collided by a suffix.
        const identityEmail = `apikey_${sha256Hex(apiKey)}@minimax.local`;

        // The ONLY lookup that grants access to an existing account is an
        // exact match on the key itself.
        let dbUser = await prisma.user.findFirst({
          where: { customApiKey: apiKey },
        });

        if (dbUser) {
          // Migrate accounts created under the old suffix scheme onto the
          // hash-derived identity, so the old scheme can never be reached again.
          if (dbUser.email !== identityEmail) {
            try {
              dbUser = await prisma.user.update({
                where: { id: dbUser.id },
                data: { email: identityEmail },
              });
            } catch {
              // Another account already owns this identity — keep the current
              // email, the key match above is what authorises this login.
            }
          }
        } else {
          try {
            dbUser = await prisma.user.create({
              data: {
                name: "API Key User",
                email: identityEmail,
                customApiKey: apiKey,
                credits: 0,
              }
            });
          } catch (err) {
            // P2002 = unique constraint. The identity email is taken by an
            // account whose key was later changed (see /api/user/apikey), so
            // this key has been revoked — it is not a valid login.
            if (err?.code === "P2002") {
              throw new Error("This API key is no longer valid");
            }
            throw err;
          }
        }

        return {
          id: dbUser.id,
          name: dbUser.name,
          email: dbUser.email,
          image: dbUser.image || null,
          credits: dbUser.credits,
          customApiKey: dbUser.customApiKey || apiKey,
          isApiKeyUser: true,
        };
      }
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // A missing or placeholder NEXTAUTH_SECRET means every session cookie is
      // forgeable. Throwing here fails the request closed: next-auth swallows
      // the error and clears the session, so an attacker-supplied token is
      // never turned into a trusted session.
      assertSecureServerConfig();

      if (user) {
        token.id = user.id;
        token.credits = user.credits;
        token.customApiKey = user.customApiKey;
        token.isApiKeyUser = user.isApiKeyUser || false;
      }
      if (trigger === "update" && session) {
        if (session.customApiKey !== undefined) token.customApiKey = session.customApiKey;
        if (session.credits !== undefined) token.credits = session.credits;
      }
      const userId = token.id || token.sub;
      if (userId) {
        token.id = userId;
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { credits: true, customApiKey: true }
          });
          if (dbUser) {
            token.credits = dbUser.credits;
            token.customApiKey = dbUser.customApiKey;
          }
        } catch (err) {
          console.warn("[auth] Could not refresh credits from the database:", err?.message);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id || token.sub;
        session.user.credits = token.credits;
        session.user.customApiKey = token.customApiKey;
        session.user.isApiKeyUser = Boolean(token.customApiKey);
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
    // next-auth's own error page says only "there was a problem", which is no
    // help when the problem is a deployment aimed at the wrong database. This
    // route classifies the failure and hands the login page a category it can
    // explain in words.
    error: "/auth/failure",
  },
};
