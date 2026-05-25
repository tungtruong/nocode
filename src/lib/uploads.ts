// SQLite-side bookkeeping for files uploaded to R2. Keeping a mirror in
// SQLite (rather than just listing the R2 bucket) gives us:
//  - O(1) per-user storage quota check (sum size_bytes WHERE user_email=?)
//  - per-app cleanup when an app is deleted (DELETE WHERE app_id=?)
//  - dashboard listings without paying R2 LIST charges
//  - owner-of-file check before serving DELETE — R2 has no concept of
//    "who uploaded this object", it's just bytes.

import { getDb } from "@/lib/db";

export interface UploadRow {
  key: string;
  user_email: string;
  app_id: string;
  size_bytes: number;
  mime: string;
  original_name: string | null;
  uploader_uid: string | null;
  created_at: string;
}

export function sumUploadBytes(userEmail: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM user_uploads WHERE user_email = ?")
    .get(userEmail.toLowerCase()) as { total: number };
  return row.total;
}

export function insertUpload(row: Omit<UploadRow, "created_at">): void {
  getDb()
    .prepare(
      `INSERT INTO user_uploads (key, user_email, app_id, size_bytes, mime, original_name, uploader_uid)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.key,
      row.user_email.toLowerCase(),
      row.app_id,
      row.size_bytes,
      row.mime,
      row.original_name,
      row.uploader_uid,
    );
}

export function getUpload(key: string): UploadRow | null {
  const row = getDb()
    .prepare("SELECT * FROM user_uploads WHERE key = ?")
    .get(key) as UploadRow | undefined;
  return row ?? null;
}

export function deleteUploadRow(key: string): void {
  getDb().prepare("DELETE FROM user_uploads WHERE key = ?").run(key);
}

export function listUploadsForOwner(
  userEmail: string,
  appId?: string,
  limit = 200,
): UploadRow[] {
  const db = getDb();
  if (appId) {
    return db
      .prepare(
        "SELECT * FROM user_uploads WHERE user_email = ? AND app_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(userEmail.toLowerCase(), appId, limit) as UploadRow[];
  }
  return db
    .prepare(
      "SELECT * FROM user_uploads WHERE user_email = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(userEmail.toLowerCase(), limit) as UploadRow[];
}

export function listUploadKeysForApp(appId: string): string[] {
  return (getDb()
    .prepare("SELECT key FROM user_uploads WHERE app_id = ?")
    .all(appId) as Array<{ key: string }>).map((r) => r.key);
}
