// POST /api/auth/app/signout?app=<appId> → clears the per-app session cookie.

import { NextRequest, NextResponse } from "next/server";
import { destroyAppSession } from "@/lib/app-auth";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Credentials": "true",
};

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

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const appId = url.searchParams.get("app") || "";
  await destroyAppSession(appId);
  return withCors(NextResponse.json({ ok: true }), req.headers.get("origin"));
}
