// POST /api/topup/create { packId }
// Starts a one-time PayPal order for a token topup pack. Returns the approval
// URL the client should redirect to. Only Pro/Max can buy; Free is told to
// upgrade their tier first (the cheapest path).

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { TOPUP_PACKS, isValidPackId, canBuyTopup, tierFor, TIER_LABELS } from "@/lib/quota";
import { paypalConfigured, createOrder } from "@/lib/paypal";
import { getDb } from "@/lib/db";

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  if (!paypalConfigured()) {
    return NextResponse.json({ error: "Thanh toán chưa cấu hình" }, { status: 500 });
  }

  if (!canBuyTopup(session.email)) {
    return NextResponse.json({
      error: `Gói ${TIER_LABELS[tierFor(session.email)]} chưa hỗ trợ mua thêm token. Nâng cấp Pro hoặc Max để mở tính năng này.`,
      code: "TOPUP_TIER_NOT_ALLOWED",
    }, { status: 403 });
  }

  let body: { packId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  if (!isValidPackId(body.packId)) {
    return NextResponse.json({ error: "Pack không hợp lệ" }, { status: 400 });
  }

  const pack = TOPUP_PACKS[body.packId];
  const origin = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;

  try {
    const order = await createOrder({
      amountUsd: pack.priceUsd,
      description: `JustVibe ${pack.label} (+${(pack.tokens / 1_000_000).toFixed(0)}M token)`,
      // custom_id encodes email + pack so the webhook + capture endpoint can
      // credit the right user even if the user redirect comes back missing.
      custom_id: `${session.email}|${pack.id}`,
      // PayPal appends ?token=<orderId>&PayerID=... automatically on success
      // return — the dashboard reads `token` and POSTs to /api/topup/capture.
      returnUrl: `${origin}/dashboard?topup=success`,
      cancelUrl: `${origin}/dashboard?topup=cancel`,
    });

    // Pre-insert pending row so the user always has audit trail even if the
    // capture step is interrupted. UNIQUE(paypal_order_id) prevents dup-credit.
    getDb()
      .prepare(
        `INSERT INTO topups (user_email, period, pack_id, tokens_added, price_usd, paypal_order_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(session.email, currentPeriod(), pack.id, pack.tokens, pack.priceUsd, order.id, new Date().toISOString());

    return NextResponse.json({ orderId: order.id, approvalUrl: order.approvalUrl });
  } catch (e) {
    console.error("[topup/create] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Không tạo được đơn hàng" }, { status: 500 });
  }
}
