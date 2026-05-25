// AES-256-GCM helper for the integration credential vault.
//
// Why GCM: authenticated encryption — any tampered ciphertext fails to decrypt
// rather than returning garbage. Critical when the ciphertext lives in SQLite
// where a careless ALTER TABLE could corrupt it silently.
//
// Key source: INTEGRATION_VAULT_KEY env var, base64-encoded 32 bytes (256-bit).
// Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Format on disk: base64( iv || authTag || ciphertext )
//   - iv:        12 bytes (GCM standard)
//   - authTag:   16 bytes (GCM standard)
//   - ciphertext: variable
// This way one base64 blob round-trips the whole envelope.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.INTEGRATION_VAULT_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATION_VAULT_KEY not configured — generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`INTEGRATION_VAULT_KEY must decode to 32 bytes (got ${key.length})`);
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv || tag || ciphertext
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(envelope: string): string {
  const key = getKey();
  const buf = Buffer.from(envelope, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("encrypted envelope too short — likely corrupt");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString("utf8");
}

// Convenience for nullable round-trip. We never want to leak a key as "null"
// vs "empty string" — both mean "not set" semantically.
export function encryptOrNull(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  return encrypt(plaintext);
}

export function decryptOrNull(envelope: string | null | undefined): string | null {
  if (!envelope) return null;
  return decrypt(envelope);
}
