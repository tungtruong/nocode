import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getProjectsByUser, saveProject, countProjectsByUser } from "@/lib/store";
import { modeOf } from "@/lib/modes";
import { projectLimit, tierFor, TIER_LABELS } from "@/lib/quota";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }
    const projects = await getProjectsByUser(session.email);
    return NextResponse.json({ projects });
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }
    const body = await req.json();
    const { projectId, appName, msgs, html, url } = body;
    if (!projectId || !appName) {
      return NextResponse.json({ error: "Thiếu thông tin" }, { status: 400 });
    }

    // Block new project beyond the plan's limit. Re-saves of an existing
    // project go through (the limit only gates fresh creation).
    const exists = getDb()
      .prepare("SELECT 1 FROM projects WHERE id = ? AND user_email = ?")
      .get(projectId, session.email);
    if (!exists) {
      const used = countProjectsByUser(session.email);
      const quota = projectLimit(session.email);
      if (used >= quota) {
        const tier = tierFor(session.email);
        return NextResponse.json({
          error: `Đã đạt giới hạn dự án của gói ${TIER_LABELS[tier]} (${used}/${quota}). Xóa dự án cũ hoặc nâng gói để tiếp tục.`,
          code: "PROJECT_LIMIT_EXCEEDED",
          used, quota, tier,
        }, { status: 403 });
      }
    }

    await saveProject(projectId, session.email, {
      appName,
      msgs: msgs || [],
      html: html || "",
      url: url || "",
      mode: modeOf(body.mode),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
