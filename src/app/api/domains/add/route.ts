// POST /api/domains/add { app, domain }
// Owner-only. Inserts an UNVERIFIED row — proxy routing only kicks in after
// /api/domains/verify confirms the DNS CNAME. Per-tier quota enforced.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { userOwnsApp } from "@/lib/app-owner";
import { addDomain, getDomain, countDomainsForOwner, isValidDomain, normalizeDomain } from "@/lib/domains";
import { customDomainLimit } from "@/lib/quota";

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

  addDomain(domain, body.app, session.email);
  return NextResponse.json({ ok: true, domain });
}
