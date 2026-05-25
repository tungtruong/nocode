// POST /api/sheet/create { title, headers? }
// Create a new spreadsheet in the user's Drive. Returns id+name+URL for the
// /dashboard/integrations UI to bind to an app immediately.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { createSpreadsheet } from "@/lib/sheets";

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  let body: { title?: unknown; headers?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 }); }
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "Thiếu title" }, { status: 400 });
  }
  const headers = Array.isArray(body.headers) ? body.headers.filter((h) => typeof h === "string") : undefined;

  try {
    const r = await createSpreadsheet(session.email, { title: body.title.trim(), headers });
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "google_not_connected") {
      return NextResponse.json({ error: "Chưa nối Google Sheets", code: "NOT_CONNECTED" }, { status: 400 });
    }
    console.error("[sheet/create] failed:", msg);
    return NextResponse.json({ error: "Tạo sheet thất bại" }, { status: 502 });
  }
}
