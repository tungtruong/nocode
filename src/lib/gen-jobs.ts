// Background generation job store — persists /api/chat output as it streams
// so clients can drop and reconnect without losing the in-progress HTML.
//
// Lifecycle:
//   1. POST /api/chat → createJob() returns a uuid; client gets it via the
//      `\x1Ejob <id>\n` progress event before generation starts.
//   2. Inside the route handler, every ~2s we call appendHtml() with the
//      newly accumulated characters (debounced — write traffic stays small).
//   3. On stream end, finishJob() flips status to 'complete' and saves the
//      summary + plan JSON; on error finishJobError() captures the message.
//   4. If the client disconnects mid-stream, the route handler keeps going
//      (we don't pass the abort signal through to the AI call). Final state
//      lands in the DB regardless.
//   5. A separate /api/chat/resume/<jobId> endpoint reads the row and
//      streams new chunks via SSE so the client can reconnect.
//   6. Rows older than 24h with status='complete'|'error' are pruned by
//      pruneOldJobs() — called opportunistically on every createJob().

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";

export type GenJobStatus = "streaming" | "complete" | "error";

export interface GenJob {
  id: string;
  user_email: string;
  project_id: string | null;
  status: GenJobStatus;
  html_accumulated: string;
  plan_json: string | null;
  summary: string | null;
  error_msg: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function createJob(userEmail: string, projectId?: string | null): string {
  const id = `j_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  getDb()
    .prepare(
      "INSERT INTO gen_jobs (id, user_email, project_id, status) VALUES (?, ?, ?, 'streaming')",
    )
    .run(id, userEmail.toLowerCase(), projectId ?? null);
  // Opportunistic prune — keeps the table from growing without a cron job.
  pruneOldJobs();
  return id;
}

/**
 * Overwrite html_accumulated. We replace the whole blob rather than appending
 * fragments because the route handler already buffers locally — a full
 * overwrite keeps the DB consistent even if the previous write was partial.
 * Cheap on better-sqlite3 (~0.5ms for ~50KB blobs).
 */
export function setHtml(id: string, html: string): void {
  getDb()
    .prepare("UPDATE gen_jobs SET html_accumulated = ?, updated_at = datetime('now') WHERE id = ?")
    .run(html, id);
}

/** Optional intermediate state — used to push the orchestrator plan into the
 *  job row so a resuming client gets the banner back. */
export function setPlan(id: string, planJson: string): void {
  getDb()
    .prepare("UPDATE gen_jobs SET plan_json = ?, updated_at = datetime('now') WHERE id = ?")
    .run(planJson, id);
}

export function finishJob(
  id: string,
  finalHtml: string,
  summary?: string,
): void {
  getDb()
    .prepare(
      `UPDATE gen_jobs SET
         html_accumulated = ?,
         summary = ?,
         status = 'complete',
         updated_at = datetime('now'),
         completed_at = datetime('now')
       WHERE id = ?`,
    )
    .run(finalHtml, summary ?? null, id);
}

export function finishJobError(id: string, errorMsg: string): void {
  getDb()
    .prepare(
      `UPDATE gen_jobs SET
         status = 'error',
         error_msg = ?,
         updated_at = datetime('now'),
         completed_at = datetime('now')
       WHERE id = ?`,
    )
    .run(errorMsg.slice(0, 1000), id);
}

export function getJob(id: string): GenJob | null {
  const row = getDb()
    .prepare("SELECT * FROM gen_jobs WHERE id = ?")
    .get(id) as GenJob | undefined;
  return row ?? null;
}

/**
 * Prune finished jobs older than 24h. Cheap — single DELETE indexed on
 * updated_at. Called from createJob() so we don't need a cron.
 *
 * We KEEP streaming jobs even if old (>24h) — if a job has been stuck in
 * 'streaming' for a day something went really wrong, and finishStaleStreamingJobs()
 * below handles those separately.
 */
export function pruneOldJobs(): number {
  const result = getDb()
    .prepare(
      `DELETE FROM gen_jobs
       WHERE status IN ('complete', 'error')
         AND updated_at < datetime('now', '-24 hours')`,
    )
    .run();
  return result.changes;
}

/**
 * Mark any 'streaming' job that hasn't been touched in 10 min as errored.
 * Defends against a server crash mid-gen leaving zombie jobs that clients
 * would otherwise wait on forever.
 */
export function finishStaleStreamingJobs(): number {
  const result = getDb()
    .prepare(
      `UPDATE gen_jobs SET
         status = 'error',
         error_msg = 'Server lost connection mid-gen (server restart or timeout)',
         updated_at = datetime('now'),
         completed_at = datetime('now')
       WHERE status = 'streaming'
         AND updated_at < datetime('now', '-10 minutes')`,
    )
    .run();
  return result.changes;
}
