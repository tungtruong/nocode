// POST /api/files/delete { key }
// Owner-only. Deletes one R2 object + its SQLite row. Best-effort — if R2
// deletion fails we still drop the SQLite row so the file no longer counts
// against quota (orphan object is recoverable via R2 console).

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getUpload, deleteUploadRow } from "@/lib/uploads";
import { deleteObject, r2Configured } from "@/lib/r2";

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }
  if (!r2Configured()) {
    return NextResponse.json({ error: "Upload chưa cấu hình" }, { status: 500 });
  }

  let body: { key?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }
  if (typeof body.key !== "string" || !body.key) {
    return NextResponse.json({ error: "Thiếu key" }, { status: 400 });
  }

  const row = getUpload(body.key);
  if (!row) {
    return NextResponse.json({ error: "Không tìm thấy file" }, { status: 404 });
  }
  if (row.user_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: "Không phải file của bạn" }, { status: 403 });
  }

  try {
    await deleteObject(row.key);
  } catch (e) {
    console.warn("[files/delete] R2 delete failed (continuing):", e instanceof Error ? e.message : e);
  }
  deleteUploadRow(row.key);
  return NextResponse.json({ ok: true });
}
