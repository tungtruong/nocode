import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, fetchFacebookUserInfo, facebookConfigured } from "@/lib/facebook-oauth";
import { createSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { attachReferral } from "@/lib/referrals";

const OAUTH_MARKER = "OAUTH";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = process.env.NEXT_PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  const fail = (reason: string) => NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);

  if (!facebookConfigured()) return fail("oauth_not_configured");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("oauth_invalid_params");

  const cookieStore = await cookies();
  const stateRaw = cookieStore.get("justvibe_oauth_fb")?.value;
  if (!stateRaw) return fail("oauth_state_missing");
  let saved: { s: string; ref?: string; r?: string };
  try { saved = JSON.parse(stateRaw); } catch { return fail("oauth_state_corrupt"); }
  if (saved.s !== state) return fail("oauth_state_mismatch");
  cookieStore.delete({ name: "justvibe_oauth_fb", path: "/api/auth/facebook" });

  try {
    const tokens = await exchangeCodeForToken(code, `${origin}/api/auth/facebook/callback`);
    const info = await fetchFacebookUserInfo(tokens.access_token);

    // Facebook may withhold email (phone-only signups). Without an email we
    // can't key the user — bail with a helpful error rather than synthesizing.
    if (!info.email) return fail("facebook_no_email");

    const email = info.email.toLowerCase();
    const name = info.name || email.split("@")[0];
    const db = getDb();

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
    console.error("[facebook oauth] callback failed:", e instanceof Error ? e.message : e);
    return fail("oauth_callback_error");
  }
}
