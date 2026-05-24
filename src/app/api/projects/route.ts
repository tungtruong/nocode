import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getProjectsByUser, saveProject } from "@/lib/store";

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
    await saveProject(projectId, session.email, { appName, msgs: msgs || [], html: html || "", url: url || "" });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
