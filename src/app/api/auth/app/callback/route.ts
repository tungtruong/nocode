// GET /api/auth/app/callback — finishes Google OAuth for end-user app sessions.
// Mirrors src/app/api/auth/google/callback/route.ts but the session it mints is
// a per-app cookie (see src/lib/app-auth.ts), and the user gets stored in the
// Supabase _jv_users namespace instead of the builder users table.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, fetchGoogleUserInfo, googleConfigured } from "@/lib/google-oauth";
import { createAppSession } from "@/lib/app-auth";
import { selectRows, insertRow, updateRow, supabaseConfigured } from "@/lib/supabase";

const USERS_TABLE = "_jv_users";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = process.env.NEXT_PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  const fail = (reason: string, redirect = `${origin}/`) =>
    NextResponse.redirect(`${redirect}${redirect.includes("?") ? "&" : "?"}auth_error=${encodeURIComponent(reason)}`);

  if (!googleConfigured()) return fail("oauth_not_configured");
  if (!supabaseConfigured()) return fail("db_not_configured");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("oauth_invalid_params");

  const cookieStore = await cookies();
  const stateRaw = cookieStore.get("justvibe_app_oauth")?.value;
  if (!stateRaw) return fail("oauth_state_missing");
  let saved: { s: string; app: string; r: string };
  try { saved = JSON.parse(stateRaw); } catch { return fail("oauth_state_corrupt"); }
  if (saved.s !== state) return fail("oauth_state_mismatch");
  cookieStore.delete({ name: "justvibe_app_oauth", path: "/api/auth/app" });

  try {
    const tokens = await exchangeCodeForToken(code, `${origin}/api/auth/app/callback`);
    const info = await fetchGoogleUserInfo(tokens.access_token);
    if (!info.verified_email) return fail("email_not_verified", saved.r);

    const email = info.email.toLowerCase();
    const uid = info.id; // Google sub — stable for the lifetime of the account.

    // Upsert into the per-app _jv_users namespace. If the user already exists
    // for this app, refresh their display name + picture in case Google's
    // profile changed (handles users updating their Google avatar).
    const existing = await selectRows(saved.app, USERS_TABLE, { where: { uid }, limit: 1 });
    if (existing.length === 0) {
      await insertRow(saved.app, USERS_TABLE, {
        uid,
        email,
        name: info.name || email.split("@")[0],
        picture: info.picture || null,
        joined_at: new Date().toISOString(),
      });
    } else {
      await updateRow(saved.app, USERS_TABLE, existing[0].id, {
        email,
        name: info.name || email.split("@")[0],
        picture: info.picture || null,
        last_seen_at: new Date().toISOString(),
      });
    }

    await createAppSession({
      uid,
      email,
      name: info.name || email.split("@")[0],
      picture: info.picture,
      appId: saved.app,
    });

    return NextResponse.redirect(saved.r);
  } catch (e) {
    console.error("[app oauth] callback failed:", e instanceof Error ? e.message : e);
    return fail("oauth_callback_error", saved.r);
  }
}
