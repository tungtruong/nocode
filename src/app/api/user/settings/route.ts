// GET  /api/user/settings           → { model_override }
// POST /api/user/settings { key, value }
//
// Per-user key/value store. First user-facing setting is `model_override`:
// the account that toggles it routes ALL their LLM calls (orchestrator,
// classifier, main gen, edit agent, summary) to the named model instead of
// the platform default. Empty string clears the override.
//
// Allow-list for model values to prevent typos / abuse — we don't want a
// user setting "model_override = gpt-9999" and crashing every gen.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getUserSetting, setUserSetting, deleteUserSetting } from "@/lib/user-settings";

const ALLOWED_MODELS = new Set([
  "",                  // empty = clear override, use platform default
  "deepseek-v4-pro",
  "deepseek-chat",
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o-mini",
  "gpt-4o",
  "o4-mini",
]);

const ALLOWED_KEYS = new Set(["model_override"]);

export async function GET() {
  let session; try { session = await requireSession(); } catch { return authError(); }
  return NextResponse.json({
    model_override: getUserSetting(session.email, "model_override") || "",
  });
}

export async function POST(req: NextRequest) {
  let session; try { session = await requireSession(); } catch { return authError(); }

  let body: { key?: unknown; value?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }
  if (typeof body.key !== "string" || !ALLOWED_KEYS.has(body.key)) {
    return NextResponse.json({ error: "Key không hợp lệ" }, { status: 400 });
  }
  if (typeof body.value !== "string") {
    return NextResponse.json({ error: "Value phải là string" }, { status: 400 });
  }

  // Per-key validation
  if (body.key === "model_override" && !ALLOWED_MODELS.has(body.value)) {
    return NextResponse.json(
      { error: `Model không nằm trong allow-list. Cho phép: ${[...ALLOWED_MODELS].filter(Boolean).join(", ")}` },
      { status: 400 },
    );
  }

  if (body.value === "") {
    deleteUserSetting(session.email, body.key);
  } else {
    setUserSetting(session.email, body.key, body.value);
  }
  return NextResponse.json({ ok: true, [body.key]: body.value });
}
