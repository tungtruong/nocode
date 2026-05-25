// Per-app end-user session. Distinct from the JV-builder session in auth.ts:
// these cookies authenticate visitors of deployed apps — the people who
// will actually USE the apps the builder makes. Each generated app has its
// own user namespace; signing into journal.justvibe.me does NOT sign you
// into menu.justvibe.me.
//
// Cookie scheme:
//   name   = `__jv_au_${appId}` so one browser can be signed into multiple apps
//   domain = `.justvibe.me` so subdomain deploys see the cookie too
//   value  = jose JWT signed with AUTH_SECRET, payload `{ uid, email, name, picture, appId }`
//
// Identity is provisioned via Google OAuth (no password / magic link yet).
// User rows live in Supabase as table_name='_jv_users' (excluded from public
// jv.db.list by PRIVATE_TABLES).

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || (() => { throw new Error("AUTH_SECRET not configured"); })(),
);

const APP_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const ID_RE = /^[a-zA-Z0-9_-]+$/;

export interface AppUser {
  uid: string;        // stable user id — uses Google's `sub`
  email: string;
  name: string;
  picture?: string;
  appId: string;
}

export function appCookieName(appId: string): string {
  if (!ID_RE.test(appId)) throw new Error("invalid appId");
  return `__jv_au_${appId}`;
}

/** Domain attribute so deployed apps under <slug>.justvibe.me see the cookie. */
function cookieDomain(): string | undefined {
  // Localhost / dev: skip the domain attribute (browsers won't accept it).
  if (process.env.DEV_INSECURE_COOKIE === "true") return undefined;
  return ".justvibe.me";
}

export async function createAppSession(user: AppUser): Promise<string> {
  const token = await new SignJWT({ ...user } as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${APP_SESSION_TTL_SECONDS}s`)
    .sign(SECRET);

  (await cookies()).set(appCookieName(user.appId), token, {
    httpOnly: true,
    secure: process.env.DEV_INSECURE_COOKIE !== "true",
    sameSite: "lax",
    maxAge: APP_SESSION_TTL_SECONDS,
    path: "/",
    domain: cookieDomain(),
  });

  return token;
}

export async function getAppSession(appId: string): Promise<AppUser | null> {
  if (!ID_RE.test(appId)) return null;
  const token = (await cookies()).get(appCookieName(appId))?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const u = payload as unknown as AppUser;
    if (u.appId !== appId) return null;
    return u;
  } catch {
    return null;
  }
}

export async function destroyAppSession(appId: string): Promise<void> {
  if (!ID_RE.test(appId)) return;
  (await cookies()).delete({
    name: appCookieName(appId),
    path: "/",
    domain: cookieDomain(),
  });
}
