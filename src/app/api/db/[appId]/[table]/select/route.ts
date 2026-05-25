// POST /api/db/<appId>/<table>/select { limit?, where? }
// Owner-only read from the shared Supabase app_rows table.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { userOwnsApp } from "@/lib/app-owner";
import { selectRows, supabaseConfigured } from "@/lib/supabase";

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

  let body: { limit?: unknown; where?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(body.limit, 1000) : 100;
  const where = body.where && typeof body.where === "object"
    ? (body.where as Record<string, string | number | boolean | null>)
    : undefined;

  try {
    const rows = await selectRows(appId, table, { limit, where });
    return NextResponse.json({ rows });
  } catch (e) {
    console.error("[db/select] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Đọc DB thất bại" }, { status: 502 });
  }
}
