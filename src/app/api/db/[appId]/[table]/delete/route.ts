// POST /api/db/<appId>/<table>/delete { rowId }
// Owner-only single-row delete.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { userOwnsApp } from "@/lib/app-owner";
import { deleteRow, supabaseConfigured } from "@/lib/supabase";

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

  let body: { rowId?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }
  if (typeof body.rowId !== "string" || !body.rowId) {
    return NextResponse.json({ error: "Thiếu rowId" }, { status: 400 });
  }

  try {
    await deleteRow(appId, table, body.rowId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[db/delete] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Xoá DB thất bại" }, { status: 502 });
  }
}
