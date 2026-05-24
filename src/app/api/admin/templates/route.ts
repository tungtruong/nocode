// GET /api/admin/templates → per-mode aggregate metrics for /admin/templates.
// Owner-only (truongthanhtung@gmail.com).

import { NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { APP_MODES } from "@/lib/modes";

const ADMIN_EMAIL = "truongthanhtung@gmail.com";

export async function GET() {
  let session;
  try { session = await requireSession(); } catch { return authError(); }
  if (session.email.toLowerCase() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

  // Aggregates per mode. SQLite returns 0 / null for modes with no rows yet.
  const usageRows = db
    .prepare(
      `SELECT mode,
              SUM(CASE WHEN kind='generate' THEN 1 ELSE 0 END) AS generates,
              SUM(CASE WHEN kind='edit'     THEN 1 ELSE 0 END) AS edits,
              SUM(CASE WHEN kind='deploy'   THEN 1 ELSE 0 END) AS deploys,
              SUM(placeholder_leak) AS placeholder_leaks
       FROM template_usage
       GROUP BY mode`
    )
    .all() as Array<{ mode: string; generates: number; edits: number; deploys: number; placeholder_leaks: number }>;

  const feedbackRows = db
    .prepare(
      `SELECT mode,
              COUNT(*) AS total_flags,
              SUM(CASE WHEN reason='missing'         THEN 1 ELSE 0 END) AS f_missing,
              SUM(CASE WHEN reason='wrong_industry' THEN 1 ELSE 0 END) AS f_wrong,
              SUM(CASE WHEN reason='ugly'           THEN 1 ELSE 0 END) AS f_ugly,
              SUM(CASE WHEN reason='other'          THEN 1 ELSE 0 END) AS f_other
       FROM template_feedback
       GROUP BY mode`
    )
    .all() as Array<{ mode: string; total_flags: number; f_missing: number; f_wrong: number; f_ugly: number; f_other: number }>;

  const editCountRows = db
    .prepare(
      `SELECT mode,
              AVG(edit_count)        AS avg_edits,
              COUNT(*)               AS projects,
              SUM(CASE WHEN url <> '' THEN 1 ELSE 0 END) AS deployed_projects
       FROM projects
       GROUP BY mode`
    )
    .all() as Array<{ mode: string; avg_edits: number | null; projects: number; deployed_projects: number }>;

  const recentFeedback = db
    .prepare(
      `SELECT id, mode, reason, note, created_at
       FROM template_feedback
       ORDER BY created_at DESC
       LIMIT 25`
    )
    .all();

  const byMode = new Map<string, Record<string, number | string>>();
  for (const id of Object.keys(APP_MODES)) {
    byMode.set(id, {
      mode: id,
      generates: 0, edits: 0, deploys: 0, placeholder_leaks: 0,
      total_flags: 0, f_missing: 0, f_wrong: 0, f_ugly: 0, f_other: 0,
      projects: 0, deployed_projects: 0, avg_edits: 0,
    });
  }
  for (const r of usageRows) {
    const m = byMode.get(r.mode); if (!m) continue;
    Object.assign(m, r);
  }
  for (const r of feedbackRows) {
    const m = byMode.get(r.mode); if (!m) continue;
    Object.assign(m, r);
  }
  for (const r of editCountRows) {
    const m = byMode.get(r.mode); if (!m) continue;
    m.projects = r.projects;
    m.deployed_projects = r.deployed_projects;
    m.avg_edits = r.avg_edits ?? 0;
  }

  return NextResponse.json({
    modes: Array.from(byMode.values()),
    recentFeedback,
  });
}
