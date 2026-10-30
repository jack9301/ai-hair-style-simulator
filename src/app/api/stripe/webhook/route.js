import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { BillingService } from "../../../../lib/services/billing";

// Stripe webhook signature verification uses Node `crypto`; pin to the Node runtime
// so it always has access to Node crypto.
export const runtime = "nodejs";
// Webhooks must never be cached.
export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.text();
  const signature = (await headers()).get("Stripe-Signature");

  if (!signature) {
    return new NextResponse("Invalid signature", { status: 400 });
  }

  try {
    const result = await BillingService.handleWebhook(body, signature);
    return NextResponse.json(result);
  } catch (error) {
    // Don't forward the raw error — it can contain Stripe internals.
    console.error("[STRIPE_WEBHOOK]", error);
    return new NextResponse("Webhook processing failed", { status: 400 });
  }
}
