// POST /api/db/<appId>/<table>/update { rowId, fields }
// Owner-only sparse merge update.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { userOwnsApp } from "@/lib/app-owner";
import { updateRow, supabaseConfigured } from "@/lib/supabase";

export async function POST(req: NextRequest, ctx: { params: Promise<{ appId: string; table: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "DB chưa cấu hình" }, { status: 500 });
  }

  const { appId, table } = await ctx.params;
  if (!(await userOwnsApp(appId, session.email))) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  let body: { rowId?: unknown; fields?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }
  if (typeof body.rowId !== "string" || !body.rowId) {
    return NextResponse.json({ error: "Thiếu rowId" }, { status: 400 });
  }
  if (!body.fields || typeof body.fields !== "object") {
    return NextResponse.json({ error: "Thiếu fields" }, { status: 400 });
  }

  try {
    const updated = await updateRow(appId, table, body.rowId, body.fields as Record<string, unknown>);
    return NextResponse.json({ ok: true, updated_at: updated.updated_at });
  } catch (e) {
    console.error("[db/update] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Cập nhật DB thất bại" }, { status: 502 });
  }
}
