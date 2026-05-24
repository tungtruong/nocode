import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { redeemCode } from "@/lib/invites";
import { checkRateLimit } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }

    // Slow down brute-force code guessers (5 attempts/hour/user is generous).
    const rl = checkRateLimit(`redeem:${session.email}`, 5, 60 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Quá nhiều lần nhập mã. Thử lại sau." }, { status: 429 });
    }

    const { code } = (await req.json()) as { code?: string };
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Thiếu mã" }, { status: 400 });
    }

    const result = redeemCode(session.email, code);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      tier: result.tier,
      daysGranted: result.daysGranted,
      newExpiresAt: result.newExpiresAt,
    });
  } catch (e) {
    console.error("Redeem error:", e);
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
