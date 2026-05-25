// POST /api/db/<appId>/<table>/add { row }
//
// End-user write — called by `window.jv.db.add` from inside a deployed app.
// Requires a per-app session cookie (Google OAuth → /api/auth/app/callback).
//
// The server tags every inserted row with the authenticated user's id and
// email so subsequent /list calls can filter with `where: { user_id: '@me' }`
// and so own-update / own-delete can verify ownership. Apps cannot forge
// `user_id` — any value the client sends is overwritten.

import { NextRequest, NextResponse } from "next/server";
import { insertRow, supabaseConfigured } from "@/lib/supabase";
import { ownerOfApp } from "@/lib/app-owner";
import { getAppSession } from "@/lib/app-auth";
import { checkRateLimit } from "@/lib/security";

const PRIVATE_TABLES = new Set(["submissions", "_jv_users"]);

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

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string; table: string }> },
) {
  const origin = req.headers.get("origin");
  if (!supabaseConfigured()) {
    return withCors(NextResponse.json({ error: "DB chưa cấu hình" }, { status: 500 }), origin);
  }
  const { appId, table } = await ctx.params;
  if (PRIVATE_TABLES.has(table)) {
    return withCors(NextResponse.json({ error: "Bảng dành riêng cho hệ thống" }, { status: 403 }), origin);
  }
  if (!(await ownerOfApp(appId))) {
    return withCors(NextResponse.json({ error: "Không tìm thấy app" }, { status: 404 }), origin);
  }

  const session = await getAppSession(appId);
  if (!session) {
    return withCors(NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 }), origin);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const rl = checkRateLimit(`jvdb-add:${ip}:${appId}`, 30, 60_000);
  if (!rl.allowed) {
    return withCors(NextResponse.json({ error: "Quá nhiều yêu cầu" }, { status: 429 }), origin);
  }

  let body: { row?: unknown };
  try { body = await req.json(); } catch {
    return withCors(NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 }), origin);
  }
  if (!body.row || typeof body.row !== "object" || Array.isArray(body.row)) {
    return withCors(NextResponse.json({ error: "Thiếu row" }, { status: 400 }), origin);
  }

  // Strip any client-supplied identity fields before tagging. Trust no client.
  const safe = { ...(body.row as Record<string, unknown>) };
  delete safe.user_id;
  delete safe.user_email;
  delete safe.uid;
  const tagged = {
    ...safe,
    user_id: session.uid,
    user_email: session.email,
  };

  try {
    const inserted = await insertRow(appId, table, tagged);
    return withCors(NextResponse.json({ id: inserted.id, created_at: inserted.created_at }), origin);
  } catch (e) {
    console.error("[db/add] failed:", e instanceof Error ? e.message : e);
    return withCors(NextResponse.json({ error: "Ghi DB thất bại" }, { status: 502 }), origin);
  }
}
