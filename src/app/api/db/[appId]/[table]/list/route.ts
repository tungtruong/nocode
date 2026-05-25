// POST /api/db/<appId>/<table>/list { limit?, where?, orderAsc? }
//
// Public read endpoint — called by `window.jv.db.list/find/count` from inside
// deployed apps and the builder preview iframe (cross-origin from subdomains).
//
// Security model:
//   - Owner-private tables: `submissions` is forbidden here (form data is PII).
//     Owners read submissions via /api/forms/<appId> with their JV session.
//   - Anything else (products, menu_items, listings, posts, ...) is fair game
//     for public read — the app is already publicly deployed and the data is
//     what the AI app renders to anyone visiting the page.
//   - Rate-limited per IP to deter scraping bots (60 req/min/IP).
//   - CORS: allow any origin (data is public anyway; lets owners embed their
//     app in their own marketing site too).

import { NextRequest, NextResponse } from "next/server";
import { selectRows, supabaseConfigured } from "@/lib/supabase";
import { ownerOfApp } from "@/lib/app-owner";
import { checkRateLimit } from "@/lib/security";
import { getAppSession } from "@/lib/app-auth";

const PRIVATE_TABLES = new Set(["submissions", "_jv_users"]);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string; table: string }> },
) {
  if (!supabaseConfigured()) {
    return withCors(NextResponse.json({ error: "DB chưa cấu hình" }, { status: 500 }));
  }

  const { appId, table } = await ctx.params;

  if (PRIVATE_TABLES.has(table)) {
    return withCors(NextResponse.json({ error: "Bảng này không công khai" }, { status: 403 }));
  }

  // Validate the app actually exists (and infer owner). Don't leak whether
  // an unknown appId belongs to a draft vs. nothing — single 404.
  const owner = await ownerOfApp(appId);
  if (!owner) {
    return withCors(NextResponse.json({ error: "Không tìm thấy app" }, { status: 404 }));
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const rl = checkRateLimit(`jvdb:${ip}:${appId}`, 60, 60_000);
  if (!rl.allowed) {
    return withCors(NextResponse.json({ error: "Quá nhiều yêu cầu" }, { status: 429 }));
  }

  let body: { limit?: unknown; where?: unknown; orderAsc?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(body.limit, 500) : 100;
  const where = body.where && typeof body.where === "object" && !Array.isArray(body.where)
    ? { ...(body.where as Record<string, string | number | boolean | null>) }
    : undefined;
  const orderDesc = body.orderAsc === true ? false : true;

  // `user_id: '@me'` and `uid: '@me'` substitution — lets apps fetch the
  // logged-in end-user's own rows without ever putting raw user ids in the
  // client. If unauthenticated, refuse so private data can't leak.
  if (where) {
    const meKeys = Object.entries(where).filter(([, v]) => v === "@me").map(([k]) => k);
    if (meKeys.length > 0) {
      const session = await getAppSession(appId);
      if (!session) {
        return withCors(NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 }));
      }
      for (const k of meKeys) where[k] = session.uid;
    }
  }

  try {
    const rows = await selectRows(appId, table, { limit, where, orderDesc });
    return withCors(NextResponse.json({ rows }));
  } catch (e) {
    console.error("[db/list] failed:", e instanceof Error ? e.message : e);
    return withCors(NextResponse.json({ error: "Đọc DB thất bại" }, { status: 502 }));
  }
}
