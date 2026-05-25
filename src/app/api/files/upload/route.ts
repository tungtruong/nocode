// POST /api/files/upload  (multipart/form-data)
//   field `file`   — the actual binary
//   field `appId`  — required; ties the upload to an app for quota + cleanup
//
// Authentication:
//   - JV builder session (owner using dashboard dropzone) → owner of appId.
//   - Per-app end-user cookie (jv.files.upload inside a deployed app) → the
//     authenticated visitor uploads under the owner's quota. The owner pays
//     because end-users haven't agreed to anything billing-wise; if abuse
//     happens, owner sees their storage fill up and toggles auth off.
//
// Limits:
//   - Per-file: enforced by the MIME whitelist in r2.ts (1-50MB depending).
//   - Per-user total: UPLOAD_BYTES_LIMITS in quota.ts.
//   - Cross-cutting rate limit: 20 uploads / min / IP / app.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { getAppSession } from "@/lib/app-auth";
import { ownerOfApp } from "@/lib/app-owner";
import { uploadBytesLimit } from "@/lib/quota";
import { checkRateLimit } from "@/lib/security";
import { r2Configured, validateMime, buildKey, putObject, publicUrlFor } from "@/lib/r2";
import { sumUploadBytes, insertUpload } from "@/lib/uploads";

const APP_ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Credentials": "true",
};
function withCors(res: NextResponse, origin: string | null): NextResponse {
  const o = origin && /^https:\/\/([a-zA-Z0-9-]+\.)?justvibe\.me$/.test(origin) ? origin : "*";
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  res.headers.set("Access-Control-Allow-Origin", o);
  res.headers.set("Vary", "Origin");
  return res;
}

export async function OPTIONS(req: NextRequest) {
  return withCors(new NextResponse(null, { status: 204 }), req.headers.get("origin"));
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!r2Configured()) {
    return withCors(NextResponse.json({ error: "Upload chưa cấu hình" }, { status: 500 }), origin);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return withCors(NextResponse.json({ error: "Form data không hợp lệ" }, { status: 400 }), origin);
  }

  const appId = String(form.get("appId") || "");
  if (!APP_ID_RE.test(appId)) {
    return withCors(NextResponse.json({ error: "appId không hợp lệ" }, { status: 400 }), origin);
  }
  const owner = await ownerOfApp(appId);
  if (!owner) {
    return withCors(NextResponse.json({ error: "App không tồn tại" }, { status: 404 }), origin);
  }

  // Resolve identity. Either the JV builder session (owner-of-app) or the
  // per-app end-user session. Owner-of-app must match the app's actual owner;
  // a JV builder session for a DIFFERENT user is refused.
  const builderSession = await getSession();
  const appSession = await getAppSession(appId);
  let uploaderUid: string | null = null;
  if (builderSession && builderSession.email.toLowerCase() === owner.toLowerCase()) {
    uploaderUid = `owner:${builderSession.email}`;
  } else if (appSession) {
    uploaderUid = `user:${appSession.uid}`;
  } else {
    return withCors(NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 }), origin);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const rl = checkRateLimit(`upload:${ip}:${appId}`, 20, 60_000);
  if (!rl.allowed) {
    return withCors(NextResponse.json({ error: "Upload quá nhanh — chờ chút" }, { status: 429 }), origin);
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || !("size" in file)) {
    return withCors(NextResponse.json({ error: "Thiếu file" }, { status: 400 }), origin);
  }
  const sizeBytes = file.size;
  if (sizeBytes <= 0) {
    return withCors(NextResponse.json({ error: "File rỗng" }, { status: 400 }), origin);
  }
  const mime = file.type || "application/octet-stream";
  const rule = validateMime(mime);
  if (!rule) {
    return withCors(NextResponse.json({ error: `Loại file ${mime} không được hỗ trợ` }, { status: 415 }), origin);
  }
  if (sizeBytes > rule.maxBytes) {
    return withCors(
      NextResponse.json({ error: `File vượt mức (${Math.round(rule.maxBytes / 1024 / 1024)}MB tối đa cho ${mime})` }, { status: 413 }),
      origin,
    );
  }

  // Per-owner storage quota — bills against the OWNER's tier no matter who
  // uploaded. Sum + would-be-size compared to UPLOAD_BYTES_LIMITS.
  const used = sumUploadBytes(owner);
  const cap = uploadBytesLimit(owner);
  if (used + sizeBytes > cap) {
    return withCors(
      NextResponse.json(
        {
          error: `Vượt quota lưu trữ (${Math.round(used / 1024 / 1024)}/${Math.round(cap / 1024 / 1024)}MB). Nâng cấp gói hoặc xoá bớt file.`,
        },
        { status: 413 },
      ),
      origin,
    );
  }

  const key = buildKey(appId, rule.ext, randomUUID());
  const arrayBuffer = await file.arrayBuffer();
  try {
    await putObject(key, Buffer.from(arrayBuffer), mime);
  } catch (e) {
    console.error("[upload] R2 put failed:", e instanceof Error ? e.message : e);
    return withCors(NextResponse.json({ error: "Upload thất bại" }, { status: 502 }), origin);
  }

  insertUpload({
    key,
    user_email: owner,
    app_id: appId,
    size_bytes: sizeBytes,
    mime,
    original_name: "name" in file && typeof file.name === "string" ? file.name.slice(0, 200) : null,
    uploader_uid: uploaderUid,
  });

  return withCors(
    NextResponse.json({
      key,
      url: publicUrlFor(key),
      size_bytes: sizeBytes,
      mime,
    }),
    origin,
  );
}
