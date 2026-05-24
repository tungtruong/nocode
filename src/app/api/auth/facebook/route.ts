import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { buildAuthUrl, facebookConfigured } from "@/lib/facebook-oauth";

// GET /api/auth/facebook?ref=...&redirect=...
// Mirror of /api/auth/google: mint state, drop into a short-lived cookie,
// 302 to Facebook consent.
export async function GET(req: NextRequest) {
  if (!facebookConfigured()) {
    return NextResponse.json(
      { error: "Facebook OAuth chưa cấu hình (cần FACEBOOK_CLIENT_ID + FACEBOOK_CLIENT_SECRET)" },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const ref = (url.searchParams.get("ref") || "").trim().toUpperCase().slice(0, 12);
  const requestedRedirect = url.searchParams.get("redirect") || "/builder";
  const safeRedirect = /^\/(?!\/)/.test(requestedRedirect) ? requestedRedirect : "/builder";

  const state = randomBytes(16).toString("hex");
  const stateData = JSON.stringify({ s: state, ref, r: safeRedirect });

  (await cookies()).set("nocode_oauth_fb", stateData, {
    httpOnly: true,
    secure: process.env.DEV_INSECURE_COOKIE !== "true",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/api/auth/facebook",
  });

  const origin = process.env.NEXT_PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  return NextResponse.redirect(buildAuthUrl(state, `${origin}/api/auth/facebook/callback`));
}
