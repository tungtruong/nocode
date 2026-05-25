// GET /api/chat/resume/<jobId>
//
// SSE replay + tail of an in-progress / completed /api/chat job. Clients
// open this when the original streaming POST drops (mobile background,
// network blip, page reload) — we send everything they would have seen
// if they'd never disconnected:
//
//   event: job       - data: "<jobId>" (echo, matches the POST flow)
//   event: plan      - data: <json>     (if the orchestrator wrote one)
//   event: html      - data: <full html so far>   (single message, replayed)
//   event: html      - data: <new chunks>          (as DB updates)
//   event: summary   - data: <text>     (when job completes)
//   event: done      - data: ""         (terminal)
//   event: error     - data: <msg>      (terminal alternative)
//
// We poll the DB every 500 ms — cheap because better-sqlite3 reads are
// sync + indexed. Stops polling when the row is `complete` or `error`,
// or after 5 min idle as a safety net.

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getJob } from "@/lib/gen-jobs";

const POLL_MS = 500;
const MAX_DURATION_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 25_000;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  let session;
  try { session = await requireSession(); } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const { jobId } = await ctx.params;
  const initial = getJob(jobId);
  if (!initial) {
    return new Response("job not found", { status: 404 });
  }
  if (initial.user_email.toLowerCase() !== session.email.toLowerCase()) {
    // Don't leak existence of someone else's job — same status as not-found.
    return new Response("job not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          // Multi-line data MUST be split into `data:` lines per the SSE spec.
          // Generated HTML can be huge with embedded newlines, so this matters.
          const lines = data.split("\n").map((l) => `data: ${l}`).join("\n");
          controller.enqueue(encoder.encode(`event: ${event}\n${lines}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Echo the job id so the client can confirm it reached the right row.
      send("job", jobId);

      // Initial dump — everything the DB knows about right now.
      if (initial.plan_json) send("plan", initial.plan_json);
      if (initial.html_accumulated) send("html", initial.html_accumulated);

      let lastSentLen = initial.html_accumulated.length;
      const startedAt = Date.now();

      // 25 s heartbeats prevent Cloudflare / nginx idle timeouts from
      // killing the SSE connection during quiet periods (e.g. between
      // the gen finishing and the summary call landing).
      const hb = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch { closed = true; }
      }, HEARTBEAT_MS);

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        try { controller.close(); } catch { /* already */ }
      };

      // Drop the connection cleanly if the new client also goes away.
      _req.signal.addEventListener("abort", finish);

      // Poll loop. Yields control between iterations via setTimeout so the
      // Node event loop can serve other requests + write to the SQLite row.
      while (!closed) {
        if (Date.now() - startedAt > MAX_DURATION_MS) {
          send("error", "Resume timed out — gen has been stuck for over 5 min");
          break;
        }
        const row = getJob(jobId);
        if (!row) {
          send("error", "Job vanished from DB (likely pruned)");
          break;
        }
        // Newly accumulated bytes — replay only the delta.
        if (row.html_accumulated.length > lastSentLen) {
          send("html", row.html_accumulated.slice(lastSentLen));
          lastSentLen = row.html_accumulated.length;
        }
        if (row.status === "complete") {
          if (row.summary) send("summary", row.summary);
          send("done", "");
          break;
        }
        if (row.status === "error") {
          send("error", row.error_msg || "gen failed");
          break;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }

      finish();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
