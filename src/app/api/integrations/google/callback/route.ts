// GET /api/integrations/google/callback
//
// Handles the Connect-flow return from Google. Verifies state, exchanges
// code → tokens, stores them encrypted in user_integrations. Redirects to
// the original returnTo path.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, fetchGoogleUserInfo, googleConfigured } from "@/lib/google-oauth";
import { saveIntegration } from "@/lib/integrations";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = process.env.NEXT_PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/dashboard/integrations?error=${encodeURIComponent(reason)}`);

  if (!googleConfigured()) return fail("oauth_not_configured");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("oauth_invalid_params");

  const cookieStore = await cookies();
  const stateRaw = cookieStore.get("justvibe_integration_oauth")?.value;
  if (!stateRaw) return fail("oauth_state_missing");
  let saved: { s: string; e: string; r: string };
  try { saved = JSON.parse(stateRaw); } catch { return fail("oauth_state_corrupt"); }
  if (saved.s !== state) return fail("oauth_state_mismatch");
  cookieStore.delete({ name: "justvibe_integration_oauth", path: "/api/integrations/google" });

  try {
    const tokens = await exchangeCodeForToken(code, `${origin}/api/integrations/google/callback`);

    if (!tokens.refresh_token) {
      // Google only returns a refresh_token on the FIRST consent (or with
      // prompt=consent). We force prompt=consent in buildConnectUrl, so if
      // we still don't get one, something's misconfigured.
      return fail("no_refresh_token");
    }

    // Get the Google account email — different account from the JustVibe
    // login email is fine; we just store it for display.
    let accountEmail: string | null = null;
    try {
      const info = await fetchGoogleUserInfo(tokens.access_token);
      accountEmail = info.email.toLowerCase();
    } catch {
      // Non-fatal — we have the tokens, just no display email.
    }

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    // Same Google grant covers both Sheets + Drive in our case — store under
    // the canonical "google_sheets" key; the scope field records what we
    // actually got so callers can check.
    saveIntegration({
      user_email: saved.e,
      provider: "google_sheets",
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expires_at: expiresAt,
      scope: tokens.scope || "",
      account_email: accountEmail,
    });

    return NextResponse.redirect(`${origin}${saved.r}?connected=google`);
  } catch (e) {
    console.error("[integrations google callback] failed:", e instanceof Error ? e.message : e);
    return fail("oauth_callback_error");
  }
}
