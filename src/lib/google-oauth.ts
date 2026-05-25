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
export const GOOGLE_SCOPES = {
  // Login basics — what /api/auth/google requests today.
  LOGIN: "openid email profile",
  // Read + write spreadsheets the user grants us.
  SHEETS: "https://www.googleapis.com/auth/spreadsheets",
  // Files the app creates or opens (NOT full drive). Lets us list/open
  // sheets the user picks for an integration without scary "see all your
  // Drive files" permission grant.
  DRIVE_FILE: "https://www.googleapis.com/auth/drive.file",
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

// Connect-flow URL builder — used by /api/integrations/google/connect.
// Differences from login:
//   - access_type=offline → we get a refresh_token back (only on FIRST
//     consent unless prompt=consent forces re-issue; we force it).
//   - prompt=consent → guarantee refresh_token even on subsequent grants
//     (Google's quirk: re-grant without prompt=consent doesn't return one).
//   - include_granted_scopes=true → cumulative scopes across grants so
//     login + sheets work together without re-consenting login basics.
export function buildConnectUrl(opts: {
  state: string;
  redirectUri: string;
  scopes: string[]; // e.g. [SHEETS, DRIVE_FILE]
}): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scopes.join(" "),
    state: opts.state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${GOOGLE_AUTH}?${params}`;
}

// Refresh an access_token using the stored refresh_token. Returns the new
// access_token + expiry (seconds-from-now). Google doesn't always rotate the
// refresh_token; if a new one comes back, the caller should persist it.
export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
  refresh_token?: string; // rotated, optional
}> {
  const r = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`refresh ${r.status}: ${body.slice(0, 200)}`);
  }
  return (await r.json()) as { access_token: string; expires_in: number; refresh_token?: string };
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
