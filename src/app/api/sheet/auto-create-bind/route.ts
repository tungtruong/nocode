// POST /api/sheet/auto-create-bind { appId }
//
// One-shot UX for owners who don't want to know what a sheet schema is:
//   1. Read the app's HTML (deployed file first, draft project as fallback).
//   2. Extract all form field `name=` attributes from <form action="/f/.../submit"> blocks.
//   3. Create a fresh spreadsheet in the owner's Drive titled
//      "<App Name> – Submissions" with one column per detected field.
//   4. Bind the sheet to this app via app_data_sources.
//
// Idempotent-ish: if the app already has a sheet bound, returns 409 so
// the UI shows a "you already have one" message instead of silently
// creating a second sheet.

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { requireSession, authError } from "@/lib/auth";
import { getApp, getProject } from "@/lib/store";
import { getAppDataSource, saveAppDataSource } from "@/lib/integrations";
import { createSpreadsheet } from "@/lib/sheets";
import { extractFormFields } from "@/lib/form-fields";

async function loadHtml(appId: string, userEmail: string): Promise<string | null> {
  // Prefer the deployed file — it's the canonical version (after server-side
  // {{APP_ID}} substitution) that real visitors will submit against.
  try {
    const filePath = path.join(process.cwd(), "public", "apps", appId, "index.html");
    const txt = await fs.readFile(filePath, "utf-8");
    if (txt) return txt;
  } catch {
    // Not deployed yet — fall back to the draft project.
  }
  const proj = await getProject(appId, userEmail);
  return proj?.html ?? null;
}

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  let body: { appId?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }
  if (typeof body.appId !== "string" || !body.appId) {
    return NextResponse.json({ error: "Thiếu appId" }, { status: 400 });
  }
  const appId = body.appId;

  // Ownership: deployed app OR draft project owner.
  const deployed = await getApp(appId);
  const draft = deployed ? null : await getProject(appId, session.email);
  const owner = deployed?.user_email ?? draft?.user_email;
  if (!owner) return NextResponse.json({ error: "App không tồn tại" }, { status: 404 });
  if (owner.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  if (getAppDataSource(appId)) {
    return NextResponse.json(
      { error: "App đã bind sheet — gỡ trước hoặc đổi sheet ở phần Bind thủ công", code: "ALREADY_BOUND" },
      { status: 409 },
    );
  }

  const html = await loadHtml(appId, session.email);
  if (!html) return NextResponse.json({ error: "Không đọc được HTML app" }, { status: 404 });

  const headers = extractFormFields(html);
  if (headers.length <= 1) {
    // Only `submitted_at` got picked up → no real form fields detected.
    return NextResponse.json(
      { error: "App không có form nào — không cần sheet", code: "NO_FORM" },
      { status: 400 },
    );
  }

  const appName = deployed?.title || draft?.appName || "App";
  const sheetTitle = `${appName} — Submissions`;

  try {
    const created = await createSpreadsheet(session.email, {
      title: sheetTitle,
      headers,
    });
    saveAppDataSource({
      app_id: appId,
      user_email: session.email,
      kind: "sheet",
      provider: "google_sheets",
      config: {
        spreadsheetId: created.spreadsheetId,
        sheetName: created.sheetName,
        headerRow: 1,
      },
    });
    console.log(`[auto-create-bind] ${session.email} app=${appId} sheet=${created.spreadsheetId} headers=${headers.join(",")}`);
    return NextResponse.json({
      spreadsheetId: created.spreadsheetId,
      sheetName: created.sheetName,
      url: created.url,
      headers,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "google_not_connected") {
      return NextResponse.json(
        { error: "Cần kết nối Google trước", code: "NOT_CONNECTED" },
        { status: 400 },
      );
    }
    console.error("[auto-create-bind] failed:", msg);
    return NextResponse.json({ error: "Tạo sheet thất bại" }, { status: 502 });
  }
}
