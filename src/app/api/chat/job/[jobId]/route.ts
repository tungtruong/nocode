// GET /api/chat/job/<jobId>
//
// Lightweight JSON status endpoint — for the auto-recover flow on builder
// page mount. The full SSE replay at /api/chat/resume/<jobId> is great
// for an in-flight reconnect, but is overkill for "page just loaded, does
// the user have an unfinished or already-finished gen?" — that's a single
// JSON read.
//
// Returns:
//   { status: 'streaming' | 'complete' | 'error',
//     project_id, html (only when complete), summary, plan_json (raw string),
//     error_msg, created_at, completed_at }

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getJob } from "@/lib/gen-jobs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  let session; try { session = await requireSession(); } catch { return authError(); }

  const { jobId } = await ctx.params;
  const row = getJob(jobId);
  if (!row || row.user_email.toLowerCase() !== session.email.toLowerCase()) {
    // Don't leak existence — same 404 for missing AND foreign rows.
    return NextResponse.json({ error: "Không tìm thấy job" }, { status: 404 });
  }

  return NextResponse.json({
    status: row.status,
    project_id: row.project_id,
    html: row.status === "complete" ? row.html_accumulated : undefined,
    // For 'streaming' rows we can also expose accumulated partial output so
    // the UI can show "X% xong" — but partial HTML is usually unparseable
    // until the gen finishes, so we hide it to avoid render-broken-doc.
    summary: row.summary,
    plan_json: row.plan_json,
    error_msg: row.error_msg,
    created_at: row.created_at,
    completed_at: row.completed_at,
  });
}
