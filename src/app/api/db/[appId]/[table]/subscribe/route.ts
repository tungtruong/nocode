// GET /api/db/<appId>/<table>/subscribe?user=@me
//
// SSE stream of INSERT/UPDATE/DELETE events on the (appId, table) partition.
// Same security envelope as /list:
//   - PRIVATE_TABLES blocked.
//   - `?user=@me` requires an end-user session and scopes events to that uid.
//   - Rate-limited (max 5 concurrent subs per IP per app — a single client
//     opening 100 subs would otherwise burn FDs on the server).
//
// SSE format per event:
//     event: db
//     data: {"type":"INSERT","row":{...},"oldRow":null,"id":"..."}
//
// Heartbeat every 25s (`event: ping`) keeps Cloudflare's 100s idle timeout
// from killing the connection during quiet periods.

import { NextRequest } from "next/server";
import { ownerOfApp } from "@/lib/app-owner";
import { getAppSession } from "@/lib/app-auth";
import { addRealtimeClient, type DbEvent } from "@/lib/realtime";
import { supabaseConfigured } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/security";

const PRIVATE_TABLES = new Set(["submissions", "_jv_users"]);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Credentials": "true",
};

// Origin echo for credentialed requests (cookies for @me filter). Wildcard
// + credentials is rejected by browsers, so mirror the Origin header instead.
function corsHeaders(origin: string | null): Record<string, string> {
  const o = origin && /^https:\/\/([a-zA-Z0-9-]+\.)?justvibe\.me$/.test(origin) ? origin : "*";
  return { ...CORS_HEADERS, "Access-Control-Allow-Origin": o, Vary: "Origin" };
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string; table: string }> },
) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (!supabaseConfigured()) {
    return new Response(JSON.stringify({ error: "DB chưa cấu hình" }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
    });
  }

  const { appId, table } = await ctx.params;
  if (PRIVATE_TABLES.has(table)) {
    return new Response(JSON.stringify({ error: "Bảng này không công khai" }), {
      status: 403,
      headers: { "content-type": "application/json", ...cors },
    });
  }
  if (!(await ownerOfApp(appId))) {
    return new Response(JSON.stringify({ error: "Không tìm thấy app" }), {
      status: 404,
      headers: { "content-type": "application/json", ...cors },
    });
  }

  const url = new URL(req.url);
  const userParam = url.searchParams.get("user");
  let uidFilter: string | null = null;
  if (userParam === "@me") {
    const session = await getAppSession(appId);
    if (!session) {
      return new Response(JSON.stringify({ error: "Cần đăng nhập" }), {
        status: 401,
        headers: { "content-type": "application/json", ...cors },
      });
    }
    uidFilter = session.uid;
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const rl = checkRateLimit(`rtsub:${ip}:${appId}`, 5, 60_000);
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Quá nhiều subscribe" }), {
      status: 429,
      headers: { "content-type": "application/json", ...cors },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const enqueue = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; }
      };

      // Initial comment: tells the EventSource the stream is alive even
      // before the first real event (helps slow networks notice connect).
      enqueue(": connected\n\n");

      const send = (evt: DbEvent) => {
        enqueue(`event: db\ndata: ${JSON.stringify(evt)}\n\n`);
      };
      const onError = (reason: string) => {
        enqueue(`event: error\ndata: ${JSON.stringify({ reason })}\n\n`);
      };

      const unregister = addRealtimeClient(appId, table, { uidFilter, send, onError });

      // 25s heartbeat — Cloudflare cuts idle conns at 100s. Comment-only
      // events ("comments" start with ':') don't fire onmessage in the
      // browser EventSource so they're invisible to app code.
      const hb = setInterval(() => enqueue(`: ping ${Date.now()}\n\n`), 25_000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        unregister();
        try { controller.close(); } catch { /* already */ }
      };

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // disable nginx/cloudflare buffering
      ...cors,
    },
  });
}
