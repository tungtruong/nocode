import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, fetchGoogleUserInfo, googleConfigured } from "@/lib/google-oauth";
import { createSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { attachReferral } from "@/lib/referrals";

// Marker stored in users.password_hash for accounts created via OAuth.
// validateCredentials checks this so an OAuth-only account can't be
// password-logged-into (no hash to match).
const OAUTH_MARKER = "OAUTH";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = process.env.NEXT_PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  const fail = (reason: string) => NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);

  if (!googleConfigured()) return fail("oauth_not_configured");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("oauth_invalid_params");

  // Verify the state cookie matches what came back from Google. Without this
  // anyone could craft a callback URL and log a victim into the attacker's
  // Google account (CSRF on OAuth).
  const cookieStore = await cookies();
  const stateRaw = cookieStore.get("nocode_oauth")?.value;
  if (!stateRaw) return fail("oauth_state_missing");
  let saved: { s: string; ref?: string; r?: string };
  try { saved = JSON.parse(stateRaw); } catch { return fail("oauth_state_corrupt"); }
  if (saved.s !== state) return fail("oauth_state_mismatch");
  // One-shot: clear the cookie now so a stolen URL can't be replayed.
  cookieStore.delete({ name: "nocode_oauth", path: "/api/auth/google" });

  try {
    const tokens = await exchangeCodeForToken(code, `${origin}/api/auth/google/callback`);
    const info = await fetchGoogleUserInfo(tokens.access_token);

    if (!info.verified_email) return fail("email_not_verified");

    const email = info.email.toLowerCase();
    const name = info.name || email.split("@")[0];
    const db = getDb();

    // Upsert: insert on first sign-in, no-op on returning users (we don't
    // overwrite their saved display name in case they edited it later).
    const existing = db.prepare("SELECT email FROM users WHERE email = ?").get(email);
    if (!existing) {
      db.prepare(
        "INSERT INTO users (email, name, password_hash, tier) VALUES (?, ?, ?, 'free')"
      ).run(email, name, OAUTH_MARKER);
      if (saved.ref) attachReferral(email, saved.ref);
    }

    await createSession(email, name);
    return NextResponse.redirect(`${origin}${saved.r || "/builder"}`);
  } catch (e) {
    console.error("[google oauth] callback failed:", e instanceof Error ? e.message : e);
    return fail("oauth_callback_error");
  }
}
