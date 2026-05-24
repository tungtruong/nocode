import fs from "fs/promises";
import path from "path";

export interface AppMeta {
  user_email: string;
  title: string;
  url: string;
  created_at: string;
}

type Store = Record<string, AppMeta>;

let _cache: Store | undefined = undefined;

function storePath() {
  return path.join(process.cwd(), "data", "apps.json");
}

async function readStore(): Promise<Store> {
  if (_cache !== undefined) return _cache;
  try {
    const raw = await fs.readFile(storePath(), "utf-8");
    _cache = JSON.parse(raw) as Store;
  } catch {
    _cache = {};
  }
  return _cache;
}

async function writeStore(): Promise<void> {
  if (_cache === undefined) return;
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify(_cache, null, 2), "utf-8");
}

export async function addApp(id: string, meta: AppMeta): Promise<void> {
  const s = await readStore();
  s[id] = meta;
  await writeStore();
}

export async function getAppsByUser(email: string): Promise<{ id: string; meta: AppMeta }[]> {
  const s = await readStore();
  return Object.entries(s)
    .filter(([, m]) => m.user_email === email)
    .map(([id, meta]) => ({ id, meta }))
    .sort((a, b) => new Date(b.meta.created_at).getTime() - new Date(a.meta.created_at).getTime());
}

export async function getApp(id: string): Promise<AppMeta | null> {
  const s = await readStore();
  return s[id] ?? null;
}

export async function deleteApp(id: string, userEmail: string): Promise<boolean> {
  const s = await readStore();
  const meta = s[id];
  if (!meta || meta.user_email !== userEmail) return false;
  delete s[id];
  await writeStore();

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

type ProjectStore = Record<string, ProjectData>;

let _projectCache: ProjectStore | undefined = undefined;

function projectStorePath() {
  return path.join(process.cwd(), "data", "projects.json");
}

async function readProjectStore(): Promise<ProjectStore> {
  if (_projectCache !== undefined) return _projectCache;
  try {
    const raw = await fs.readFile(projectStorePath(), "utf-8");
    _projectCache = JSON.parse(raw) as ProjectStore;
  } catch {
    _projectCache = {};
  }
  return _projectCache;
}

async function writeProjectStore(): Promise<void> {
  if (_projectCache === undefined) return;
  await fs.mkdir(path.dirname(projectStorePath()), { recursive: true });
  await fs.writeFile(projectStorePath(), JSON.stringify(_projectCache, null, 2), "utf-8");
}

export async function saveProject(
  projectId: string,
  userEmail: string,
  data: Omit<ProjectData, "user_email" | "updated_at">
): Promise<void> {
  const s = await readProjectStore();
  s[projectId] = { ...data, user_email: userEmail, updated_at: new Date().toISOString() };
  await writeProjectStore();
}

export async function getProjectsByUser(
  email: string
): Promise<{ id: string; data: ProjectData }[]> {
  const s = await readProjectStore();
  return Object.entries(s)
    .filter(([, d]) => d.user_email === email)
    .map(([id, data]) => ({ id, data }))
    .sort((a, b) => new Date(b.data.updated_at).getTime() - new Date(a.data.updated_at).getTime());
}

export async function deleteProject(id: string, userEmail: string): Promise<boolean> {
  const s = await readProjectStore();
  if (!s[id] || s[id].user_email !== userEmail) return false;
  delete s[id];
  await writeProjectStore();
  return true;
}

