// GET /api/zalo-export/<appId>
//
// Returns a ZIP archive of the user's generated app packaged for Zalo Mini App
// submission. Owner-only — the bundle includes JV's generated HTML wrapped in
// the layout Zalo Developers expects:
//
//   <zip>
//     ├── app-config.json   (ZMP metadata: name, icon, routes, permissions)
//     ├── manifest.json     (icon list + display config)
//     ├── index.html        (the AI-generated HTML, JV runtime injected)
//     └── icon.png          (auto-generated 192x192 placeholder if owner
//                            hasn't uploaded one to /dashboard/data/<id>/files)
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

// 1x1 transparent PNG fallback icon — Zalo requires SOMETHING; owner can
// replace via Zalo Developers' icon-upload field before submitting.
// Encoded inline to avoid a runtime fetch.
const PLACEHOLDER_ICON_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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

  // app-config.json — Zalo's manifest equivalent. Documented at
  // mini.zalo.me/documents/development/config. Fields used:
  //   app.title, app.appType, app.statusBarColor, app.headerColor
  //   pages: route → file map (we only have one page)
  //   permissions: list of ZMP APIs we need granted at install time
  const appConfig = {
    app: {
      title: app.title || "JustVibe Mini App",
      description: `${app.title || "App"} — built with JustVibe`,
      appType: "miniApp",
      statusBarColor: "#0068ff",
      headerColor: "#ffffff",
    },
    pages: [
      { name: "index", file: "index.html" },
    ],
    permissions: [
      // Default permission set — most apps need user info + storage.
      // The owner can trim this in Zalo Developers UI before submission.
      "scope.userInfo",
      "scope.userLocation",
    ],
    // JustVibe origin must be in allowed network — Zalo blocks
    // outbound fetch unless explicitly listed.
    network: {
      allowedHosts: ["justvibe.me", "*.justvibe.me", "customers.justvibe.me"],
    },
  };

  const manifest = {
    name: app.title || "JustVibe Mini App",
    short_name: (app.title || "JV").slice(0, 12),
    description: `${app.title || "App"} — built with JustVibe`,
    icons: [
      { src: "icon.png", sizes: "192x192", type: "image/png" },
    ],
    start_url: "index.html",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0068ff",
  };

  const zip = new JSZip();
  zip.file("app-config.json", JSON.stringify(appConfig, null, 2));
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("index.html", html);
  zip.file("icon.png", Buffer.from(PLACEHOLDER_ICON_B64, "base64"));
  zip.file(
    "README.txt",
    `JustVibe Zalo Mini App bundle — ${app.title || appId}\n\n` +
      `Submit at: https://developers.zalo.me/\n\n` +
      `1. Đăng nhập Zalo Developers + chọn Zalo Mini App (cần OA verified).\n` +
      `2. Tạo app mới hoặc chọn app sẵn có.\n` +
      `3. Upload toàn bộ file trong zip này (KHÔNG unzip — chỉ giải nén\n` +
      `   để xem rồi nén lại + upload).\n` +
      `4. Thay icon.png bằng icon 192x192 thật của bạn (placeholder hiện tại\n` +
      `   là 1x1 trong suốt — Zalo sẽ reject nếu không thay).\n` +
      `5. Submit để review. Lần đầu ~3-5 ngày làm việc.\n` +
      `\n` +
      `Generated: ${new Date().toISOString()}\n`,
  );

  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  return new NextResponse(buf, {
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
