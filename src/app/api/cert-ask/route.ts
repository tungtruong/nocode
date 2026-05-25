// GET /api/cert-ask?domain=<host>
//
// Queried by Caddy's `on_demand_tls.ask` directive BEFORE Caddy attempts
// to issue a Let's Encrypt cert for an unknown hostname. Returning 2xx
// authorises the issuance; any non-2xx blocks it.
//
// Why this matters: without an ask hook, Caddy would let ANY browser pick
// any domain pointing at our IP and try to mint a cert. That hits Let's
// Encrypt rate limits fast (50 certs/week/registered domain) and bills
// our LE budget for nothing. The ask hook ensures we only issue certs
// for domains the owner explicitly added through /dashboard/data/<id>.
//
// We accept BOTH verified and unverified rows. Reason: cert issuance is
// pre-condition for verify — the customer needs HTTPS to load the dashboard
// to click Verify. Once the cert exists + the DNS CNAME resolves to us,
// verifyCnamePointsToUs() in /api/domains/verify flips verified_at.
//
// Caddy retries the ask + ACME challenge on later requests if the first
// attempt fails, so it's safe for a domain to be in the table before DNS
// propagates — there's just a delay before the cert appears.

import { NextRequest, NextResponse } from "next/server";
import { getDomain, normalizeDomain, isValidDomain } from "@/lib/domains";

export async function GET(req: NextRequest) {
  const domain = (new URL(req.url).searchParams.get("domain") || "").trim().toLowerCase();
  if (!domain || !isValidDomain(domain)) {
    return new NextResponse("invalid", { status: 400 });
  }
  const row = getDomain(normalizeDomain(domain));
  if (!row) {
    return new NextResponse("unknown", { status: 403 });
  }
  return new NextResponse("ok", { status: 200 });
}
