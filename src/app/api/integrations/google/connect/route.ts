// GET /api/integrations/google/connect
//
// Starts the Google "Connect" OAuth flow for Sheets + Drive. Separate from
// the login flow (/api/auth/google) because:
//   - asks for additional scopes (spreadsheets, drive.file) that aren't
//     needed just to log in;
//   - uses access_type=offline + prompt=consent to guarantee a refresh_token.
//
// Drops a state cookie scoped to /api/integrations/google so it doesn't
// collide with the login OAuth cookie.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { requireSession, authError } from "@/lib/auth";
import { googleConfigured, buildConnectUrl, GOOGLE_SCOPES } from "@/lib/google-oauth";

export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  if (!googleConfigured()) {
    return NextResponse.json({ error: "Google OAuth chưa cấu hình" }, { status: 500 });
  }

  const url = new URL(req.url);
  const requestedReturn = url.searchParams.get("returnTo") || "/dashboard/integrations";
  // Only allow same-origin relative paths.
  const safeReturn = /^\/(?!\/)/.test(requestedReturn) ? requestedReturn : "/dashboard/integrations";

  const state = randomBytes(16).toString("hex");
  const stateData = JSON.stringify({ s: state, e: session.email, r: safeReturn });

  (await cookies()).set("justvibe_integration_oauth", stateData, {
    httpOnly: true,
    secure: process.env.DEV_INSECURE_COOKIE !== "true",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/api/integrations/google",
  });

  const origin = process.env.NEXT_PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  return NextResponse.redirect(
    buildConnectUrl({
      state,
      redirectUri: `${origin}/api/integrations/google/callback`,
      scopes: [GOOGLE_SCOPES.SHEETS, GOOGLE_SCOPES.DRIVE_FILE],
    }),
  );
}
