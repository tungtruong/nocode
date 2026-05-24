import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { buildAuthUrl, googleConfigured } from "@/lib/google-oauth";

// GET /api/auth/google?ref=...&redirect=...
// Kicks off the Google OAuth dance. We mint a random `state`, drop it (plus
// the referral code and post-login redirect path) into a short-lived cookie,
// then 302 the user to Google's consent page.
export async function GET(req: NextRequest) {
  if (!googleConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth chưa cấu hình (cần GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)" },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const ref = (url.searchParams.get("ref") || "").trim().toUpperCase().slice(0, 12);
  const requestedRedirect = url.searchParams.get("redirect") || "/builder";
  // Only allow same-origin relative paths as the post-login redirect to
  // prevent open-redirect via ?redirect=https://evil.com.
  const safeRedirect = /^\/(?!\/)/.test(requestedRedirect) ? requestedRedirect : "/builder";

  const state = randomBytes(16).toString("hex");
  const stateData = JSON.stringify({ s: state, ref, r: safeRedirect });

  // Cookie scoped to /api/auth/google so it doesn't leak elsewhere.
  // 10-minute TTL is plenty for a user to click through Google.
  (await cookies()).set("nocode_oauth", stateData, {
    httpOnly: true,
    secure: process.env.DEV_INSECURE_COOKIE !== "true",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/api/auth/google",
  });

  // Derive redirect URI from the incoming request so dev/staging/prod all
  // work without per-env env vars. The same URI must be whitelisted in
  // Google Cloud Console → OAuth credentials.
  const origin = process.env.NEXT_PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  return NextResponse.redirect(buildAuthUrl(state, `${origin}/api/auth/google/callback`));
}
