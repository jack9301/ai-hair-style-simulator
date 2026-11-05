# 🚀 Deploying AI Hairstyle Simulator to Vercel

This guide takes you from a fresh fork to a live site on **Vercel**, with **Supabase Postgres** as the database.

> ⏱ **Total time:** ~30–45 minutes, mostly waiting for OAuth provider approvals and DNS / Stripe webhook configuration.

---

## 0. Prerequisites

- A **GitHub account**, with this repo forked to your account
- A **Vercel account** (free tier works): https://vercel.com/sign-up
- **Node.js 20.9+** installed locally (`node -v`)
- A **Supabase account** (free tier): https://supabase.com — for the Postgres database
- A **Google Cloud Console** project with OAuth credentials (for sign-in)
- A **Stripe** account in test mode
- A **MiniMax account**: https://platform.minimax.io — for the AI image generation API

---

## 1. Provision the Database (Supabase) ⚠️ important

> **Do NOT skip this step.** A workspace database is shared with other apps. Running `prisma db push` against a shared DB will drop tables belonging to other projects.

1. Go to https://supabase.com/dashboard and click **New Project**.
2. Pick a name (e.g. `ai-hair-style-sim`) and a strong database password — **save it**.
3. Choose the region closest to your users.
4. Wait ~2 minutes for the project to provision.
5. Go to **Project Settings → Database → Connection string → Transaction pooler**.
6. Copy the URL. It looks like:
   ```
   postgresql://postgres.xxxx:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
   - **Use the Transaction pooler URL** (port `6543`). It handles many client connections over one Postgres backend, which is what a serverless platform like Vercel needs.
   - Keep `?sslmode=require` at the end. The app strips that parameter at runtime (see §7) because it no longer means what it used to.
   - The same host also serves a **Session pooler** on port `5432`. The Prisma CLI needs that one, and `prisma.config.ts` rewrites the URL for you automatically — so you only ever paste the `6543` URL.

---

## 2. Push the schema to the database

The schema has to exist before the app can serve a page. From your local checkout:

```bash
npm install
npx prisma db push
```

This only needs the `DATABASE_URL` in `.env`. It points at the **Session pooler** automatically — the Prisma schema engine hangs against the transaction pooler.

> ⚠️ **Push the schema to the same database the deployment uses.** If the `DATABASE_URL` in your local `.env` and the one set on the Vercel project are different databases, everything will work locally and fail in production — the app will report that the `User.password` column does not exist, or that it cannot reach the database at all.
>
> To push to a different database than the one in `.env`, put its URL in `.env` as `PRISMA_CLI_DATABASE_URL` and run `npx prisma db push` again. That variable takes priority over `DATABASE_URL` for the CLI only; the running app is unaffected.

Re-run `npx prisma db push` after every change to `prisma/schema.prisma` — including adding a column.

---

## 3. Configure Google OAuth

1. Go to https://console.cloud.google.com/ and create a project (or pick an existing one).
2. Enable **Google+ API** (APIs & Services → Library).
3. Go to **Credentials → Create Credentials → OAuth client ID → Web application**.
4. Under **Authorized redirect URIs** add:
   ```
   http://localhost:3000/api/auth/callback/google
   https://YOUR-DOMAIN/api/auth/callback/google
   ```
   Add both — the local one for development, the deployed one for production. If you later change domains, add the new one here; Google matches the host exactly.
5. Copy the **Client ID** and **Client Secret**. Both go into the Vercel env vars (§5).

---

## 4. Configure Stripe

1. Go to https://dashboard.stripe.com/test/apikeys and copy the **Secret key** and the **Publishable key**.
2. Go to **Developers → Webhooks → Add endpoint** and set the URL to:
   ```
   https://YOUR-DOMAIN/api/webhook/stripe
   ```
   (use `http://localhost:3000/api/webhook/stripe` for local testing, with the `stripe listen` CLI).
3. Subscribe to these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
4. Copy the endpoint's **Signing secret** into the `STRIPE_WEBHOOK_SECRET` env var.

---

## 5. Create the Vercel project

1. Go to https://vercel.com/new and **import the GitHub fork**.
2. Vercel auto-detects **Next.js**. Leave the build command as `npm run build` (that script runs `prisma generate && next build`, which is what Vercel needs).
3. Under **Environment Variables**, add all of these for **Production**, **Preview** and **Development**:

   | Variable | Where to get it |
   |---|---|
   | `DATABASE_URL` | The Supabase transaction pooler URL from §1 |
   | `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
   | `NEXTAUTH_URL` | `https://YOUR-DOMAIN` (no trailing slash) |
   | `GOOGLE_CLIENT_ID` | Google Cloud console (§3) |
   | `GOOGLE_CLIENT_SECRET` | Google Cloud console (§3) |
   | `STRIPE_SECRET_KEY` | Stripe dashboard (§4) |
   | `STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint (§4) |
   | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe dashboard (§4) |
   | `MINIMAX_API_KEY` | https://platform.minimax.io |

   > ⚠️ `NEXTAUTH_SECRET` must be a real random value. A placeholder makes every session cookie forgeable, and the app **refuses to serve traffic** until it is set — that check runs at startup via `src/instrumentation.js`.
   >
   > ⚠️ `MINIMAX_API_KEY` must be real too. While it is a placeholder, generations silently fall back to stock images (and are not charged, deliberately).

4. Click **Deploy**. The first build takes a few minutes.

---

## 6. Point Google and Stripe at the final domain

Vercel gives you a domain like `ai-hair-style-simulator-rho.vercel.app` (or your own domain). Once you know it:

1. Go back to **Google Cloud Console → Credentials** and add
   `https://YOUR-DOMAIN/api/auth/callback/google` to the redirect URIs.
2. Go back to **Stripe → Webhooks** and set the endpoint URL to
   `https://YOUR-DOMAIN/api/webhook/stripe`.
3. In Vercel, update `NEXTAUTH_URL` to `https://YOUR-DOMAIN` and redeploy.

---

## 7. Notes on the database connection

Two things about the Supabase connection string that bite people:

- **`?sslmode=require` no longer means "encrypt but don't verify".** `pg-connection-string` 2.11 and newer treat it as `verify-full`, so Supabase's self-signed certificate fails the check with `SELF_SIGNED_CERT_IN_CHAIN` on every query. `src/lib/prisma.js` strips the parameter and sets `ssl: { rejectUnauthorized: false }` explicitly instead. To verify properly, download Supabase's CA certificate and set `sslrootcert` in `DATABASE_URL`; the `ssl` option can then be dropped.
- **The Prisma CLI and the app need different poolers.** `npx prisma db push` must target the **Session pooler** (port `5432`) — the schema engine hangs against the transaction pooler. `prisma.config.ts` rewrites the URL for the CLI, so this happens on its own.

---

## 8. Everyday workflow

The Vercel project is connected to the GitHub repo, so **pushing to the connected branch deploys**:

```bash
git add -A
git commit -m "your message"
git push origin main
```

Watch the build at https://vercel.com/dashboard. Every push to `main` produces a new deployment; every pull request gets its own preview URL.

To deploy a change without touching `main`, push a branch and open a pull request — Vercel builds a preview for it automatically.

### Environment variables locally

Keep your local `.env` in sync with the Vercel dashboard. `.env` is gitignored, so it never leaves your machine. `NEXTAUTH_URL` should point at `http://localhost:3000` locally.

---

## 9. Changing an environment variable later

Go to **Project → Settings → Environment Variables**.

**You can edit a variable's value in place — there is no need to delete it and add a new one.** Vercel encrypts the value when you save it and deliberately does not show it again, so the field looks empty when you open it. That is expected, not a sign the variable was lost.

Two things to remember:

1. **Saving does not redeploy.** The live deployment keeps the value it was built with. Vercel shows a banner offering to redeploy — take it, or push a new commit.
2. **Check the scope.** A variable can be set for Production, Preview and Development independently. If only Production is wrong, fixing it there leaves preview deployments broken.

### Seeing the values that are actually set

Since the dashboard will not show them, pull them down with the CLI:

```bash
npx vercel login
npx vercel env pull .env.local --environment=production
```

That writes the production values to `.env.local`, which is gitignored. Read it locally to compare the `DATABASE_URL` with the one in your `.env` — the host and port tell you which Supabase project each one points at. Delete `.env.local` when you are done.

### If you change DATABASE_URL to a different database

A different database is an **empty** database. Push the schema to it before redeploying, or every query fails:

```bash
npx prisma db push
```

Run that with the new URL in `.env`, or set it as `PRISMA_CLI_DATABASE_URL` to push without touching your working `.env`. The app is unaffected by `PRISMA_CLI_DATABASE_URL` — it only tells the Prisma CLI where to connect.

> ⚠️ Pointing the deployment at a different database makes the old one invisible to the app: existing accounts, hairstyles and credit balances stay in the old database but the app no longer reads it. Prefer fixing the schema on the database you already have (`npx prisma db push`) over moving to a new one, unless that database is genuinely wrong.

---

## 10. When sign-in fails in production

The most common cause is that the deployment and the schema are pointing at two
different databases. It is easy to create by accident: `prisma db push` uses
the URL in your local `.env`, while the deployment uses the URL in the Vercel
dashboard. If those are not the same database, everything works locally and
nothing works in production.

The symptom is sign-in that fails without saying why — the browser returns to
the sign-in page and no user row appears in Supabase.

### Finding out what is wrong

A failed sign-in now reports its own cause. next-auth collapses every
uncaught failure in the OAuth callback into a single code called `Callback`,
and it redirects to its own sign-in page for that code — ignoring the
`pages.error` page entirely, so the failure would never have reached the part
of the app that can explain it. The route handler catches that redirect and
sends it through **`/auth/failure`** instead, which checks the database the
deployment is actually using and then redirects to the sign-in page with the
reason, in words:

| What it says | What it means |
|---|---|
| the database could not be reached | `DATABASE_URL` points at a host the deployment cannot connect to — usually Supabase's direct (IPv6-only) host instead of the transaction pooler |
| the database schema is out of date | the deployment is talking to a real database, but one that `prisma db push` was never run against |
| this deployment has no database configured | `DATABASE_URL` is not set for the environment the deployment runs in |
| the database is reachable and its schema is up to date | the database is fine, and the failure was something else — read the runtime log |

You can also open **`https://YOUR-DOMAIN/auth/failure`** yourself at any time.
Without an error code it works as a health check and reports the state of the
database, whichever way it comes out.

The server log has the detail. **Vercel → the project → Logs → Runtime Logs**
shows two lines from the app itself:

```
[prisma] database target: <host>:<port> project=<ref> fingerprint=<hash>
[prisma] schema check: ok
```

The first says which database the deployment is aimed at — the host, the port
and the Supabase project reference. The second says whether that database has
the tables the app needs. If the schema check reports that the `User` table is
missing `password`, the deployment is pointed at a database that predates the
email sign-up feature.

### The fix

1. In **Vercel → Settings → Environment Variables**, set `DATABASE_URL` to the
   transaction pooler URL (port `6543`) of the same Supabase project your local
   `.env` uses. Compare the host and port with the `database target` line in
   the log.
2. Push the schema to that database:
   ```bash
   npx prisma db push
   ```
3. Redeploy — saving the variable is not enough on its own (§9).

### Why the transaction pooler and not the direct connection

Supabase's direct host (`db.<ref>.supabase.co`) is IPv6-only. Serverless
functions reach it only sometimes, so the connection fails unpredictably. The
transaction pooler on port `6543` is the one that works from a serverless
platform, and it is the same URL you already use locally.

> The Supabase Vercel integration also adds `POSTGRES_URL` and
> `PRISMA_DATABASE_URL` to the project. The app only ever reads `DATABASE_URL`,
> so those two are harmless — but if one of them points at a different project
> than `DATABASE_URL`, that is worth tidying up before it confuses the next
> person.
