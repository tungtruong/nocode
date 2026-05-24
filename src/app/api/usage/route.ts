import { NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getUsage } from "@/lib/quota";

export async function GET() {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }
    const info = getUsage(session.email);
    return NextResponse.json(info);
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
