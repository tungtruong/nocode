// POST /f/<appId>/submit
//
// Public endpoint that captures form submissions from a deployed app.
// Anyone (no auth) can POST — that's the point; visitors to the app submit
// without needing a JustVibe account.
//
// Routing:
//   1. If owner has a sheet bound for this app → append row to their Sheet
//      (rich, owner-controlled, exports via Drive).
//   2. Else → fall back to JV's form_submissions table so the data isn't
//      lost. Dashboard nudges owner to connect Google + migrate.
//
// Accepts both application/x-www-form-urlencoded (HTML form posts) and JSON.
// Rate-limited per IP per app to discourage spam.

import { NextRequest, NextResponse } from "next/server";
import { getApp } from "@/lib/store";
import { getAppDataSource, type SheetConfig } from "@/lib/integrations";
import { appendRow } from "@/lib/sheets";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/security";

const MAX_FIELD_BYTES = 10_000;
const MAX_PAYLOAD_FIELDS = 50;

async function parseBody(req: NextRequest): Promise<Record<string, string>> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    try {
      const j = await req.json();
      const out: Record<string, string> = {};
      if (j && typeof j === "object") {
        for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
          if (Object.keys(out).length >= MAX_PAYLOAD_FIELDS) break;
          const s = v === null || v === undefined ? "" : String(v);
          out[k] = s.slice(0, MAX_FIELD_BYTES);
        }
      }
      return out;
    } catch { return {}; }
  }
  // form-encoded or multipart — use formData() which handles both.
  try {
    const fd = await req.formData();
    const out: Record<string, string> = {};
    for (const [k, v] of fd.entries()) {
      if (Object.keys(out).length >= MAX_PAYLOAD_FIELDS) break;
      if (typeof v !== "string") continue; // skip File entries
      out[k] = v.slice(0, MAX_FIELD_BYTES);
    }
    return out;
  } catch { return {}; }
}

// Ownership: prefer apps row (deployed); fall back to projects row
// (form submitting during testing, before deploy).
async function ownerOf(appId: string): Promise<string | null> {
  const app = await getApp(appId);
  if (app) return app.user_email;
  // Project owner — need projects.user_email lookup via getDb.
  const row = getDb()
    .prepare("SELECT user_email FROM projects WHERE id = ?")
    .get(appId) as { user_email: string } | undefined;
  return row?.user_email ?? null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: appId } = await ctx.params;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = checkRateLimit(`form:${appId}:${ip}`, 30, 60 * 60 * 1000); // 30/hr per IP per app
  if (!rl.allowed) {
    return NextResponse.json({ error: "Quá nhiều yêu cầu" }, { status: 429 });
  }

  const owner = await ownerOf(appId);
  if (!owner) return NextResponse.json({ error: "App không tồn tại" }, { status: 404 });

  const payload = await parseBody(req);
  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "Form rỗng" }, { status: 400 });
  }

  const source = getAppDataSource<SheetConfig>(appId, "sheet");
  let storedTo: "sheet" | "fallback" = "fallback";

  if (source) {
    try {
      await appendRow(
        source.user_email,
        source.config.spreadsheetId,
        source.config.sheetName,
        payload,
        source.config.headerRow,
      );
      storedTo = "sheet";
    } catch (e) {
      // Sheet write failed (revoked OAuth, sheet deleted, etc) — fall back
      // so the submission isn't lost. Owner will see a warning next dashboard.
      console.error("[f/submit] sheet write failed, falling back:", e instanceof Error ? e.message : e);
    }
  }

  if (storedTo === "fallback") {
    try {
      getDb()
        .prepare(
          "INSERT INTO form_submissions (app_id, payload_json, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          appId,
          JSON.stringify(payload),
          ip,
          (req.headers.get("user-agent") || "").slice(0, 500),
          new Date().toISOString(),
        );
    } catch (e) {
      console.error("[f/submit] fallback write failed:", e);
      return NextResponse.json({ error: "Lưu thất bại" }, { status: 500 });
    }
  }

  // Honor `?redirect=` for HTML form posts so the browser lands somewhere
  // sensible after submit (the AI typically gens a thank-you anchor).
  const url = new URL(req.url);
  const redirect = url.searchParams.get("redirect");
  const accept = req.headers.get("accept") || "";
  if (redirect && /^https?:\/\//i.test(redirect)) {
    return NextResponse.redirect(redirect, 303);
  }
  if (accept.includes("text/html") && !accept.includes("application/json")) {
    // Default plain-HTML thanks page so a vanilla `<form>` POST without JS
    // doesn't dump the JSON response into the browser.
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cảm ơn</title><style>body{font-family:system-ui;text-align:center;padding:80px 20px;background:#fafafa;color:#18181b}h1{font-size:32px;margin-bottom:8px}p{color:#71717a;margin-bottom:32px}a{display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:500}</style></head><body><h1>✓ Cảm ơn!</h1><p>Đã ghi nhận thông tin của bạn.</p><a href="javascript:history.back()">← Quay lại</a></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  return NextResponse.json({ ok: true, storedTo });
}
