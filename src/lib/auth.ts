import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || (() => { throw new Error("AUTH_SECRET not configured"); })());
// Session cookie name. Renaming from `nocode_session` invalidates every active
// session — that's intentional during the JustVibe rebrand (one-time logout).
const COOKIE_NAME = "justvibe_session";

export interface Session {
  email: string;
  name: string;
}

// Session lifetime. Short enough to limit blast radius if a token leaks; renew
// by signing in again. (No silent refresh implemented yet.)
const SESSION_TTL_SECONDS = 60 * 60; // 1 hour

export async function createSession(email: string, name: string): Promise<string> {
  const token = await new SignJWT({ email, name } as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(SECRET);

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    // Always require HTTPS. For local dev over HTTP, set DEV_INSECURE_COOKIE=true.
    secure: process.env.DEV_INSECURE_COOKIE !== "true",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
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

// ===== Credentials =====

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Mock users for dev only. In production, gate behind ALLOW_MOCK_AUTH=true.
const MOCK_USERS: Record<string, { password: string; name: string }> = {
  "demo@justvibe.me": { password: "demo123", name: "Demo User" },
  "admin@justvibe.me": { password: "admin123", name: "Admin" },
};

function mockAuthAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ALLOW_MOCK_AUTH === "true";
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export function validateCredentials(email: string, password: string): { name: string } | null {
  const e = normalizeEmail(email);

  // 1. Real users from SQLite first.
  const row = getDb()
    .prepare("SELECT name, password_hash FROM users WHERE email = ?")
    .get(e) as { name: string; password_hash: string } | undefined;
  if (row) {
    // Accounts created via Google OAuth have a sentinel hash and no password
    // — they must sign in through the OAuth flow, not the password form.
    if (row.password_hash === "OAUTH") return null;
    if (bcrypt.compareSync(password, row.password_hash)) return { name: row.name };
    return null;
  }

  // 2. Fall back to mock users (dev or explicitly enabled).
  if (!mockAuthAllowed()) return null;
  const mock = MOCK_USERS[e];
  if (!mock) return null;
  if (!constantTimeEqual(password, mock.password)) return null;
  return { name: mock.name };
}

export interface SignupResult {
  ok: boolean;
  error?: string;
  name?: string;
}

export function createUser(email: string, password: string, name: string): SignupResult {
  const e = normalizeEmail(email);
  if (!EMAIL_RE.test(e)) return { ok: false, error: "Email không hợp lệ" };
  if (typeof password !== "string" || password.length < 8) return { ok: false, error: "Mật khẩu cần ≥ 8 ký tự" };
  if (typeof name !== "string" || name.trim().length === 0) return { ok: false, error: "Cần tên hiển thị" };
  if (name.length > 80) return { ok: false, error: "Tên quá dài" };

  const db = getDb();
  const existing = db.prepare("SELECT email FROM users WHERE email = ?").get(e);
  if (existing) return { ok: false, error: "Email đã được sử dụng" };

  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)").run(e, name.trim(), hash);
  return { ok: true, name: name.trim() };
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
