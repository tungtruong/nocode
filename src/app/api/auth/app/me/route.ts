// GET /api/auth/app/me?app=<appId> → { user } | { user: null }
// Called by `window.jv.auth.user()` to fetch the current end-user.
// Public (no JV-builder auth), CORS open so subdomain apps can call.

import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/app-auth";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Credentials": "true",
};
// NOTE: ACAO can't be "*" when credentials: true on a real client; the runtime
// uses credentials: 'include' so we mirror the Origin header at request time.

function withCors(res: NextResponse, origin: string | null): NextResponse {
  const o = origin && /^https:\/\/([a-zA-Z0-9-]+\.)?justvibe\.me$/.test(origin) ? origin : "*";
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  res.headers.set("Access-Control-Allow-Origin", o);
  res.headers.set("Vary", "Origin");
  return res;
}

export async function OPTIONS(req: NextRequest) {
  return withCors(new NextResponse(null, { status: 204 }), req.headers.get("origin"));
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const appId = url.searchParams.get("app") || "";
  const user = await getAppSession(appId);
  // Strip the appId field from the response — runtime callers already know it.
  if (user) {
    const { appId: _omit, ...publicUser } = user;
    void _omit;
    return withCors(NextResponse.json({ user: publicUser }), req.headers.get("origin"));
  }
  return withCors(NextResponse.json({ user: null }), req.headers.get("origin"));
}
