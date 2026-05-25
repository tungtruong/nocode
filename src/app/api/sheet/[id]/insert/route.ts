// POST /api/sheet/<appId>/insert { fields }
// Owner-only append. Public submissions go through /f/<appId>/submit (week 2).

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getAppDataSource, type SheetConfig } from "@/lib/integrations";
import { appendRow } from "@/lib/sheets";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  const { id: appId } = await ctx.params;
  const source = getAppDataSource<SheetConfig>(appId, "sheet");
  if (!source) return NextResponse.json({ error: "App này chưa nối với sheet" }, { status: 404 });
  if (source.user_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  let body: { fields?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 }); }
  if (!body.fields || typeof body.fields !== "object") {
    return NextResponse.json({ error: "Thiếu fields" }, { status: 400 });
  }

  try {
    const r = await appendRow(
      session.email,
      source.config.spreadsheetId,
      source.config.sheetName,
      body.fields as Record<string, string | number | boolean | null>,
      source.config.headerRow,
    );
    return NextResponse.json({ rowNumber: r.rowNumber });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "google_not_connected") {
      return NextResponse.json({ error: "Chưa nối Google Sheets", code: "NOT_CONNECTED" }, { status: 400 });
    }
    if (msg === "sheet_has_no_headers") {
      return NextResponse.json({ error: "Sheet chưa có header — thêm tên cột vào dòng 1" }, { status: 400 });
    }
    console.error("[sheet/insert] failed:", msg);
    return NextResponse.json({ error: "Ghi sheet thất bại" }, { status: 502 });
  }
}
