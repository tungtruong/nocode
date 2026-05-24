import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getStripe, priceIdFor } from "@/lib/stripe";
import { getDb } from "@/lib/db";
import type { Tier } from "@/lib/quota";

// Creates a Stripe Checkout Session for the requested tier and returns the
// session URL. Client redirects there; Stripe handles the card form, the
// success/cancel redirects, and fires `checkout.session.completed` to our
// webhook to flip the user's tier in the DB.
export async function POST(req: NextRequest) {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: "Stripe chưa cấu hình (cần STRIPE_SECRET_KEY)" }, { status: 500 });
    }

    const { tier } = (await req.json()) as { tier?: Tier };
    if (tier !== "pro" && tier !== "team") {
      return NextResponse.json({ error: "Gói không hợp lệ" }, { status: 400 });
    }

    const priceId = priceIdFor(tier);
    if (!priceId) {
      return NextResponse.json(
        { error: `Chưa có STRIPE_PRICE_${tier.toUpperCase()} trong .env` },
        { status: 500 }
      );
    }

    // Reuse the user's Stripe customer if we've created one before so all of
    // their subscriptions show up under a single customer record.
    const db = getDb();
    const row = db
      .prepare("SELECT stripe_customer_id FROM users WHERE email = ?")
      .get(session.email) as { stripe_customer_id?: string } | undefined;

    const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_BASE_URL || "";
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // Either reuse existing customer or create one tied to the email.
      ...(row?.stripe_customer_id
        ? { customer: row.stripe_customer_id }
        : { customer_email: session.email, customer_creation: "always" as const }),
      // Webhook needs to know which user to credit when payment succeeds.
      client_reference_id: session.email,
      metadata: { email: session.email, tier },
      subscription_data: { metadata: { email: session.email, tier } },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      success_url: `${origin}/dashboard?upgraded=${tier}`,
      cancel_url: `${origin}/pricing?canceled=1`,
    });

    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    console.error("Checkout error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Lỗi tạo thanh toán" }, { status: 500 });
  }
}
