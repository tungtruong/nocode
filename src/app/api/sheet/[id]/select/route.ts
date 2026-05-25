// POST /api/sheet/<appId>/select { limit? }
// Owner-only read of the sheet bound to the given app. Returns rows mapped
// by header column.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getAppDataSource, type SheetConfig } from "@/lib/integrations";
import { selectAll } from "@/lib/sheets";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  const { id: appId } = await ctx.params;
  const source = getAppDataSource<SheetConfig>(appId, "sheet");
  if (!source) return NextResponse.json({ error: "App này chưa nối với sheet" }, { status: 404 });
  if (source.user_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  let body: { limit?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(body.limit, 1000) : 100;

  try {
    const rows = await selectAll(session.email, source.config.spreadsheetId, source.config.sheetName, {
      headerRow: source.config.headerRow,
      limit,
    });
    return NextResponse.json({ rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "google_not_connected") {
      return NextResponse.json({ error: "Chưa nối Google Sheets", code: "NOT_CONNECTED" }, { status: 400 });
    }
    console.error("[sheet/select] failed:", msg);
    return NextResponse.json({ error: "Đọc sheet thất bại" }, { status: 502 });
  }
}
