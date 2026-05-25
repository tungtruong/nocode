// GET /api/sheet/list → spreadsheets the user has granted us access to.
// Used by /dashboard/integrations to render a picker.

import { NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { listSpreadsheets } from "@/lib/sheets";

export async function GET() {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  try {
    const sheets = await listSpreadsheets(session.email);
    return NextResponse.json({ sheets });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "google_not_connected") {
      return NextResponse.json({ error: "Chưa nối Google Sheets", code: "NOT_CONNECTED" }, { status: 400 });
    }
    console.error("[sheet/list] failed:", msg);
    return NextResponse.json({ error: "Không tải được danh sách sheet" }, { status: 502 });
  }
}
