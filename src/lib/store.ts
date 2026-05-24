import fs from "fs/promises";
import path from "path";
import { getDb } from "@/lib/db";

export interface AppMeta {
  user_email: string;
  title: string;
  url: string;
  created_at: string;
}

// Safe id: only [a-zA-Z0-9_-], length 6-64. Prevents path traversal in deleteApp.
function isSafeId(id: string): boolean {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{6,64}$/.test(id);
}

export async function addApp(id: string, meta: AppMeta): Promise<void> {
  if (!isSafeId(id)) throw new Error("Invalid app id");
  getDb()
    .prepare("INSERT OR REPLACE INTO apps (id, user_email, title, url, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, meta.user_email, meta.title, meta.url, meta.created_at);
}

export async function getAppsByUser(email: string): Promise<{ id: string; meta: AppMeta }[]> {
  const rows = getDb()
    .prepare("SELECT id, user_email, title, url, created_at FROM apps WHERE user_email = ? ORDER BY created_at DESC")
    .all(email) as Array<{ id: string; user_email: string; title: string; url: string; created_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    meta: { user_email: r.user_email, title: r.title, url: r.url, created_at: r.created_at },
  }));
}

export async function getApp(id: string): Promise<AppMeta | null> {
  if (!isSafeId(id)) return null;
  const r = getDb()
    .prepare("SELECT user_email, title, url, created_at FROM apps WHERE id = ?")
    .get(id) as { user_email: string; title: string; url: string; created_at: string } | undefined;
  return r ? { user_email: r.user_email, title: r.title, url: r.url, created_at: r.created_at } : null;
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
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO projects (id, user_email, app_name, msgs_json, html, url, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      projectId,
      userEmail,
      data.appName,
      JSON.stringify(data.msgs || []),
      data.html || "",
      data.url || "",
      updatedAt
    );
}

export async function getProjectsByUser(
  email: string
): Promise<{ id: string; data: ProjectData }[]> {
  const rows = getDb()
    .prepare(
      "SELECT id, user_email, app_name, msgs_json, html, url, updated_at FROM projects WHERE user_email = ? ORDER BY updated_at DESC"
    )
    .all(email) as Array<{
      id: string;
      user_email: string;
      app_name: string;
      msgs_json: string;
      html: string;
      url: string;
      updated_at: string;
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

export async function deleteProject(id: string, userEmail: string): Promise<boolean> {
  if (!isSafeProjectId(id)) return false;
  const result = getDb()
    .prepare("DELETE FROM projects WHERE id = ? AND user_email = ?")
    .run(id, userEmail);
  return result.changes > 0;
}
