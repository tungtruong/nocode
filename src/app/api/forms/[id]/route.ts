// GET /api/forms/<appId>
//
// Owner-only — returns submissions for the dashboard table view.
// Reads from the bound Sheet if present, else from the JV fallback table.

import { NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getAppDataSource, type SheetConfig } from "@/lib/integrations";
import { selectAll } from "@/lib/sheets";
import { getDb } from "@/lib/db";
import { getApp } from "@/lib/store";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  const { id: appId } = await ctx.params;

  // Ownership: deployed app (apps table) OR draft project (projects).
  const app = await getApp(appId);
  const projectOwner = getDb()
    .prepare("SELECT user_email FROM projects WHERE id = ?")
    .get(appId) as { user_email: string } | undefined;
  const owner = app?.user_email ?? projectOwner?.user_email;
  if (!owner) return NextResponse.json({ error: "App không tồn tại" }, { status: 404 });
  if (owner.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const source = getAppDataSource<SheetConfig>(appId, "sheet");

  if (source) {
    try {
      const rows = await selectAll(
        session.email,
        source.config.spreadsheetId,
        source.config.sheetName,
        { headerRow: source.config.headerRow, limit: 500 },
      );
      return NextResponse.json({
        source: "sheet",
        sheet: {
          spreadsheetId: source.config.spreadsheetId,
          sheetName: source.config.sheetName,
          url: `https://docs.google.com/spreadsheets/d/${source.config.spreadsheetId}`,
        },
        rows,
      });
    } catch (e) {
      console.error("[forms/get] sheet read failed:", e instanceof Error ? e.message : e);
      // Fall through — show fallback rows even if sheet errored.
    }
  }

  // Fallback rows (JV-stored). Each payload is JSON; flatten to {fields}.
  const fallback = getDb()
    .prepare(
      `SELECT id, payload_json, ip, created_at FROM form_submissions
       WHERE app_id = ? ORDER BY created_at DESC LIMIT 500`,
    )
    .all(appId) as Array<{ id: number; payload_json: string; ip: string | null; created_at: string }>;

  const rows = fallback.map((r) => {
    let fields: Record<string, string> = {};
    try { fields = JSON.parse(r.payload_json); } catch { /* empty */ }
    return {
      rowNumber: r.id,
      fields: { ...fields, _ip: r.ip || "", _created_at: r.created_at },
    };
  });

  return NextResponse.json({
    source: source ? "sheet_unreachable" : "fallback",
    fallbackCount: rows.length,
    rows,
  });
}
