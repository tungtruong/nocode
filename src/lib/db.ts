import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

let _db: Database.Database | null = null;

function dbPath() {
  return path.join(process.cwd(), "data", "app.sqlite");
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  // WAL = better concurrency (multiple readers, single writer); foreign_keys for cascades.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  importLegacyJson(db);
  _db = db;
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usage (
      user_email TEXT NOT NULL COLLATE NOCASE,
      period TEXT NOT NULL,             -- YYYY-MM (UTC)
      tokens_used INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_email, period)
    );

    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL COLLATE NOCASE,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS apps_user_idx ON apps(user_email, created_at DESC);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL COLLATE NOCASE,
      app_name TEXT NOT NULL,
      msgs_json TEXT NOT NULL,
      html TEXT NOT NULL,
      url TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_email, updated_at DESC);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Invitation codes that unlock paid tiers without going through Stripe.
    -- benefit_type:
    --   'free_pro'  → bumps tier to pro for benefit_value days
    --   'free_team' → bumps tier to team for benefit_value days
    -- Set max_redemptions = 1 for one-shot personal codes, higher for campaigns.
    CREATE TABLE IF NOT EXISTS invitation_codes (
      code TEXT PRIMARY KEY COLLATE NOCASE,
      benefit_type TEXT NOT NULL,
      benefit_value INTEGER NOT NULL,
      max_redemptions INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per (user, code) redemption — prevents the same user from
    -- redeeming the same code twice and gives us a paper trail.
    CREATE TABLE IF NOT EXISTS redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE,
      user_email TEXT NOT NULL COLLATE NOCASE,
      redeemed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(code, user_email)
    );
  `);

  // ALTER for tables that pre-existed before the `tier` column was introduced.
  // SQLite has no IF NOT EXISTS on ALTER, so we sniff PRAGMA table_info first.
  const cols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has("tier")) {
    db.exec("ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'");
  }
  // Stripe linkage. Nullable so users without a paid plan have empty columns.
  if (!has("stripe_customer_id")) {
    db.exec("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT");
  }
  if (!has("stripe_subscription_id")) {
    db.exec("ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT");
  }
  if (!has("subscription_status")) {
    // active | trialing | past_due | canceled | incomplete | null
    db.exec("ALTER TABLE users ADD COLUMN subscription_status TEXT");
  }
  if (!has("subscription_renews_at")) {
    db.exec("ALTER TABLE users ADD COLUMN subscription_renews_at TEXT");
  }
}

// One-time import of the old JSON files into SQLite. Marked done in `meta`
// so it never re-runs (and won't clobber DB writes after migration).
function importLegacyJson(db: Database.Database) {
  const done = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get("legacy_json_imported") as { value: string } | undefined;
  if (done?.value === "1") return;

  const dataDir = path.join(process.cwd(), "data");
  const appsPath = path.join(dataDir, "apps.json");
  const projectsPath = path.join(dataDir, "projects.json");

  const importApps = db.prepare(
    "INSERT OR IGNORE INTO apps (id, user_email, title, url, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const importProjects = db.prepare(
    "INSERT OR IGNORE INTO projects (id, user_email, app_name, msgs_json, html, url, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  db.transaction(() => {
    try {
      const raw = fs.readFileSync(appsPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, { user_email: string; title: string; url: string; created_at: string }>;
      for (const [id, meta] of Object.entries(parsed)) {
        importApps.run(id, meta.user_email, meta.title, meta.url, meta.created_at);
      }
    } catch { /* no apps.json — fine */ }

    try {
      const raw = fs.readFileSync(projectsPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, { user_email: string; appName: string; msgs: unknown[]; html: string; url: string; updated_at: string }>;
      for (const [id, data] of Object.entries(parsed)) {
        importProjects.run(
          id,
          data.user_email,
          data.appName,
          JSON.stringify(data.msgs || []),
          data.html || "",
          data.url || "",
          data.updated_at
        );
      }
    } catch { /* no projects.json — fine */ }

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run("legacy_json_imported", "1");
  })();
}
