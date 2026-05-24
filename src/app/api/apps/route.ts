import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getAppsByUser } from "@/lib/store";

export async function GET() {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }
    const apps = await getAppsByUser(session.email);
    return NextResponse.json({ apps });
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
