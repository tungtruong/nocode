// Read/write helpers for the `user_integrations` and `app_data_sources` tables.
// Encryption layer (AES-256-GCM) is transparent to callers — pass plaintext
// tokens in, get plaintext back out.

import { getDb } from "@/lib/db";
import { encrypt, decrypt, encryptOrNull, decryptOrNull } from "@/lib/crypto";

export type IntegrationProvider = "google_sheets" | "google_drive";

export interface Integration {
  user_email: string;
  provider: IntegrationProvider;
  refresh_token: string;
  access_token: string | null;
  expires_at: string | null;     // ISO timestamp
  scope: string;
  account_email: string | null;
  created_at: string;
  updated_at: string;
}

export function saveIntegration(input: {
  user_email: string;
  provider: IntegrationProvider;
  refresh_token: string;
  access_token?: string | null;
  expires_at?: string | null;
  scope: string;
  account_email?: string | null;
}): void {
  const now = new Date().toISOString();
  const refreshEnc = encrypt(input.refresh_token);
  const accessEnc = encryptOrNull(input.access_token);
  getDb()
    .prepare(
      `INSERT INTO user_integrations
         (user_email, provider, refresh_token_enc, access_token_enc, expires_at, scope, account_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_email, provider) DO UPDATE SET
         refresh_token_enc = excluded.refresh_token_enc,
         access_token_enc = excluded.access_token_enc,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         account_email = excluded.account_email,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.user_email,
      input.provider,
      refreshEnc,
      accessEnc,
      input.expires_at ?? null,
      input.scope,
      input.account_email ?? null,
      now,
      now,
    );
}

export function getIntegration(
  user_email: string,
  provider: IntegrationProvider,
): Integration | null {
  const row = getDb()
    .prepare(
      `SELECT user_email, provider, refresh_token_enc, access_token_enc, expires_at, scope, account_email, created_at, updated_at
       FROM user_integrations
       WHERE user_email = ? AND provider = ?`,
    )
    .get(user_email, provider) as
      | {
          user_email: string;
          provider: IntegrationProvider;
          refresh_token_enc: string;
          access_token_enc: string | null;
          expires_at: string | null;
          scope: string;
          account_email: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
  if (!row) return null;
  return {
    user_email: row.user_email,
    provider: row.provider,
    refresh_token: decrypt(row.refresh_token_enc),
    access_token: decryptOrNull(row.access_token_enc),
    expires_at: row.expires_at,
    scope: row.scope,
    account_email: row.account_email,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Update only the access_token + expires_at fields. Called after a token
// refresh; the refresh_token typically stays the same (Google rotates it
// rarely; when it does, the new value comes back in the refresh response
// and we should call saveIntegration() with both).
export function updateAccessToken(
  user_email: string,
  provider: IntegrationProvider,
  access_token: string,
  expires_at: string,
): void {
  const enc = encrypt(access_token);
  getDb()
    .prepare(
      `UPDATE user_integrations
       SET access_token_enc = ?, expires_at = ?, updated_at = ?
       WHERE user_email = ? AND provider = ?`,
    )
    .run(enc, expires_at, new Date().toISOString(), user_email, provider);
}

export function deleteIntegration(user_email: string, provider: IntegrationProvider): boolean {
  const r = getDb()
    .prepare("DELETE FROM user_integrations WHERE user_email = ? AND provider = ?")
    .run(user_email, provider);
  return r.changes > 0;
}

export function listIntegrations(user_email: string): Array<{
  provider: IntegrationProvider;
  account_email: string | null;
  scope: string;
  updated_at: string;
}> {
  return getDb()
    .prepare(
      `SELECT provider, account_email, scope, updated_at
       FROM user_integrations WHERE user_email = ? ORDER BY provider`,
    )
    .all(user_email) as Array<{
      provider: IntegrationProvider;
      account_email: string | null;
      scope: string;
      updated_at: string;
    }>;
}

// === app_data_sources ===

export type DataSourceKind = "sheet" | "drive_folder";

export interface AppDataSource<TConfig = Record<string, unknown>> {
  app_id: string;
  user_email: string;
  kind: DataSourceKind;
  provider: IntegrationProvider;
  config: TConfig;
  created_at: string;
  updated_at: string;
}

export interface SheetConfig {
  spreadsheetId: string;
  sheetName: string;
  headerRow?: number; // defaults to 1
}

export function saveAppDataSource(input: {
  app_id: string;
  user_email: string;
  kind: DataSourceKind;
  provider: IntegrationProvider;
  config: Record<string, unknown>;
}): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO app_data_sources
         (app_id, user_email, kind, provider, source_config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(app_id, kind) DO UPDATE SET
         provider = excluded.provider,
         source_config_json = excluded.source_config_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.app_id,
      input.user_email,
      input.kind,
      input.provider,
      JSON.stringify(input.config),
      now,
      now,
    );
}

export function getAppDataSource<TConfig = Record<string, unknown>>(
  app_id: string,
  kind: DataSourceKind = "sheet",
): AppDataSource<TConfig> | null {
  const row = getDb()
    .prepare(
      `SELECT app_id, user_email, kind, provider, source_config_json, created_at, updated_at
       FROM app_data_sources WHERE app_id = ? AND kind = ?`,
    )
    .get(app_id, kind) as
      | {
          app_id: string;
          user_email: string;
          kind: DataSourceKind;
          provider: IntegrationProvider;
          source_config_json: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
  if (!row) return null;
  let config: TConfig;
  try {
    config = JSON.parse(row.source_config_json) as TConfig;
  } catch {
    return null;
  }
  return {
    app_id: row.app_id,
    user_email: row.user_email,
    kind: row.kind,
    provider: row.provider,
    config,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function deleteAppDataSource(app_id: string, kind: DataSourceKind = "sheet"): boolean {
  const r = getDb()
    .prepare("DELETE FROM app_data_sources WHERE app_id = ? AND kind = ?")
    .run(app_id, kind);
  return r.changes > 0;
}
