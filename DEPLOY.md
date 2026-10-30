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
- A **MuAPI account**: https://muapi.ai — for the AI image generation API

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
   | `WEBHOOK_URL` | `https://YOUR-DOMAIN` — where MuAPI posts back |
   | `GOOGLE_CLIENT_ID` | Google Cloud console (§3) |
   | `GOOGLE_CLIENT_SECRET` | Google Cloud console (§3) |
   | `STRIPE_SECRET_KEY` | Stripe dashboard (§4) |
   | `STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint (§4) |
   | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe dashboard (§4) |
   | `MUAPIAPP_API_KEY` | https://muapi.ai |

   > ⚠️ `NEXTAUTH_SECRET` must be a real random value. A placeholder makes every session cookie forgeable, and the app **refuses to serve traffic** until it is set — that check runs at startup via `src/instrumentation.js`.
   >
   > ⚠️ `MUAPIAPP_API_KEY` must be real too. While it is a placeholder, generations silently fall back to stock images (and are not charged, deliberately).

4. Click **Deploy**. The first build takes a few minutes.

---

## 6. Point Google and Stripe at the final domain

Vercel gives you a domain like `ai-hair-style-simulator-rho.vercel.app` (or your own domain). Once you know it:

1. Go back to **Google Cloud Console → Credentials** and add
   `https://YOUR-DOMAIN/api/auth/callback/google` to the redirect URIs.
2. Go back to **Stripe → Webhooks** and set the endpoint URL to
   `https://YOUR-DOMAIN/api/webhook/stripe`.
3. In Vercel, update `NEXTAUTH_URL` and `WEBHOOK_URL` to `https://YOUR-DOMAIN` and redeploy.

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

Keep your local `.env` in sync with the Vercel dashboard. `.env` is gitignored, so it never leaves your machine. `NEXTAUTH_URL` and `WEBHOOK_URL` should point at `http://localhost:3000` locally.
