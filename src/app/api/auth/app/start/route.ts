// GET /api/auth/app/start?app=<appId>&redirect=<post_login_url>
//
// End-user (visitor of a deployed JV app) clicks "Sign in with Google" inside
// the app → the runtime opens this URL → we redirect to Google's consent page.
// On callback we mint a per-app session cookie scoped to .justvibe.me and
// redirect back to the original page on the subdomain.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { buildAuthUrl, googleConfigured } from "@/lib/google-oauth";
import { ownerOfApp } from "@/lib/app-owner";

const APP_ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;
// Only allow https://*.justvibe.me or https://justvibe.me as a redirect back —
// no arbitrary URLs (open-redirect → could be used in phishing).
const ALLOWED_REDIRECT_RE = /^https:\/\/([a-zA-Z0-9-]+\.)?justvibe\.me(\/.*)?$/;

export async function GET(req: NextRequest) {
  if (!googleConfigured()) {
    return NextResponse.json({ error: "OAuth chưa cấu hình" }, { status: 500 });
  }

  const url = new URL(req.url);
  const appId = url.searchParams.get("app") || "";
  if (!APP_ID_RE.test(appId)) {
    return NextResponse.json({ error: "appId không hợp lệ" }, { status: 400 });
  }
  // Reject sign-in attempts for non-existent apps so we don't accidentally
  // create orphan _jv_users rows for typo'd or deleted apps.
  if (!(await ownerOfApp(appId))) {
    return NextResponse.json({ error: "App không tồn tại" }, { status: 404 });
  }

  const requestedRedirect = url.searchParams.get("redirect") || "";
  const safeRedirect = ALLOWED_REDIRECT_RE.test(requestedRedirect)
    ? requestedRedirect
    : "https://justvibe.me/";

  const state = randomBytes(16).toString("hex");
  const stateData = JSON.stringify({ s: state, app: appId, r: safeRedirect });

  (await cookies()).set("justvibe_app_oauth", stateData, {
    httpOnly: true,
    secure: process.env.DEV_INSECURE_COOKIE !== "true",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/api/auth/app",
  });

  const origin = process.env.NEXT_PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  return NextResponse.redirect(buildAuthUrl(state, `${origin}/api/auth/app/callback`));
}
