// Thin wrapper around Zalo Login OAuth 2.0 (v4 API).
// Docs: https://developers.zalo.me/docs/api/social-api/tai-lieu/oauth
//
// Zalo quirks:
//   - Does NOT return an email by default. Most VN users sign up via phone,
//     and the email field requires a separate permission that Zalo only
//     grants after business verification. The callback synthesizes a
//     placeholder email of the form `zalo+<id>@zalo.local` so our existing
//     email-keyed user/session schema doesn't need to change.
//   - Auth header for app uses `secret_key`, not `Authorization: Bearer`.
//   - Auth URL parameters differ from Google/Facebook (no `scope`, uses
//     `app_id` instead of `client_id`).

const ZALO_AUTH = "https://oauth.zaloapp.com/v4/permission";
const ZALO_TOKEN = "https://oauth.zaloapp.com/v4/access_token";
const ZALO_USERINFO = "https://graph.zalo.me/v2.0/me";

export function zaloConfigured(): boolean {
  return !!(process.env.ZALO_APP_ID && process.env.ZALO_APP_SECRET);
}

export function buildAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    app_id: process.env.ZALO_APP_ID!,
    redirect_uri: redirectUri,
    state,
  });
  return `${ZALO_AUTH}?${params}`;
}

export interface ZaloUser {
  id: string;       // numeric Zalo user id
  name: string;
  picture?: { data: { url: string } };
}

// Synthetic email for a Zalo account. Marks accounts that have no real email
// so we can later show "set your email" UI without misidentifying them.
export function syntheticEmail(zaloId: string): string {
  return `zalo+${zaloId}@zalo.local`;
}

export async function exchangeCodeForToken(code: string): Promise<{ access_token: string; refresh_token?: string }> {
  // Zalo v4 token endpoint uses form-urlencoded body + `secret_key` header.
  const r = await fetch(ZALO_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      secret_key: process.env.ZALO_APP_SECRET!,
    },
    body: new URLSearchParams({
      code,
      app_id: process.env.ZALO_APP_ID!,
      grant_type: "authorization_code",
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`zalo token exchange ${r.status}: ${text.slice(0, 200)}`);
  // Zalo returns errors with HTTP 200 + an `error` field — check both.
  let body: { access_token?: string; refresh_token?: string; error?: number; message?: string };
  try { body = JSON.parse(text); } catch { throw new Error(`zalo token bad json: ${text.slice(0, 200)}`); }
  if (!body.access_token) throw new Error(`zalo token missing: ${body.message || text.slice(0, 200)}`);
  return { access_token: body.access_token, refresh_token: body.refresh_token };
}

export async function fetchZaloUserInfo(accessToken: string): Promise<ZaloUser> {
  const fields = "id,name,picture";
  const r = await fetch(`${ZALO_USERINFO}?fields=${fields}`, {
    headers: { access_token: accessToken },
  });
  if (!r.ok) throw new Error(`zalo userinfo ${r.status}`);
  return (await r.json()) as ZaloUser;
}
