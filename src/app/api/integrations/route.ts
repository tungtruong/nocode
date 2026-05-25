// GET /api/integrations → list connected providers + per-app bindings.
// DELETE /api/integrations?provider=google_sheets → disconnect.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { listIntegrations, deleteIntegration } from "@/lib/integrations";
import { getDb } from "@/lib/db";

export async function GET() {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  const integrations = listIntegrations(session.email);

  // Per-app bindings — small enough to list inline.
  const bindings = getDb()
    .prepare(
      `SELECT app_id, kind, provider, source_config_json, updated_at
       FROM app_data_sources WHERE user_email = ? ORDER BY updated_at DESC`,
    )
    .all(session.email) as Array<{
      app_id: string;
      kind: string;
      provider: string;
      source_config_json: string;
      updated_at: string;
    }>;

  return NextResponse.json({
    integrations,
    bindings: bindings.map((b) => ({
      app_id: b.app_id,
      kind: b.kind,
      provider: b.provider,
      config: safeParseJson(b.source_config_json),
      updated_at: b.updated_at,
    })),
  });
}

export async function DELETE(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  if (provider !== "google_sheets" && provider !== "google_drive") {
    return NextResponse.json({ error: "provider không hợp lệ" }, { status: 400 });
  }
  deleteIntegration(session.email, provider);
  return NextResponse.json({ ok: true });
}

function safeParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
