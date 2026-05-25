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

    -- Affiliate commissions. One row per Stripe invoice that's paid by a
    -- referred user. UNIQUE on stripe_invoice_id makes the webhook safely
    -- idempotent (Stripe re-fires events sometimes).
    CREATE TABLE IF NOT EXISTS commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_email TEXT NOT NULL COLLATE NOCASE,
      referred_email TEXT NOT NULL COLLATE NOCASE,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      stripe_invoice_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at TEXT
    );
    CREATE INDEX IF NOT EXISTS commissions_referrer_idx
      ON commissions(referrer_email, created_at DESC);
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
  // Referrals
  if (!has("referral_code")) {
    db.exec("ALTER TABLE users ADD COLUMN referral_code TEXT");
    // UNIQUE constraint via index (ALTER TABLE in SQLite can't add UNIQUE col)
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_idx ON users(referral_code) WHERE referral_code IS NOT NULL");
  }
  if (!has("referred_by_email")) {
    db.exec("ALTER TABLE users ADD COLUMN referred_by_email TEXT");
  }

  // Apps: optional vanity slug for *.justvibe.me routing.
  const appCols = db.prepare("PRAGMA table_info(apps)").all() as Array<{ name: string }>;
  if (!appCols.some((c) => c.name === "slug")) {
    db.exec("ALTER TABLE apps ADD COLUMN slug TEXT");
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS apps_slug_idx ON apps(slug) WHERE slug IS NOT NULL"
    );
  }

  // Projects: app mode (web_app, qr_menu, wedding, landing, pitch_deck,
  // cv_resume). Default 'web_app' so existing rows keep current behavior.
  const projCols = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  if (!projCols.some((c) => c.name === "mode")) {
    db.exec("ALTER TABLE projects ADD COLUMN mode TEXT NOT NULL DEFAULT 'web_app'");
  }
  // Counts edits per project so we can spot templates that need more iteration.
  if (!projCols.some((c) => c.name === "edit_count")) {
    db.exec("ALTER TABLE projects ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0");
  }

  // Template usage telemetry. One row per generation (chat or edit) — tracks
  // mode, whether it ended in a deploy, and whether placeholders leaked.
  // Aggregated by /admin/templates.
  db.exec(`
    CREATE TABLE IF NOT EXISTS template_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL COLLATE NOCASE,
      project_id TEXT,
      mode TEXT NOT NULL,
      kind TEXT NOT NULL,            -- 'generate' | 'edit' | 'deploy'
      placeholder_leak INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS template_usage_mode_idx ON template_usage(mode, kind, created_at);
  `);

  // User-reported template feedback. UI shows a "👎 Mẫu không phù hợp" button
  // under preview. Surfaced in admin view, sort desc by count to pick the
  // worst-performing template to revise next.
  db.exec(`
    CREATE TABLE IF NOT EXISTS template_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL COLLATE NOCASE,
      project_id TEXT,
      mode TEXT NOT NULL,
      reason TEXT NOT NULL,          -- 'missing' | 'wrong_industry' | 'ugly' | 'other'
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS template_feedback_mode_idx ON template_feedback(mode, created_at);
  `);

  // One-time token packs. Pending row created when checkout starts; status
  // flips to 'completed' on PayPal PAYMENT.CAPTURE.COMPLETED webhook (or via
  // the synchronous capture call from /api/topup/capture). Status 'failed' is
  // set if capture errors out so we don't leak quota.
  //
  // tokens_added counts toward the user's current `period` quota (YYYY-MM).
  // Topups expire at period rollover by design — same window as the sub.
  db.exec(`
    CREATE TABLE IF NOT EXISTS topups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL COLLATE NOCASE,
      period TEXT NOT NULL,            -- 'YYYY-MM'
      pack_id TEXT NOT NULL,           -- 'small' | 'medium' | 'large'
      tokens_added INTEGER NOT NULL,
      price_usd REAL NOT NULL,
      paypal_order_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,            -- 'pending' | 'completed' | 'failed'
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS topups_user_period_idx ON topups(user_email, period, status);
  `);

  // Stored OAuth credentials for third-party services the user has connected
  // (Google Sheets/Drive, later: Notion, Airtable, etc). Tokens are encrypted
  // at rest with INTEGRATION_VAULT_KEY (AES-256-GCM) — see src/lib/crypto.ts.
  //
  // One row per (user_email, provider) pair — re-connecting overwrites the
  // existing row to refresh tokens + scope.
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL COLLATE NOCASE,
      provider TEXT NOT NULL,           -- 'google_sheets' | 'google_drive' | future...
      refresh_token_enc TEXT NOT NULL,  -- AES-256-GCM ciphertext (base64)
      access_token_enc TEXT,            -- short-lived, may be null + lazily refreshed
      expires_at TEXT,                  -- ISO timestamp when access_token expires
      scope TEXT NOT NULL,              -- space-separated scopes granted
      account_email TEXT,               -- the Google account email (may differ from user_email)
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_email, provider)
    );
    CREATE INDEX IF NOT EXISTS user_integrations_user_idx ON user_integrations(user_email);
  `);

  // Fallback storage for form submissions when the app's owner hasn't
  // connected Google Sheets yet. Rows here are temporary — the dashboard
  // nudges the owner to connect + migrate. Kept 30 days max (cron later).
  db.exec(`
    CREATE TABLE IF NOT EXISTS form_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS form_submissions_app_idx ON form_submissions(app_id, created_at DESC);
  `);

  // Per-app data source binding: which integration + which sheet/file/folder
  // is "the database" for this app. One row per (app_id, kind).
  //
  // source_config_json holds provider-specific config:
  //   For sheets: { spreadsheetId, sheetName, headerRow }
  //   For drive:  { folderId }
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_data_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL,             -- matches projects.id / apps.id
      user_email TEXT NOT NULL COLLATE NOCASE,
      kind TEXT NOT NULL,               -- 'sheet' | 'drive_folder' | future...
      provider TEXT NOT NULL,           -- 'google_sheets' | 'google_drive'
      source_config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(app_id, kind)
    );
    CREATE INDEX IF NOT EXISTS app_data_sources_user_idx ON app_data_sources(user_email);
  `);
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
