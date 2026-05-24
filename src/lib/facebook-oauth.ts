// Thin wrapper around Facebook Login OAuth 2.0. Same shape as
// google-oauth.ts — code flow → token exchange → userinfo fetch.
//
// Facebook quirks:
//   - The `email` field requires the user to grant the `email` scope AND have
//     a verified email on their FB profile. Some accounts (phone-only signup)
//     won't expose it; callback handles the missing-email case.
//   - Graph API versions: v18.0 is current at write time; bump together.

const FB_AUTH = "https://www.facebook.com/v18.0/dialog/oauth";
const FB_TOKEN = "https://graph.facebook.com/v18.0/oauth/access_token";
const FB_USERINFO = "https://graph.facebook.com/me";

export function facebookConfigured(): boolean {
  return !!(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET);
}

export function buildAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "email,public_profile",
    state,
    // Force chooser so users on multiple FB accounts can pick.
    auth_type: "rerequest",
  });
  return `${FB_AUTH}?${params}`;
}

export interface FacebookUser {
  id: string;
  email?: string;       // may be missing — see file header
  name: string;
  picture?: { data: { url: string } };
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<{ access_token: string }> {
  const params = new URLSearchParams({
    code,
    client_id: process.env.FACEBOOK_CLIENT_ID!,
    client_secret: process.env.FACEBOOK_CLIENT_SECRET!,
    redirect_uri: redirectUri,
  });
  // FB accepts GET for token exchange (unlike Google which insists on POST).
  const r = await fetch(`${FB_TOKEN}?${params}`);
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`facebook token exchange ${r.status}: ${body.slice(0, 200)}`);
  }
  return (await r.json()) as { access_token: string };
}

export async function fetchFacebookUserInfo(accessToken: string): Promise<FacebookUser> {
  const fields = "id,name,email,picture";
  const r = await fetch(`${FB_USERINFO}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`);
  if (!r.ok) throw new Error(`facebook userinfo ${r.status}`);
  return (await r.json()) as FacebookUser;
}
