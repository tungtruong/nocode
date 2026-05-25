// POST /api/db/<appId>/<table>/own-update { rowId, fields }
// End-user updates ONE of their own rows. Refuses if the row's stored
// user_id doesn't match the session.

import { NextRequest, NextResponse } from "next/server";
import { getSupabase, supabaseConfigured, updateRow } from "@/lib/supabase";
import { ownerOfApp } from "@/lib/app-owner";
import { getAppSession } from "@/lib/app-auth";

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
    return withCors(NextResponse.json({ error: "Bảng dành riêng" }, { status: 403 }), origin);
  }
  if (!(await ownerOfApp(appId))) {
    return withCors(NextResponse.json({ error: "Không tìm thấy app" }, { status: 404 }), origin);
  }

  const session = await getAppSession(appId);
  if (!session) {
    return withCors(NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 }), origin);
  }

  let body: { rowId?: unknown; fields?: unknown };
  try { body = await req.json(); } catch {
    return withCors(NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 }), origin);
  }
  if (typeof body.rowId !== "string" || !body.rowId) {
    return withCors(NextResponse.json({ error: "Thiếu rowId" }, { status: 400 }), origin);
  }
  if (!body.fields || typeof body.fields !== "object" || Array.isArray(body.fields)) {
    return withCors(NextResponse.json({ error: "Thiếu fields" }, { status: 400 }), origin);
  }

  // Verify ownership BEFORE updating — owners shouldn't be tricked into editing
  // other users' rows even if the appId is somehow leaked.
  try {
    const sb = getSupabase();
    const { data: existing, error } = await sb
      .from("app_rows")
      .select("row_data")
      .eq("id", body.rowId)
      .eq("app_id", appId)
      .eq("table_name", table)
      .single();
    if (error || !existing) {
      return withCors(NextResponse.json({ error: "Row không tồn tại" }, { status: 404 }), origin);
    }
    const ownerUid = (existing.row_data as Record<string, unknown>)?.user_id;
    if (ownerUid !== session.uid) {
      return withCors(NextResponse.json({ error: "Không phải row của bạn" }, { status: 403 }), origin);
    }

    // Strip identity fields from the fields update — can't change ownership.
    const safe = { ...(body.fields as Record<string, unknown>) };
    delete safe.user_id;
    delete safe.user_email;
    delete safe.uid;

    const updated = await updateRow(appId, table, body.rowId, safe);
    return withCors(NextResponse.json({ ok: true, updated_at: updated.updated_at }), origin);
  } catch (e) {
    console.error("[db/own-update] failed:", e instanceof Error ? e.message : e);
    return withCors(NextResponse.json({ error: "Cập nhật thất bại" }, { status: 502 }), origin);
  }
}
