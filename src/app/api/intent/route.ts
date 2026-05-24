// POST /api/intent { message } → { mode }
//
// Called by the builder on the user's FIRST chat message to pick a mode before
// /api/chat runs. Lightweight: short LLM classification + keyword short-circuit
// (see lib/intent.ts). Rate-limited like other AI calls.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { checkRateLimit } from "@/lib/security";
import { classifyIntent } from "@/lib/intent";
import { DEFAULT_MODE } from "@/lib/modes";

export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  const rl = checkRateLimit(`intent:${session.email}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Quá giới hạn. Thử lại sau." }, { status: 429 });
  }

  let message: unknown;
  try {
    ({ message } = await req.json());
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ mode: DEFAULT_MODE });
  }

  const mode = await classifyIntent(message, session.email);
  return NextResponse.json({ mode });
}
