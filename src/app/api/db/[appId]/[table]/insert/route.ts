// POST /api/db/<appId>/<table>/insert { row }
// Owner-only insert. Public form submissions go through /f/<appId>/submit
// (which uses the same Supabase storage but no auth — different rate limit).

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { userOwnsApp } from "@/lib/app-owner";
import { insertRow, supabaseConfigured } from "@/lib/supabase";

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

  let body: { row?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }
  if (!body.row || typeof body.row !== "object") {
    return NextResponse.json({ error: "Thiếu row object" }, { status: 400 });
  }

  try {
    const inserted = await insertRow(appId, table, body.row as Record<string, unknown>);
    return NextResponse.json({ id: inserted.id, created_at: inserted.created_at });
  } catch (e) {
    console.error("[db/insert] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Ghi DB thất bại" }, { status: 502 });
  }
}
