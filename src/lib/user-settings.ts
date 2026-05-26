// Per-user flat key/value settings — see `user_settings` table in db.ts.
//
// Current keys in use:
//   - model_override  → forces a specific LLM model for all calls from
//                       this account. Values: "" (default platform model),
//                       "gpt-4.1-mini", "gpt-4o-mini", or any other model
//                       string the upstream providers accept.

import { getDb } from "@/lib/db";

export function getUserSetting(userEmail: string, key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM user_settings WHERE user_email = ? AND key = ?")
    .get(userEmail.toLowerCase(), key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setUserSetting(userEmail: string, key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO user_settings (user_email, key, value, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_email, key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    )
    .run(userEmail.toLowerCase(), key, value);
}

export function deleteUserSetting(userEmail: string, key: string): void {
  getDb()
    .prepare("DELETE FROM user_settings WHERE user_email = ? AND key = ?")
    .run(userEmail.toLowerCase(), key);
}

/** Returns the model override for this user, or null to use platform default. */
export function getUserModelOverride(userEmail: string | undefined | null): string | null {
  if (!userEmail) return null;
  const v = getUserSetting(userEmail, "model_override");
  return v && v.trim() ? v.trim() : null;
}
