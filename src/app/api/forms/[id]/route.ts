// GET /api/forms/<appId>
//
// Owner-only — returns submissions for the dashboard table view.
// Reads from Supabase (primary), falls back to JV's local SQLite when
// Supabase rows are absent (e.g. submission landed during a Supabase
// outage and is in form_submissions instead).

import { NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { userOwnsApp } from "@/lib/app-owner";
import { selectRows, supabaseConfigured } from "@/lib/supabase";
import { getDb } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  const { id: appId } = await ctx.params;
  if (!(await userOwnsApp(appId, session.email))) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  let supabaseRows: Array<{ rowNumber: number | string; fields: Record<string, string> }> = [];
  let supabaseErr = false;
  if (supabaseConfigured()) {
    try {
      const rows = await selectRows(appId, "submissions", { limit: 500 });
      supabaseRows = rows.map((r) => ({
        rowNumber: r.id,
        fields: { ...(r.row_data as Record<string, string>), _created_at: r.created_at },
      }));
    } catch (e) {
      console.error("[forms/get] supabase failed:", e instanceof Error ? e.message : e);
      supabaseErr = true;
    }
  }

  const fallback = getDb()
    .prepare(
      `SELECT id, payload_json, ip, created_at FROM form_submissions
       WHERE app_id = ? ORDER BY created_at DESC LIMIT 500`,
    )
    .all(appId) as Array<{ id: number; payload_json: string; ip: string | null; created_at: string }>;
  const fallbackRows = fallback.map((r) => {
    let fields: Record<string, string> = {};
    try { fields = JSON.parse(r.payload_json); } catch { /* empty */ }
    return {
      rowNumber: r.id,
      fields: { ...fields, _ip: r.ip || "", _created_at: r.created_at },
    };
  });

  return NextResponse.json({
    source: supabaseErr ? "supabase_unreachable" : supabaseConfigured() ? "supabase" : "fallback",
    fallbackCount: fallbackRows.length,
    rows: [...supabaseRows, ...fallbackRows],
  });
}
