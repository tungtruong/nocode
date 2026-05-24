import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { paypalConfigured, planIdFor, createSubscription } from "@/lib/paypal";
import type { Tier } from "@/lib/quota";

// Creates a PayPal subscription and returns the approval URL. Client
// redirects there; PayPal handles consent + first payment, then sends the
// user back to /dashboard?upgraded=<tier>. The webhook
// (/api/webhooks/paypal) is what actually flips the user's tier in the DB
// once PayPal confirms ACTIVATED — the return_url alone is not trustworthy
// because anyone can craft it.
export async function POST(req: NextRequest) {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }

    if (!paypalConfigured()) {
      return NextResponse.json(
        { error: "PayPal chưa cấu hình (cần PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET)" },
        { status: 500 }
      );
    }

    const { tier } = (await req.json()) as { tier?: Tier };
    if (tier !== "pro" && tier !== "team") {
      return NextResponse.json({ error: "Gói không hợp lệ" }, { status: 400 });
    }

    const planId = planIdFor(tier);
    if (!planId) {
      return NextResponse.json(
        { error: `Chưa có PAYPAL_PLAN_${tier.toUpperCase()} trong .env` },
        { status: 500 }
      );
    }

    const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_BASE_URL || "";
    const sub = await createSubscription({
      planId,
      email: session.email,
      tier,
      returnUrl: `${origin}/dashboard?upgraded=${tier}`,
      cancelUrl: `${origin}/pricing?canceled=1`,
    });

    return NextResponse.json({ url: sub.approvalUrl, id: sub.id });
  } catch (e) {
    console.error("Checkout error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Lỗi tạo thanh toán" }, { status: 500 });
  }
}
