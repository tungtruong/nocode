// Thin wrapper around Google's OAuth 2.0 endpoints. We use the OpenID Connect
// "code" flow: redirect user → Google consent screen → callback with `code` →
// exchange code for tokens → fetch user info.
//
// Why not next-auth: our session is already JWT-in-cookie via jose+SQLite.
// Adding next-auth would require migrating cookie name/format and adopting
// its handler conventions. ~120 lines here gets the same outcome.

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";

// Scope strings exported so callers can compose them without typos.
// Only LOGIN is used now — Sheets/Drive scopes were removed when we
// migrated user data storage from Google Sheets to Supabase.
export const GOOGLE_SCOPES = {
  LOGIN: "openid email profile",
} as const;

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// Build the login OAuth URL. Defaults preserved for backward compat —
// callers wanting offline / extra scope should use buildConnectUrl().
export function buildAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.LOGIN,
    state,
    access_type: "online",
    // Always prompt the chooser so users can pick a different Google account
    // (better UX than auto-selecting the most recently used).
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH}?${params}`;
}

export interface GoogleUser {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  picture?: string;
}

// refresh_token + expires_in are present only when the original auth URL
// used access_type=offline (the Connect flow). Login flow won't set them.
export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<{
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}> {
  const r = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`token exchange ${r.status}: ${body.slice(0, 200)}`);
  }
  return (await r.json()) as {
    access_token: string;
    id_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUser> {
  const r = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`userinfo ${r.status}`);
  return (await r.json()) as GoogleUser;
}
