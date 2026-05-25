// POST /f/<appId>/submit
//
// Public endpoint that captures form submissions from a deployed app.
// Anyone (no auth) can POST — that's the point; visitors to the app submit
// without needing a JustVibe account.
//
// Writes to the shared Supabase `app_rows` table with table_name='submissions'.
// Owner reads them back from /api/forms/<appId>.
//
// Accepts both application/x-www-form-urlencoded (HTML form posts) and JSON.
// Rate-limited per IP per app to discourage spam.

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/security";
import { ownerOfApp } from "@/lib/app-owner";
import { insertRow, supabaseConfigured } from "@/lib/supabase";
import { getDb } from "@/lib/db";

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
  try {
    const fd = await req.formData();
    const out: Record<string, string> = {};
    for (const [k, v] of fd.entries()) {
      if (Object.keys(out).length >= MAX_PAYLOAD_FIELDS) break;
      if (typeof v !== "string") continue;
      out[k] = v.slice(0, MAX_FIELD_BYTES);
    }
    return out;
  } catch { return {}; }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: appId } = await ctx.params;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = checkRateLimit(`form:${appId}:${ip}`, 30, 60 * 60 * 1000); // 30/hr per IP per app
  if (!rl.allowed) {
    return NextResponse.json({ error: "Quá nhiều yêu cầu" }, { status: 429 });
  }

  const owner = await ownerOfApp(appId);
  if (!owner) return NextResponse.json({ error: "App không tồn tại" }, { status: 404 });

  const payload = await parseBody(req);
  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "Form rỗng" }, { status: 400 });
  }
  if (!payload.submitted_at) payload.submitted_at = new Date().toISOString();

  // Annotate with submission metadata visible only to the owner via dashboard.
  const row = {
    ...payload,
    _ip: ip,
    _ua: (req.headers.get("user-agent") || "").slice(0, 500),
  };

  let storedTo: "supabase" | "fallback" = "fallback";
  if (supabaseConfigured()) {
    try {
      await insertRow(appId, "submissions", row);
      storedTo = "supabase";
    } catch (e) {
      console.error("[f/submit] supabase failed, falling back:", e instanceof Error ? e.message : e);
    }
  }

  if (storedTo === "fallback") {
    // Last-resort: keep the data in JV's own SQLite so a Supabase outage
    // doesn't lose leads. Dashboard surfaces these as "fallback" rows.
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

  // Friendly redirect / thanks page for plain <form> posts.
  const url = new URL(req.url);
  const redirect = url.searchParams.get("redirect");
  const accept = req.headers.get("accept") || "";
  if (redirect && /^https?:\/\//i.test(redirect)) {
    return NextResponse.redirect(redirect, 303);
  }
  if (accept.includes("text/html") && !accept.includes("application/json")) {
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cảm ơn</title><style>body{font-family:system-ui;text-align:center;padding:80px 20px;background:#fafafa;color:#18181b}h1{font-size:32px;margin-bottom:8px}p{color:#71717a;margin-bottom:32px}a{display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:500}</style></head><body><h1>✓ Cảm ơn!</h1><p>Đã ghi nhận thông tin của bạn.</p><a href="javascript:history.back()">← Quay lại</a></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  return NextResponse.json({ ok: true, storedTo });
}
