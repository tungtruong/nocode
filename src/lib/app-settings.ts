// Per-app owner-managed configuration. Right now this holds the VietQR
// recipient bank info — generated apps read it to render correct payment QRs
// without the AI ever seeing the owner's bank number. New settings keys
// (e.g. `branding`, `payment_paypal`, `email_from`) plug in by adding a
// new key string + typed accessor below.
//
// All settings are read+written ONLY through this module so the schema of
// `value_json` is centrally controlled.

import { getDb } from "@/lib/db";

export interface VietQrConfig {
  bankBin: string;       // "970436"
  accountNo: string;     // digits only
  accountName: string;   // display name, uppercase ASCII typical
}

type SettingKey = "payment_vietqr";

function readSetting<T>(appId: string, key: SettingKey): T | null {
  const row = getDb()
    .prepare("SELECT value_json FROM app_settings WHERE app_id = ? AND key = ?")
    .get(appId, key) as { value_json: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.value_json) as T; } catch { return null; }
}

function writeSetting(appId: string, key: SettingKey, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (app_id, key, value_json, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(app_id, key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    )
    .run(appId, key, JSON.stringify(value));
}

function deleteSetting(appId: string, key: SettingKey): void {
  getDb().prepare("DELETE FROM app_settings WHERE app_id = ? AND key = ?").run(appId, key);
}

export function getVietQrConfig(appId: string): VietQrConfig | null {
  return readSetting<VietQrConfig>(appId, "payment_vietqr");
}

export function setVietQrConfig(appId: string, cfg: VietQrConfig): void {
  // Defence-in-depth: callers should already validate, but enforce again.
  if (!/^\d{6}$/.test(cfg.bankBin)) throw new Error("bankBin must be 6 digits");
  if (!/^\d{6,30}$/.test(cfg.accountNo.replace(/\s/g, ""))) throw new Error("accountNo invalid");
  if (!cfg.accountName || cfg.accountName.length > 80) throw new Error("accountName invalid");
  writeSetting(appId, "payment_vietqr", {
    bankBin: cfg.bankBin,
    accountNo: cfg.accountNo.replace(/\s/g, ""),
    accountName: cfg.accountName.trim().slice(0, 80),
  });
}

export function clearVietQrConfig(appId: string): void {
  deleteSetting(appId, "payment_vietqr");
}
