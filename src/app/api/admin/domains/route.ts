// GET /api/admin/domains → list every deployed app (subdomain, owner, when).
// Owner-only.

import { NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { getDb } from "@/lib/db";

const ADMIN_EMAIL = "truongthanhtung@gmail.com";

export async function GET() {
  let session;
  try { session = await requireSession(); } catch { return authError(); }
  if (session.email.toLowerCase() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

  // Apps + their owning project's mode + edit_count (joined; project may not
  // exist for legacy apps, hence LEFT JOIN).
  const apps = db
    .prepare(`
      SELECT a.id, a.slug, a.title, a.user_email, a.created_at,
             p.mode AS mode, p.edit_count AS edit_count
      FROM apps a
      LEFT JOIN projects p ON p.id = a.id
      ORDER BY a.created_at DESC
    `)
    .all();

  // Per-user totals so we can spot heavy users.
  const perUser = db
    .prepare(`
      SELECT user_email,
             COUNT(*) AS deploys,
             (SELECT COUNT(*) FROM projects WHERE user_email = apps.user_email) AS projects
      FROM apps
      GROUP BY user_email
      ORDER BY deploys DESC
    `)
    .all();

  const totals = {
    apps: (db.prepare("SELECT COUNT(*) AS n FROM apps").get() as { n: number }).n,
    projects: (db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n,
    users: (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n,
  };

  return NextResponse.json({ apps, perUser, totals });
}
