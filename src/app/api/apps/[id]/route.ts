import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { deleteApp } from "@/lib/store";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }
    const { id } = await params;
    const ok = await deleteApp(id, session.email);
    if (!ok) return NextResponse.json({ error: "Không tìm thấy app" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
