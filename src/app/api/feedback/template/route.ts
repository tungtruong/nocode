// POST /api/feedback/template { mode, reason, note?, projectId? }
//
// User-reported template feedback ("Mẫu không phù hợp"). Rows surface in
// /admin/templates so we can prioritize which mode to revise.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { checkRateLimit } from "@/lib/security";
import { getDb } from "@/lib/db";
import { modeOf } from "@/lib/modes";

const ALLOWED_REASONS = ["missing", "wrong_industry", "ugly", "other"] as const;
type Reason = (typeof ALLOWED_REASONS)[number];

function isValidReason(value: unknown): value is Reason {
  return typeof value === "string" && (ALLOWED_REASONS as readonly string[]).includes(value);
}

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  const rl = checkRateLimit(`feedback:${session.email}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Quá giới hạn. Thử lại sau." }, { status: 429 });
  }

  let body: { mode?: unknown; reason?: unknown; note?: unknown; projectId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  if (!isValidReason(body.reason)) {
    return NextResponse.json({ error: "reason không hợp lệ" }, { status: 400 });
  }

  const mode = modeOf(body.mode);
  const note = typeof body.note === "string" ? body.note.slice(0, 1000) : null;
  const projectId = typeof body.projectId === "string" ? body.projectId : null;

  try {
    getDb()
      .prepare(
        "INSERT INTO template_feedback (user_email, project_id, mode, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(session.email, projectId, mode, body.reason, note, new Date().toISOString());
  } catch (e) {
    console.error("[feedback] DB write failed:", e);
    return NextResponse.json({ error: "Lưu phản hồi thất bại" }, { status: 500 });
  }

  console.log(`[feedback] ${session.email} mode=${mode} reason=${body.reason} project=${projectId}`);
  return NextResponse.json({ ok: true });
}
