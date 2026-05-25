// POST /api/domains/verify { domain }
// Owner-only. Resolves the CNAME chain for `domain` and verifies it points
// at *.justvibe.me. On success flips verified_at — proxy starts routing.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getDomain, markVerified, verifyCnamePointsToUs, normalizeDomain } from "@/lib/domains";

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
  if (!row) return NextResponse.json({ error: "Domain chưa add" }, { status: 404 });
  if (row.user_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const records = await verifyCnamePointsToUs(domain);
  if (!records) {
    return NextResponse.json(
      {
        error: "DNS chưa trỏ về *.justvibe.me. Đợi propagation 1-5 phút rồi thử lại.",
        hint: `Tạo CNAME: ${domain} → <slug-app>.justvibe.me (bật proxy Cloudflare để có HTTPS miễn phí).`,
      },
      { status: 412 },
    );
  }
  markVerified(domain);
  return NextResponse.json({ ok: true, domain, cname_targets: records });
}
