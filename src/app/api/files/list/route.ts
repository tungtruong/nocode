// GET /api/files/list?app=<appId>
// Owner-only — list files uploaded under this app for the dashboard dropzone view.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { userOwnsApp } from "@/lib/app-owner";
import { listUploadsForOwner } from "@/lib/uploads";
import { publicUrlFor } from "@/lib/r2";
import { uploadBytesLimit } from "@/lib/quota";
import { sumUploadBytes } from "@/lib/uploads";

export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  const url = new URL(req.url);
  const appId = url.searchParams.get("app") || "";
  if (!appId) {
    return NextResponse.json({ error: "Thiếu app" }, { status: 400 });
  }
  if (!(await userOwnsApp(appId, session.email))) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const rows = listUploadsForOwner(session.email, appId, 200);
  return NextResponse.json({
    files: rows.map((r) => ({
      key: r.key,
      url: publicUrlFor(r.key),
      size_bytes: r.size_bytes,
      mime: r.mime,
      original_name: r.original_name,
      uploader_uid: r.uploader_uid,
      created_at: r.created_at,
    })),
    quota: {
      used: sumUploadBytes(session.email),
      cap: uploadBytesLimit(session.email),
    },
  });
}
