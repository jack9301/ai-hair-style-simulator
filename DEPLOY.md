# 🚀 Deploying AI Hairstyle Simulator to Cloudflare Pages (via OpenNext)

This guide walks you through deploying the Next.js 16 app to **Cloudflare Pages** using the **OpenNext Cloudflare adapter**. It assumes you have never deployed anything to Cloudflare before.

> ⏱ **Total time:** ~30–45 minutes, mostly waiting for OAuth provider approvals and DNS / Stripe webhook configuration.

---

## 0. Prerequisites (have these ready before you start)

- A **Cloudflare account** (free tier works): https://dash.cloudflare.com/sign-up
- A **GitHub account** and this repo forked to your account
- **Node.js 18+** installed locally (`node -v`)
- A **Supabase account** (free tier): https://supabase.com — for the Postgres database
- A **Google Cloud Console** project with OAuth credentials (for sign-in)
- A **Stripe** account in test mode
- A **MuAPI account**: https://muapi.ai — for the AI image generation API

---

## 1. Provision the Database (Supabase) ⚠️ important

> **Do NOT skip this step.** Your workspace database is shared with other apps. Running `prisma db push` against a shared DB will drop tables belonging to other projects.

1. Go to https://supabase.com/dashboard and click **New Project**.
2. Pick a name (e.g. `ai-hair-style-sim`) and a strong database password — **save it**.
3. Choose the region closest to your users.
4. Wait ~2 minutes for the project to provision.
5. Go to **Project Settings → Database → Connection string → Transaction pooler**.
6. Copy the URL. It looks like:
   ```
   postgresql://postgres.xxxx:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
   - **Use the Transaction pooler URL** (port `6543`), not the direct connection (port `5432`), for Cloudflare Workers — the pooler handles the short-lived request lifetime correctly.
   - Keep `?sslmode=require` at the end. The app strips that parameter at runtime (see §11) because it no longer means what it used to.
   - The same host also serves a **Session pooler** on port `5432`. The Prisma CLI needs that one; `prisma.config.ts` rewrites the URL for you, so you only ever paste the `6543` URL.

---

## 2. Configure Google OAuth

1. Go to https://console.cloud.google.com/apis/credentials.
2. Create an **OAuth client ID** → Application type: **Web application**.
3. **Authorized JavaScript origins:**
   - `http://localhost:3000`
   - `https://YOUR-CLOUDFLARE-DOMAIN.pages.dev` (you'll know the exact URL after step 5)
4. **Authorized redirect URIs:**
   - `http://localhost:3000/api/auth/callback/google`
   - `https://YOUR-CLOUDFLARE-DOMAIN.pages.dev/api/auth/callback/google`
5. Copy the **Client ID** and **Client Secret** → you'll need them in step 5.

---

## 3. Configure Stripe (test mode is fine)

1. https://dashboard.stripe.com/test/apikeys → copy **Secret key** (`sk_test_...`) and **Publishable key** (`pk_test_...`).
2. https://dashboard.stripe.com/test/webhooks → **Add endpoint**:
   - URL: `https://YOUR-CLOUDFLARE-DOMAIN.pages.dev/api/stripe/webhook`
   - Listen for: `checkout.session.completed`
3. Copy the **Signing secret** (`whsec_...`).

---

## 4. Get a MuAPI Key

1. Sign up at https://muapi.ai and grab your **API Key**.

---

## 5. Connect the Repo to Cloudflare Pages

1. Go to https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**.
2. Select your forked repo.
3. **Build settings:**
   | Setting | Value |
   |---|---|
   | Framework preset | **None** (we use a custom build) |
   | Build command | `npx opennextjs-cloudflare build` |
   | Build output directory | `.open-next` |
   | Root directory | *(leave blank)* |
   | Node version | `20` (set via `NODE_VERSION=20` env var) |
4. Click **Save and Deploy** — the first build will fail because we haven't added env vars yet, that's fine.

---

## 6. Add Environment Variables in Cloudflare

In **Pages → your project → Settings → Environment variables**, add:

### Plain vars (Environment variables tab)

| Variable | Value |
|---|---|
| `NEXTAUTH_URL` | `https://YOUR-PROJECT.pages.dev` |
| `WEBHOOK_URL` | `https://YOUR-PROJECT.pages.dev` |
| `NODE_VERSION` | `20` |

### Secrets (Encrypt with the secret toggle)

| Variable | Value |
|---|---|
| `DATABASE_URL` | The Supabase pooler URL from step 1 |
| `NEXTAUTH_SECRET` | Run `openssl rand -base64 32` locally and paste |
| `GOOGLE_CLIENT_ID` | From step 2 |
| `GOOGLE_CLIENT_SECRET` | From step 2 |
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` |
| `MUAPIAPP_API_KEY` | From step 4 |

> Cloudflare encrypts secrets at rest — never commit them to git.

---

## 7. Push the Database Schema

Now that you have your own dedicated Supabase DB, push the Prisma schema into it.

Put the pooler URL in your **`.env` file** (as `DATABASE_URL`) — do *not* prefix the
command with `DATABASE_URL="…"`, that syntax does not work in Windows CMD. The CLI
reads `.env` by itself.

```bash
# Pull deps if you haven't already
npm install --legacy-peer-deps

# Generate Prisma client (creates the JS engine files)
npx prisma generate

# Push schema to Supabase (adds tables; safe — does NOT drop existing data)
npx prisma db push
```

You should see output like `Your database is now in sync with your Prisma schema.`

To check the connection without writing anything:

```bash
npx prisma migrate status
```

---

## 8. Redeploy

Back in Cloudflare Pages, hit **Retry deployment** (or push a new commit). The build should now succeed.

If it fails:
- Check the build log — common issues are missing env vars or wrong `DATABASE_URL`.
- The OpenNext docs are at https://opennext.js.org/cloudflare.

---

## 9. Update Webhook URLs (back-fill)

Once you know your final Cloudflare URL (`https://YOUR-PROJECT.pages.dev`):

1. **Google Cloud Console** → OAuth client → add the production redirect URI.
2. **Stripe dashboard** → webhook endpoint URL → update if you used a placeholder.
3. **MuAPI** → webhook URL → set to `https://YOUR-PROJECT/pages.dev/api/webhook/muapi`.

---

## 10. Local Development with Cloudflare Runtime

To develop locally using the *exact same* runtime Cloudflare uses:

```bash
# Copy env template
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your real keys

# Build once (compiles the worker)
npm run build      # builds Next.js
npx prisma generate
npx opennextjs-cloudflare build

# Start the local Cloudflare worker (uses .dev.vars)
npm run preview
```

This runs at `http://localhost:8787` by default — the Wrangler dev UI prints the URL.

---

## 11. Common Gotchas

| Problem | Fix |
|---|---|
| `DATABASE_URL` connection timeout from Cloudflare | Make sure you're using Supabase's **pooler** URL (port `6543`), not the direct DB URL (port `5432`). |
| `prisma db push` prints `Error: Schema engine error:` and then hangs | You are pointed at the **transaction** pooler (6543). The Prisma schema engine needs session-scoped DB behaviour and hangs against pgbouncer's transaction mode. `prisma.config.ts` rewrites the URL to the session pooler (5432) for you — check that your `.env` `DATABASE_URL` still has `6543` and that `PRISMA_CLI_DATABASE_URL` isn't overriding it with a transaction-pooler URL. |
| Every query fails with `SELF_SIGNED_CERT_IN_CHAIN` | `?sslmode=require` no longer means "encrypt but don't verify" — pg-connection-string ≥ 2.11 treats it as `verify-full`, and Supabase's cert is self-signed. The app strips the parameter and sets `ssl: { rejectUnauthorized: false }` (`src/lib/prisma.js`). If you wrote a *different* connection path, strip `sslmode` there too. For full verification, download Supabase's CA, set `sslrootcert` in `DATABASE_URL`, and remove the `ssl` option. |
| `crypto is not defined` in Stripe webhook | Confirmed the `runtime = "nodejs"` export is on `src/app/api/stripe/webhook/route.js` (already added). |
| `prisma db push` says "database not in sync" but doesn't apply | Run with `--accept-data-loss=false` first, then `--accept-data-loss=true` if you intend to reset. |
| OAuth loop after deploy | The redirect URI in Google Cloud Console must match `NEXTAUTH_URL` exactly, including https. |
| `wrangler secret put` prompts locally | Make sure your terminal handles interactive input — open in a normal shell, not a CI one. |
| `Module not found: Can't resolve 'pg-native'` | You're missing the optional build dep. Either `npm install pg-native` or run `prisma generate` with `--no-engine` since we use `@prisma/adapter-pg` (no native engine). |

---

## 12. Going to Production

When you're ready to launch for real:

1. **Stripe:** switch to live keys (`sk_live_...`, `pk_live_...`) and create a new webhook for `https://your-domain.com/api/stripe/webhook`.
2. **Cloudflare domain:** in Pages → Custom domains, attach your real domain (Cloudflare DNS makes this a 1-minute change).
3. **Supabase:** upgrade off the free tier if you expect traffic (free tier pauses after 1 week of inactivity).
4. **Env vars:** duplicate the test/live var values, this time with live keys.

---

That's it! 🎉 If you hit anything not covered here, the Cloudflare + OpenNext combo has excellent docs at https://opennext.js.org/cloudflare and https://developers.cloudflare.com/pages.
