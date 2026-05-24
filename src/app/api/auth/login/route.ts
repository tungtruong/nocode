import { NextRequest, NextResponse } from "next/server";
import { createSession, validateCredentials } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Cần email và mật khẩu" }, { status: 400 });
    }

    const user = validateCredentials(email, password);
    if (!user) {
      return NextResponse.json({ error: "Sai thông tin đăng nhập" }, { status: 401 });
    }

    await createSession(email, user.name);
    return NextResponse.json({ ok: true, name: user.name });
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
