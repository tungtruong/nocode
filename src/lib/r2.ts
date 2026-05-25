// Thin wrapper around Cloudflare R2 (S3-compatible) for the file-upload
// capability. Files live under `<appId>/<uuid>.<ext>` so cleanup-on-app-delete
// is a single prefix listObjects + deleteObjects call.
//
// Why R2 over S3 / Supabase Storage:
//   - Cloudflare doesn't charge egress, so serving a 5MB hero image 100k times
//     costs the same as serving it once. AWS would bill ~$0.09/GB after the
//     first GB out — a single viral app would burn the margin.
//   - $0.015/GB/mo storage. 10K users × 100MB ≈ $15/mo. Covered by 1 Max sub.
//   - S3-compatible API means we use @aws-sdk/client-s3 with a custom endpoint.

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

let _client: S3Client | null = null;

export function r2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY &&
    process.env.R2_SECRET_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_URL
  );
}

function client(): S3Client {
  if (_client) return _client;
  if (!r2Configured()) throw new Error("R2 chưa cấu hình — set R2_* env vars");
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY!,
      secretAccessKey: process.env.R2_SECRET_KEY!,
    },
  });
  return _client;
}

const BUCKET = () => process.env.R2_BUCKET!;
const PUBLIC_URL = () => process.env.R2_PUBLIC_URL!.replace(/\/+$/, "");

/** MIME whitelist — defence-in-depth on top of the per-MIME size cap below.
 *  Adding a new type? Pick the actual MIME the browser sends (sometimes
 *  surprising, e.g. .heic on iOS is image/heic, .mov is video/quicktime). */
const ALLOWED: Record<string, { ext: string; maxBytes: number }> = {
  "image/jpeg":      { ext: "jpg",  maxBytes: 10 * 1024 * 1024 },
  "image/png":       { ext: "png",  maxBytes: 10 * 1024 * 1024 },
  "image/webp":      { ext: "webp", maxBytes: 10 * 1024 * 1024 },
  "image/gif":       { ext: "gif",  maxBytes: 10 * 1024 * 1024 },
  "image/svg+xml":   { ext: "svg",  maxBytes:  1 * 1024 * 1024 },
  "image/heic":      { ext: "heic", maxBytes: 10 * 1024 * 1024 },
  "application/pdf": { ext: "pdf",  maxBytes: 20 * 1024 * 1024 },
  "audio/mpeg":      { ext: "mp3",  maxBytes: 20 * 1024 * 1024 },
  "audio/wav":       { ext: "wav",  maxBytes: 20 * 1024 * 1024 },
  "audio/mp4":       { ext: "m4a",  maxBytes: 20 * 1024 * 1024 },
  "audio/ogg":       { ext: "ogg",  maxBytes: 20 * 1024 * 1024 },
  "audio/webm":      { ext: "webm", maxBytes: 20 * 1024 * 1024 },
  "video/mp4":       { ext: "mp4",  maxBytes: 50 * 1024 * 1024 },
  "video/webm":      { ext: "webm", maxBytes: 50 * 1024 * 1024 },
  "text/plain":      { ext: "txt",  maxBytes:  2 * 1024 * 1024 },
  "text/csv":        { ext: "csv",  maxBytes:  5 * 1024 * 1024 },
};

export interface MimeRule {
  ext: string;
  maxBytes: number;
}

export function validateMime(mime: string): MimeRule | null {
  return ALLOWED[mime.toLowerCase()] || null;
}

/** Build the deterministic R2 object key. Random UUID prevents collisions and
 *  makes the URL un-guessable (a basic privacy safeguard for paid-tier "private"
 *  files even though public access is on). */
export function buildKey(appId: string, ext: string, uuid: string): string {
  const safeAppId = appId.replace(/[^a-zA-Z0-9_-]/g, "");
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `${safeAppId}/${uuid}.${safeExt}`;
}

export function publicUrlFor(key: string): string {
  return `${PUBLIC_URL()}/${key}`;
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: body,
      ContentType: contentType,
      // 1-year cache — file key includes UUID so content is effectively
      // immutable; if the user "replaces" the file they upload a new key.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await client().send(
    new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }),
  );
}

/** Light healthcheck used by /api/files/health (and the dashboard banner).
 *  Returns null on success, error message on failure. */
export async function ping(): Promise<string | null> {
  try {
    await client().send(new HeadBucketCommand({ Bucket: BUCKET() }));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
