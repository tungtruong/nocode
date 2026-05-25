// POST /api/domains/verify { domain }
// Owner-only. Polls Cloudflare for the SaaS custom-hostname status. If CF
// reports the hostname is fully provisioned (status=active + ssl=active),
// flips verified_at and the proxy starts routing. Otherwise returns the
// current state so the dashboard can show "still pending" / "validation
// failed" to the owner.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getDomain, markVerified, setCfHostnameId, normalizeDomain } from "@/lib/domains";
import {
  cloudflareConfigured,
  createCustomHostname,
  getCustomHostname,
  isCustomHostnameLive,
} from "@/lib/cloudflare";

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

  if (!cloudflareConfigured()) {
    return NextResponse.json(
      { error: "Cloudflare for SaaS chưa cấu hình trên server. Báo dev set CF_API_TOKEN + CF_ZONE_ID." },
      { status: 500 },
    );
  }

  // Recover from "added before CF was configured" — re-create on CF side.
  let cfId = row.cf_hostname_id;
  if (!cfId) {
    try {
      const ch = await createCustomHostname(domain);
      cfId = ch.id;
      setCfHostnameId(domain, ch.id);
    } catch (e) {
      return NextResponse.json(
        { error: `Cloudflare từ chối: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 },
      );
    }
  }

  try {
    const ch = await getCustomHostname(cfId);
    if (isCustomHostnameLive(ch)) {
      markVerified(domain);
      return NextResponse.json({
        ok: true,
        domain,
        status: ch.status,
        ssl_status: ch.ssl?.status,
      });
    }
    // Not yet live — return state so the dashboard can render an inline
    // explanation (CF often takes 30s–5 min for HTTP-01 validation).
    return NextResponse.json(
      {
        error: explainPending(ch.status, ch.ssl?.status),
        status: ch.status,
        ssl_status: ch.ssl?.status,
        validation_errors: ch.ssl?.validation_errors,
        hint: "Bấm Verify lại sau 1-2 phút. Nếu CF báo validation_errors, kiểm tra CNAME đã trỏ đúng chưa.",
      },
      { status: 202 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Cloudflare query lỗi: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}

function explainPending(status: string, sslStatus?: string): string {
  if (status === "pending") return "Cloudflare đang đợi DNS — CNAME chưa propagate hoặc chưa trỏ đúng customers.justvibe.me.";
  if (sslStatus === "pending_validation") return "Cert đang chờ validation — Cloudflare đang thử HTTP-01 challenge.";
  if (sslStatus === "pending_issuance") return "Cert đã validate, đang đợi Let's Encrypt cấp (~30s).";
  if (status === "blocked") return "Domain bị Cloudflare chặn — kiểm tra hostname không vi phạm policy CF.";
  return `Domain chưa sẵn sàng (status=${status}, ssl=${sslStatus || "?"}).`;
}
