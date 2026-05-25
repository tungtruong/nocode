// GET /api/domains/list?app=<appId>
// Owner-only. Returns custom domains pointed at the given app + quota status.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { userOwnsApp } from "@/lib/app-owner";
import { listDomainsForApp, countDomainsForOwner } from "@/lib/domains";
import { customDomainLimit } from "@/lib/quota";

export async function GET(req: NextRequest) {
  let session; try { session = await requireSession(); } catch { return authError(); }
  const appId = new URL(req.url).searchParams.get("app") || "";
  if (!appId) return NextResponse.json({ error: "Thiếu app" }, { status: 400 });
  if (!(await userOwnsApp(appId, session.email))) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }
  return NextResponse.json({
    domains: listDomainsForApp(appId),
    quota: {
      used: countDomainsForOwner(session.email),
      cap: customDomainLimit(session.email),
    },
  });
}
