import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingService } from "@/lib/services/billing";
import config from "@/lib/config";

// Stripe SDK relies on Node APIs (crypto, http) under the hood; pin to Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized. Please sign in." }, { status: 401 });
    }

    const { planId } = await req.json();
    if (!planId) {
      return NextResponse.json({ error: "Missing planId parameter" }, { status: 400 });
    }

    if (!config.stripe.plans[planId]) {
      return NextResponse.json({ error: "Invalid plan selected" }, { status: 400 });
    }

    const checkoutUrl = await BillingService.createCheckoutSession(session.user.id, planId);
    return NextResponse.json({ url: checkoutUrl });
  } catch (error) {
    // The raw error message can contain Stripe internals — log it, don't forward it.
    console.error("Checkout route error:", error);
    return NextResponse.json(
      { error: "Unable to start checkout. Please try again." },
      { status: 500 }
    );
  }
}
