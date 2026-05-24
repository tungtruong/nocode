import { NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getReferralStats } from "@/lib/referrals";

export async function GET() {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }
    const stats = getReferralStats(session.email);
    return NextResponse.json(stats);
  } catch (e) {
    console.error("Referral stats error:", e);
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
