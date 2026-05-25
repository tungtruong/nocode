// GET /api/db/<appId>/tables → { tables: [{ name, count }] }
// Owner-only — lists every distinct table_name this app has written to.

import { NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { userOwnsApp } from "@/lib/app-owner";
import { getSupabase, supabaseConfigured } from "@/lib/supabase";

export async function GET(_req: Request, ctx: { params: Promise<{ appId: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "DB chưa cấu hình" }, { status: 500 });
  }

  const { appId } = await ctx.params;
  if (!(await userOwnsApp(appId, session.email))) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  // Supabase has no DISTINCT shortcut; pull table_name from up to 5k rows.
  // For any single app this is plenty — owner-managed tables don't sprawl.
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("app_rows")
      .select("table_name")
      .eq("app_id", appId)
      .limit(5000);
    if (error) throw new Error(error.message);
    const counts = new Map<string, number>();
    for (const r of data ?? []) {
      const name = (r as { table_name?: string }).table_name || "submissions";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const tables = Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ tables });
  } catch (e) {
    console.error("[db/tables] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Đọc danh sách bảng thất bại" }, { status: 502 });
  }
}
