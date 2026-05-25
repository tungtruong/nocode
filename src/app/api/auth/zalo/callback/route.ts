import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, fetchZaloUserInfo, zaloConfigured, syntheticEmail } from "@/lib/zalo-oauth";
import { createSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { attachReferral } from "@/lib/referrals";

const OAUTH_MARKER = "OAUTH";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = process.env.NEXT_PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  const fail = (reason: string) => NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);

  if (!zaloConfigured()) return fail("oauth_not_configured");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("oauth_invalid_params");

  const cookieStore = await cookies();
  const stateRaw = cookieStore.get("justvibe_oauth_zalo")?.value;
  if (!stateRaw) return fail("oauth_state_missing");
  let saved: { s: string; ref?: string; r?: string };
  try { saved = JSON.parse(stateRaw); } catch { return fail("oauth_state_corrupt"); }
  if (saved.s !== state) return fail("oauth_state_mismatch");
  cookieStore.delete({ name: "justvibe_oauth_zalo", path: "/api/auth/zalo" });

  try {
    const tokens = await exchangeCodeForToken(code);
    const info = await fetchZaloUserInfo(tokens.access_token);

    if (!info.id) return fail("zalo_no_id");

    // Zalo doesn't give us emails. Use a synthetic email keyed off the Zalo
    // user id so the rest of the schema (users.email PRIMARY KEY) works as-is.
    // Later we can add a "set your email" UI for Zalo accounts to enable
    // recovery + cross-provider linking.
    const email = syntheticEmail(info.id);
    const name = info.name || `Zalo user ${info.id.slice(0, 6)}`;
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
    console.error("[zalo oauth] callback failed:", e instanceof Error ? e.message : e);
    return fail("oauth_callback_error");
  }
}
