// GET /api/zalo-export/<appId>
//
// Returns a ZIP archive of the user's generated app packaged for submission
// to Zalo Developers. Owner-only.
//
// Bundle structure matches what `zmp deploy` would upload — the Vite build
// output at the root, plus `app-config.json` describing runtime appearance:
//
//   <zip>
//     ├── app-config.json   (ZMA runtime config — REAL Zalo schema, no
//     │                      made-up fields. App ID lives in zmp-cli.json
//     │                      on the developer side, not here.)
//     ├── index.html        (the AI-generated HTML, JV runtime injected)
//     └── README.txt        (VN-language submission walkthrough)
//
// **No manifest.json, no icon.png in the zip.** Zalo's review UI takes the
// icon upload as a separate field — bundling our 1x1 placeholder was a
// guaranteed reject. README tells the owner to upload an icon in the
// Developers console.
//
// Owner takes the zip → uploads at developers.zalo.me → Zalo reviews
// (~3-5 business days first time, ~1 day for updates) → publishes.

import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import fs from "fs/promises";
import path from "path";
import { requireSession, authError } from "@/lib/auth";
import { getApp } from "@/lib/store";
import { jvRuntimeScriptTag } from "@/lib/jv-runtime";

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ appId: string }> },
) {
  let session;
  try { session = await requireSession(); } catch { return authError(); }

  const { appId } = await ctx.params;
  if (!ID_RE.test(appId)) {
    return NextResponse.json({ error: "appId không hợp lệ" }, { status: 400 });
  }

  const app = await getApp(appId);
  if (!app) {
    return NextResponse.json({ error: "App chưa deploy. Bấm Deploy ít nhất 1 lần trước khi tải Mini App." }, { status: 404 });
  }
  if (app.user_email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  // Pull the deployed HTML from disk. We use the deployed (static) version
  // rather than the in-progress project HTML so the bundle matches what's
  // live on <slug>.justvibe.me — owner already validated it works there.
  let html: string;
  try {
    html = await fs.readFile(
      path.join(process.cwd(), "public", "apps", appId, "index.html"),
      "utf-8",
    );
  } catch {
    return NextResponse.json({ error: "Không tìm thấy file HTML đã deploy." }, { status: 404 });
  }

  // Inject JV runtime (jv.db / jv.auth / etc) — same as the deployed-on-
  // subdomain path. Zalo's bundle execution runs HTML in a webview so all
  // the same APIs work.
  html = injectRuntime(html, appId);

  // app-config.json — REAL Zalo Mini App runtime config schema as published
  // in Zalo-MiniApp/zaui-coffee. Fields verified against the published
  // examples; we do NOT include made-up fields (appType, pages,
  // permissions, network) that earlier drafts had — those would cause
  // an automatic reject because they're unknown keys to the ZMA runtime.
  //
  // App ID is intentionally absent — it lives in zmp-cli.json on the
  // developer's machine, and the user fills it in the Zalo Developers
  // UI when they create the project. Putting an empty/fake one here
  // would also be a reject.
  //
  // Permissions like scope.userInfo are NOT declared at build time;
  // they're requested at runtime via zmp-sdk's `authorize({ scopes })`.
  // listCSS/listSyncJS/listAsyncJS are normally auto-filled by Vite
  // build pipeline — empty arrays are valid for pre-built HTML.
  const appConfig = {
    app: {
      title: app.title || "JustVibe Mini App",
      headerTitle: app.title || "JustVibe Mini App",
      headerColor: "#ffffff",
      textColor: "black",
      statusBarColor: "#ffffff",
      statusBar: "normal",
      leftButton: "none",
      actionBarHidden: false,
      selfControlLoading: false,
      hideAndroidBottomNavigationBar: false,
      hideIOSSafeAreaBottom: false,
    },
    debug: false,
    listCSS: [] as string[],
    listSyncJS: [] as string[],
    listAsyncJS: [] as string[],
  };

  const zip = new JSZip();
  zip.file("app-config.json", JSON.stringify(appConfig, null, 2));
  zip.file("index.html", html);
  zip.file(
    "README.txt",
    `JustVibe Zalo Mini App bundle — ${app.title || appId}\n\n` +
      `Submit at: https://developers.zalo.me/\n\n` +
      `1. Đăng nhập Zalo Developers + chọn Zalo Mini App (cần OA verified).\n` +
      `2. Tạo app mới hoặc chọn app sẵn có. Note lại App ID Zalo cấp.\n` +
      `3. Upload zip này lên tab Source Code của app trên Developers Console.\n` +
      `   (Console tự extract — giữ nguyên zip, không cần unzip rồi nén lại.)\n` +
      `4. Upload ICON RIÊNG ở field "App Icon" trong Developers Console\n` +
      `   (icon 192x192 logo brand của bạn — KHÔNG để placeholder).\n` +
      `5. Submit để review. Lần đầu ~3-5 ngày làm việc.\n` +
      `\n` +
      `App ID: do Zalo cấp khi anh tạo app trong Developers Console.\n` +
      `KHÔNG nằm trong file app-config.json — Zalo SDK đọc App ID từ\n` +
      `runtime, không cần hardcode.\n` +
      `\n` +
      `Generated: ${new Date().toISOString()}\n`,
  );

  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  // Wrap in Blob for NextResponse — newer @types/node has Uint8Array<ArrayBufferLike>
  // which doesn't satisfy BodyInit in this TS version; Blob always does.
  return new NextResponse(new Blob([new Uint8Array(buf)], { type: "application/zip" }), {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${safeFilename(app.title || appId)}.zmp.zip"`,
      "cache-control": "no-cache",
    },
  });
}

// Inject JV runtime + APP_ID bootstrap into <head>, idempotent. Mirrors
// the logic in src/app/apps/[id]/page.tsx so the bundled HTML behaves the
// same in Zalo's webview as it does on the JV subdomain.
function injectRuntime(html: string, appId: string): string {
  const tag = jvRuntimeScriptTag(appId);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  return tag + html;
}

function safeFilename(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "justvibe-app";
}
