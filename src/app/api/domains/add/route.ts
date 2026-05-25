// POST /api/domains/add { app, domain }
// Owner-only. Inserts the row, then provisions the hostname in Cloudflare
// for SaaS so CF can start issuing the cert. Per-tier quota enforced.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { userOwnsApp } from "@/lib/app-owner";
import { addDomain, getDomain, countDomainsForOwner, isValidDomain, normalizeDomain } from "@/lib/domains";
import { customDomainLimit } from "@/lib/quota";
import { cloudflareConfigured, createCustomHostname } from "@/lib/cloudflare";

export async function POST(req: NextRequest) {
  let session; try { session = await requireSession(); } catch { return authError(); }

  let body: { app?: unknown; domain?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }
  if (typeof body.app !== "string" || !body.app) {
    return NextResponse.json({ error: "Thiếu app" }, { status: 400 });
  }
  if (typeof body.domain !== "string" || !isValidDomain(body.domain)) {
    return NextResponse.json({ error: "Domain không hợp lệ" }, { status: 400 });
  }
  if (!(await userOwnsApp(body.app, session.email))) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const domain = normalizeDomain(body.domain);
  const existing = getDomain(domain);
  if (existing) {
    return NextResponse.json(
      { error: existing.user_email.toLowerCase() === session.email.toLowerCase() ? "Domain đã tồn tại" : "Domain đã được dùng bởi tài khoản khác" },
      { status: 409 },
    );
  }

  const cap = customDomainLimit(session.email);
  const used = countDomainsForOwner(session.email);
  if (used >= cap) {
    return NextResponse.json(
      { error: `Hết quota domain (${used}/${cap}). Nâng cấp gói để thêm.` },
      { status: 402 },
    );
  }

  // Create in Cloudflare BEFORE inserting locally — if CF errors (e.g.
  // hostname already taken by another CF account, malformed name) we don't
  // leave a dangling row. On rare cases where both succeed but a later
  // error happens, the cleanup is in /api/domains/remove.
  let cfHostnameId: string | null = null;
  if (cloudflareConfigured()) {
    try {
      const ch = await createCustomHostname(domain);
      cfHostnameId = ch.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // CF returns specific messages for duplicate / blocked — surface them.
      return NextResponse.json({ error: `Cloudflare từ chối: ${msg}` }, { status: 502 });
    }
  } else {
    console.warn("[domains/add] CF SaaS unconfigured — proceeding without auto-cert");
  }

  try {
    addDomain(domain, body.app, session.email, cfHostnameId);
  } catch (e) {
    // SQL constraint or another insert failure — undo CF side so we don't
    // leak quota slots on the SaaS plan.
    if (cfHostnameId) {
      try {
        const { deleteCustomHostname } = await import("@/lib/cloudflare");
        await deleteCustomHostname(cfHostnameId);
      } catch { /* best effort */ }
    }
    return NextResponse.json({ error: `Lưu domain thất bại: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, domain, cf_hostname_id: cfHostnameId });
}
