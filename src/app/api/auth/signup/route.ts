import { NextRequest, NextResponse } from "next/server";
import { createUser, createSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    // Rate-limit by IP since the user isn't authenticated yet. (Yes, X-Forwarded-For
    // can be spoofed behind a permissive proxy; this is a soft brake, not a hard one.)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "anonymous";
    const rl = checkRateLimit(`signup:${ip}`, 5, 60 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Quá nhiều lần đăng ký. Thử lại sau." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
    }
    const { email, password, name } = body as { email?: string; password?: string; name?: string };
    if (!email || !password || !name) {
      return NextResponse.json({ error: "Thiếu thông tin" }, { status: 400 });
    }

    const result = createUser(email, password, name);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await createSession(email, result.name!);
    return NextResponse.json({ ok: true, name: result.name });
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
