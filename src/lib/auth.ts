import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || (() => { throw new Error("AUTH_SECRET not configured"); })());
const COOKIE_NAME = "nocode_session";

export interface Session {
  email: string;
  name: string;
}

export async function createSession(email: string, name: string): Promise<string> {
  const token = await new SignJWT({ email, name } as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SECRET);

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });

  return token;
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

export async function destroySession() {
  (await cookies()).delete(COOKIE_NAME);
}

// Simple mock credentials (replace with real auth later)
const USERS: Record<string, { password: string; name: string }> = {
  "demo@nocode.dev": { password: "demo123", name: "Demo User" },
  "admin@nocode.dev": { password: "admin123", name: "Admin" },
};

export function validateCredentials(email: string, password: string): { name: string } | null {
  const user = USERS[email.toLowerCase()];
  if (!user || user.password !== password) return null;
  return { name: user.name };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

export function authError() {
  return new Response(JSON.stringify({ error: "Vui lòng đăng nhập" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
