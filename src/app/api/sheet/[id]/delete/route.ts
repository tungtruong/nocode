// POST /api/sheet/<appId>/delete { rowNumber }
// Owner-only delete of a single row by position.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getAppDataSource, type SheetConfig } from "@/lib/integrations";
import { deleteRow } from "@/lib/sheets";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  const { id: appId } = await ctx.params;
  const source = getAppDataSource<SheetConfig>(appId, "sheet");
  if (!source) return NextResponse.json({ error: "App này chưa nối với sheet" }, { status: 404 });
  if (source.user_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  let body: { rowNumber?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 }); }
  if (typeof body.rowNumber !== "number" || body.rowNumber < 2) {
    return NextResponse.json({ error: "rowNumber không hợp lệ (>=2)" }, { status: 400 });
  }

  try {
    await deleteRow(
      session.email,
      source.config.spreadsheetId,
      source.config.sheetName,
      body.rowNumber,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "google_not_connected") {
      return NextResponse.json({ error: "Chưa nối Google Sheets", code: "NOT_CONNECTED" }, { status: 400 });
    }
    console.error("[sheet/delete] failed:", msg);
    return NextResponse.json({ error: "Xoá row thất bại" }, { status: 502 });
  }
}
