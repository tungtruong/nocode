import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { buildAuthUrl, zaloConfigured } from "@/lib/zalo-oauth";

// GET /api/auth/zalo?ref=...&redirect=...
// Zalo's `redirect_uri` must be EXACTLY whitelisted in the Zalo Developers
// console (https://developers.zalo.me/app/<id>/login). Mismatches fail
// silently with a generic "invalid request" — double-check there if you see
// `oauth_callback_error` after configuring.
export async function GET(req: NextRequest) {
  if (!zaloConfigured()) {
    return NextResponse.json(
      { error: "Zalo OAuth chưa cấu hình (cần ZALO_APP_ID + ZALO_APP_SECRET)" },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const ref = (url.searchParams.get("ref") || "").trim().toUpperCase().slice(0, 12);
  const requestedRedirect = url.searchParams.get("redirect") || "/builder";
  const safeRedirect = /^\/(?!\/)/.test(requestedRedirect) ? requestedRedirect : "/builder";

  const state = randomBytes(16).toString("hex");
  const stateData = JSON.stringify({ s: state, ref, r: safeRedirect });

  (await cookies()).set("nocode_oauth_zalo", stateData, {
    httpOnly: true,
    secure: process.env.DEV_INSECURE_COOKIE !== "true",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/api/auth/zalo",
  });

  const origin = process.env.NEXT_PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  return NextResponse.redirect(buildAuthUrl(state, `${origin}/api/auth/zalo/callback`));
}
