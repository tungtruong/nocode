// POST /api/topup/capture { orderId }
// Called after the user comes back from PayPal approval. Captures the order
// synchronously and flips the topup row to 'completed', which makes the
// tokens immediately available via getTopupTokens().
//
// Idempotent: if the row is already 'completed' (e.g. webhook beat us to it),
// we just return success without re-charging.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { paypalConfigured, captureOrder } from "@/lib/paypal";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  if (!paypalConfigured()) {
    return NextResponse.json({ error: "Thanh toán chưa cấu hình" }, { status: 500 });
  }

  let body: { orderId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  if (typeof body.orderId !== "string" || !body.orderId) {
    return NextResponse.json({ error: "Thiếu orderId" }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare("SELECT user_email, status, tokens_added, pack_id FROM topups WHERE paypal_order_id = ?")
    .get(body.orderId) as { user_email: string; status: string; tokens_added: number; pack_id: string } | undefined;

  if (!row) {
    return NextResponse.json({ error: "Không tìm thấy đơn hàng" }, { status: 404 });
  }
  if (row.user_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }
  // Already credited (webhook ran first) — return success without re-charging.
  if (row.status === "completed") {
    return NextResponse.json({ ok: true, alreadyCredited: true, tokensAdded: row.tokens_added });
  }
  if (row.status === "failed") {
    return NextResponse.json({ error: "Đơn hàng đã bị huỷ hoặc thất bại trước đó" }, { status: 409 });
  }

  try {
    const captured = await captureOrder(body.orderId);
    if (captured.status !== "COMPLETED") {
      // Don't flip status to failed — capture may retry. Tell client to try again.
      return NextResponse.json({ error: `PayPal status: ${captured.status}` }, { status: 502 });
    }

    db.prepare(
      "UPDATE topups SET status = 'completed', completed_at = ? WHERE paypal_order_id = ?"
    ).run(new Date().toISOString(), body.orderId);

    console.log(`[topup/capture] ${session.email} +${row.tokens_added} tokens (pack=${row.pack_id} order=${body.orderId})`);

    return NextResponse.json({ ok: true, tokensAdded: row.tokens_added });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[topup/capture] failed:", msg);
    // Mark failed so user isn't charged again on retry — they can buy a fresh
    // pack. Tokens were never credited.
    db.prepare("UPDATE topups SET status = 'failed' WHERE paypal_order_id = ?")
      .run(body.orderId);
    return NextResponse.json({ error: "Capture thất bại" }, { status: 502 });
  }
}
