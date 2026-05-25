// POST /api/domains/remove { domain }
// Owner-only. Removes the mapping; proxy stops routing immediately.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getDomain, removeDomain, normalizeDomain } from "@/lib/domains";
import { cloudflareConfigured, deleteCustomHostname } from "@/lib/cloudflare";

export async function POST(req: NextRequest) {
  let session; try { session = await requireSession(); } catch { return authError(); }

  let body: { domain?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }
  if (typeof body.domain !== "string" || !body.domain) {
    return NextResponse.json({ error: "Thiếu domain" }, { status: 400 });
  }

  const domain = normalizeDomain(body.domain);
  const row = getDomain(domain);
  if (!row) return NextResponse.json({ error: "Domain không tồn tại" }, { status: 404 });
  if (row.user_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  // Delete from CF first so we don't leak quota slots if the DB delete fails
  // or someone re-adds the same hostname later (CF rejects duplicates).
  // Tolerate "already deleted" / 404 from CF — keep the DB cleanup going.
  if (row.cf_hostname_id && cloudflareConfigured()) {
    try {
      await deleteCustomHostname(row.cf_hostname_id);
    } catch (e) {
      console.warn(`[domains/remove] CF delete failed (continuing): ${e instanceof Error ? e.message : e}`);
    }
  }
  removeDomain(domain);
  return NextResponse.json({ ok: true });
}
