import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { requireSession, authError } from "@/lib/auth";
import { addApp, type AppMeta } from "@/lib/store";

const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: NextRequest) {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }

    const { html, title } = await req.json();

    if (!html || typeof html !== "string") {
      return NextResponse.json({ error: "Thiếu nội dung HTML" }, { status: 400 });
    }

    if (html.length > MAX_HTML_SIZE) {
      return NextResponse.json({ error: "File quá lớn (tối đa 5MB)" }, { status: 400 });
    }

    // Full UUID (with dashes stripped) — 32 hex chars. The previous 8-char prefix
    // was enumerable (~4.3B combinations); a full UUID raises that to ~2^122.
    const id = uuidv4().replace(/-/g, "");
    const dir = path.join(process.cwd(), "public", "apps", id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.html"), html, "utf-8");

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3002";
    const url = `${baseUrl}/apps/${id}`;

    // Save app metadata with user association
    try {
      addApp(id, {
        user_email: session.email,
        title: title || "Untitled App",
        url,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Store error:", e);
    }

    return NextResponse.json({ url, id });
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
