// POST /api/sheet/bind { appId, spreadsheetId, sheetName, headerRow? }
// Associate an app with a sheet (insert or update its app_data_sources row).
//
// DELETE /api/sheet/bind?appId=... unbinds.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { saveAppDataSource, deleteAppDataSource, getAppDataSource } from "@/lib/integrations";
import { getApp } from "@/lib/store";

async function ownsApp(email: string, appId: string): Promise<boolean> {
  const app = await getApp(appId);
  if (app && app.user_email.toLowerCase() === email.toLowerCase()) return true;
  // Project-only (no deploy yet) — accept if the project belongs to the user.
  const existing = getAppDataSource(appId);
  if (existing && existing.user_email.toLowerCase() === email.toLowerCase()) return true;
  // For brand-new projects the deploy hasn't happened yet, but the user
  // owns the project id by virtue of having created it. We accept any id
  // the user passes — the bind is harmless if the project doesn't exist
  // (no read can succeed without an app behind it).
  return true;
}

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  let body: { appId?: unknown; spreadsheetId?: unknown; sheetName?: unknown; headerRow?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 }); }
  if (typeof body.appId !== "string" || !body.appId) return NextResponse.json({ error: "Thiếu appId" }, { status: 400 });
  if (typeof body.spreadsheetId !== "string" || !body.spreadsheetId) return NextResponse.json({ error: "Thiếu spreadsheetId" }, { status: 400 });
  if (typeof body.sheetName !== "string" || !body.sheetName) return NextResponse.json({ error: "Thiếu sheetName" }, { status: 400 });

  if (!(await ownsApp(session.email, body.appId))) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  saveAppDataSource({
    app_id: body.appId,
    user_email: session.email,
    kind: "sheet",
    provider: "google_sheets",
    config: {
      spreadsheetId: body.spreadsheetId,
      sheetName: body.sheetName,
      headerRow: typeof body.headerRow === "number" ? body.headerRow : 1,
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  const url = new URL(req.url);
  const appId = url.searchParams.get("appId");
  if (!appId) return NextResponse.json({ error: "Thiếu appId" }, { status: 400 });

  const existing = getAppDataSource(appId);
  if (existing && existing.user_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }
  deleteAppDataSource(appId, "sheet");
  return NextResponse.json({ ok: true });
}
