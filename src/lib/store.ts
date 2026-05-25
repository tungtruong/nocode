import fs from "fs/promises";
import path from "path";
import { getDb } from "@/lib/db";
import { DEFAULT_MODE, modeOf, type ModeId } from "@/lib/modes";

export interface AppMeta {
  user_email: string;
  title: string;
  url: string;
  created_at: string;
  slug?: string | null;
}

// Slug: 5-12 lowercase alphanumerics + dashes, no leading/trailing dash.
// We carve out 'www', 'app', 'apps', 'api' so they can't be claimed by users
// and collide with platform routes if we ever add subdomains for them.
const RESERVED_SLUGS = new Set(["www", "app", "apps", "api", "admin", "dashboard", "auth", "static", "assets"]);
function isValidSlug(s: string): boolean {
  if (!s || s.length < 3 || s.length > 32) return false;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) return false;
  if (RESERVED_SLUGS.has(s)) return false;
  return true;
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

// Pick a unique slug: try title-derived, fall back to title + random suffix.
// Caller already holds enough context (title + a fresh app id) — we just need
// to make sure no other app owns the same slug.
export function pickSlug(title: string, fallbackId: string): string {
  const base = slugifyTitle(title) || fallbackId.slice(0, 6);
  if (isValidSlug(base) && !appBySlug(base)) return base;
  // Append a 4-char suffix from the id until we hit a free one (very few tries).
  for (let i = 0; i < 6; i++) {
    const suffix = fallbackId.slice(i * 2, i * 2 + 4) || Math.random().toString(36).slice(2, 6);
    const candidate = `${base.slice(0, 24)}-${suffix}`.toLowerCase();
    if (isValidSlug(candidate) && !appBySlug(candidate)) return candidate;
  }
  // Last resort.
  return fallbackId.slice(0, 8);
}

export function appBySlug(slug: string): { id: string; meta: AppMeta } | null {
  if (!isValidSlug(slug)) return null;
  const r = getDb()
    .prepare("SELECT id, user_email, title, url, created_at, slug FROM apps WHERE slug = ?")
    .get(slug) as { id: string; user_email: string; title: string; url: string; created_at: string; slug: string | null } | undefined;
  if (!r) return null;
  return {
    id: r.id,
    meta: { user_email: r.user_email, title: r.title, url: r.url, created_at: r.created_at, slug: r.slug },
  };
}

// Update slug for an app (rename). Returns true if changed; false on
// conflict or invalid input. Caller should check ownership separately.
export function setAppSlug(id: string, slug: string): boolean {
  if (!isValidSlug(slug)) return false;
  if (!isSafeId(id)) return false;
  try {
    const r = getDb().prepare("UPDATE apps SET slug = ? WHERE id = ?").run(slug, id);
    return r.changes > 0;
  } catch {
    // UNIQUE collision on slug
    return false;
  }
}

// Safe id: only [a-zA-Z0-9_-], length 6-64. Prevents path traversal in deleteApp.
function isSafeId(id: string): boolean {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{6,64}$/.test(id);
}

export async function addApp(id: string, meta: AppMeta): Promise<void> {
  if (!isSafeId(id)) throw new Error("Invalid app id");
  // Allocate a vanity slug on first save so the deployed URL can use
  // <slug>.<APPS_DOMAIN> immediately. Existing apps keep their old slug
  // (INSERT OR REPLACE would clobber it otherwise — we re-read first).
  let slug = meta.slug ?? null;
  if (!slug) {
    const existing = getDb().prepare("SELECT slug FROM apps WHERE id = ?").get(id) as { slug: string | null } | undefined;
    slug = existing?.slug ?? pickSlug(meta.title, id);
  }
  getDb()
    .prepare("INSERT OR REPLACE INTO apps (id, user_email, title, url, created_at, slug) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, meta.user_email, meta.title, meta.url, meta.created_at, slug);
}

export async function getAppsByUser(email: string): Promise<{ id: string; meta: AppMeta }[]> {
  const rows = getDb()
    .prepare("SELECT id, user_email, title, url, created_at, slug FROM apps WHERE user_email = ? ORDER BY created_at DESC")
    .all(email) as Array<{ id: string; user_email: string; title: string; url: string; created_at: string; slug: string | null }>;
  return rows.map((r) => ({
    id: r.id,
    meta: { user_email: r.user_email, title: r.title, url: r.url, created_at: r.created_at, slug: r.slug },
  }));
}

export async function getApp(id: string): Promise<AppMeta | null> {
  if (!isSafeId(id)) return null;
  const r = getDb()
    .prepare("SELECT user_email, title, url, created_at, slug FROM apps WHERE id = ?")
    .get(id) as { user_email: string; title: string; url: string; created_at: string; slug: string | null } | undefined;
  return r ? { user_email: r.user_email, title: r.title, url: r.url, created_at: r.created_at, slug: r.slug } : null;
}

export async function deleteApp(id: string, userEmail: string): Promise<boolean> {
  if (!isSafeId(id)) return false;
  const result = getDb()
    .prepare("DELETE FROM apps WHERE id = ? AND user_email = ?")
    .run(id, userEmail);
  if (result.changes === 0) return false;

  try {
    await fs.rm(path.join(process.cwd(), "public", "apps", id), { recursive: true, force: true });
  } catch {
    // ignore
  }
  return true;
}

// === PROJECTS (chat history + code) ===

export interface ProjectData {
  user_email: string;
  appName: string;
  msgs: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    html?: string;
    summary?: string;
  }>;
  html: string;
  url: string;
  updated_at: string;
  mode: ModeId;
}

function isSafeProjectId(id: string): boolean {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

export async function saveProject(
  projectId: string,
  userEmail: string,
  data: Omit<ProjectData, "user_email" | "updated_at">
): Promise<void> {
  if (!isSafeProjectId(projectId)) throw new Error("Invalid project id");
  const updatedAt = new Date().toISOString();
  const mode = modeOf(data.mode);
  // Preserve edit_count: INSERT OR REPLACE would reset it to default. Read
  // current value first, increment per save (each save = either initial create
  // or a meaningful edit checkpoint), then write back.
  const existing = getDb()
    .prepare("SELECT edit_count FROM projects WHERE id = ? AND user_email = ?")
    .get(projectId, userEmail) as { edit_count: number } | undefined;
  const editCount = existing ? existing.edit_count + 1 : 0;
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO projects (id, user_email, app_name, msgs_json, html, url, updated_at, mode, edit_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      projectId,
      userEmail,
      data.appName,
      JSON.stringify(data.msgs || []),
      data.html || "",
      data.url || "",
      updatedAt,
      mode,
      editCount,
    );
}

export async function getProjectsByUser(
  email: string
): Promise<{ id: string; data: ProjectData }[]> {
  const rows = getDb()
    .prepare(
      "SELECT id, user_email, app_name, msgs_json, html, url, updated_at, mode FROM projects WHERE user_email = ? ORDER BY updated_at DESC"
    )
    .all(email) as Array<{
      id: string;
      user_email: string;
      app_name: string;
      msgs_json: string;
      html: string;
      url: string;
      updated_at: string;
      mode: string | null;
    }>;
  return rows.map((r) => ({
    id: r.id,
    data: {
      user_email: r.user_email,
      appName: r.app_name,
      msgs: safeParseMsgs(r.msgs_json),
      html: r.html,
      url: r.url,
      updated_at: r.updated_at,
      mode: modeOf(r.mode),
    },
  }));
}

function safeParseMsgs(raw: string): ProjectData["msgs"] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Fetch one project owned by `userEmail` — used by /api/edit to load the saved
// mode so the system prompt stays aligned across turns.
export async function getProject(
  id: string,
  userEmail: string,
): Promise<ProjectData | null> {
  if (!isSafeProjectId(id)) return null;
  const r = getDb()
    .prepare(
      "SELECT user_email, app_name, msgs_json, html, url, updated_at, mode FROM projects WHERE id = ? AND user_email = ?"
    )
    .get(id, userEmail) as
      | { user_email: string; app_name: string; msgs_json: string; html: string; url: string; updated_at: string; mode: string | null }
      | undefined;
  if (!r) return null;
  return {
    user_email: r.user_email,
    appName: r.app_name,
    msgs: safeParseMsgs(r.msgs_json),
    html: r.html,
    url: r.url,
    updated_at: r.updated_at,
    mode: modeOf(r.mode),
  };
}

// Telemetry: one row per generation/edit/deploy. Reads aggregated by
// /admin/templates. Best-effort — failures are logged but don't break the flow.
export function logTemplateUsage(
  userEmail: string,
  projectId: string | null,
  mode: ModeId,
  kind: "generate" | "edit" | "deploy",
  placeholderLeak: boolean = false,
): void {
  try {
    getDb()
      .prepare(
        "INSERT INTO template_usage (user_email, project_id, mode, kind, placeholder_leak, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(userEmail, projectId, mode, kind, placeholderLeak ? 1 : 0, new Date().toISOString());
  } catch (e) {
    console.error("[telemetry] logTemplateUsage failed:", e);
  }
}

// Suppress unused-import warning for DEFAULT_MODE — kept for callers that want
// to compare to default in switch statements.
void DEFAULT_MODE;

// Count owned rows for tier-limit checks. Cheap (indexed by user_email).
export function countProjectsByUser(email: string): number {
  const r = getDb()
    .prepare("SELECT COUNT(*) AS n FROM projects WHERE user_email = ?")
    .get(email) as { n: number };
  return r.n;
}
export function countAppsByUser(email: string): number {
  const r = getDb()
    .prepare("SELECT COUNT(*) AS n FROM apps WHERE user_email = ?")
    .get(email) as { n: number };
  return r.n;
}

export async function deleteProject(id: string, userEmail: string): Promise<boolean> {
  if (!isSafeProjectId(id)) return false;
  const result = getDb()
    .prepare("DELETE FROM projects WHERE id = ? AND user_email = ?")
    .run(id, userEmail);
  return result.changes > 0;
}
