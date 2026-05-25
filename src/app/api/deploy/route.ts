import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { requireSession, authError } from "@/lib/auth";
import { addApp, getApp, getProject, logTemplateUsage, pickSlug, countAppsByUser } from "@/lib/store";
import { deployLimit, tierFor, TIER_LABELS } from "@/lib/quota";
import { substitutePlaceholders } from "@/lib/html-substitute";

const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB

// Build the user-facing URL for a deployed app. If APPS_DOMAIN is set
// (e.g. "justvibe.me" with a `*.justvibe.me` wildcard DNS record pointed at
// this server), serve as `<slug>.<APPS_DOMAIN>`. Otherwise fall back to the
// path-based `/apps/<id>` URL on the base host.
function appUrl(slug: string, id: string): string {
  const appsDomain = process.env.APPS_DOMAIN;
  if (appsDomain) {
    const scheme = process.env.DEV_INSECURE_COOKIE === "true" ? "http" : "https";
    return `${scheme}://${slug}.${appsDomain}`;
  }
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3002";
  return `${baseUrl}/apps/${id}`;
}

// Same shape as the internal isSafeId() in store.ts — must match or addApp
// will reject the id we hand it.
function isSafeId(id: string): boolean {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{6,64}$/.test(id);
}

export async function POST(req: NextRequest) {
  try {
    let session;
    try { session = await requireSession(); } catch { return authError(); }

    const { html, title, projectId } = await req.json();

    if (!html || typeof html !== "string") {
      return NextResponse.json({ error: "Thiếu nội dung HTML" }, { status: 400 });
    }

    if (html.length > MAX_HTML_SIZE) {
      return NextResponse.json({ error: "File quá lớn (tối đa 5MB)" }, { status: 400 });
    }

    // Re-deploy: if the client passes its projectId AND that id is already
    // tied to this user's app, reuse it so the same /apps/<id> + slug +
    // public URL keep pointing at the new HTML. New project IDs get a fresh
    // UUID so two projects can never collide.
    let id: string;
    let existingSlug: string | null = null;
    let isNewDeploy = false;
    if (projectId && isSafeId(projectId)) {
      const existing = await getApp(projectId);
      if (existing) {
        if (existing.user_email !== session.email) {
          return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
        }
        id = projectId;
        existingSlug = existing.slug ?? null;
      } else {
        // First deploy for this project — use the projectId itself as the
        // app id so subsequent deploys are idempotent.
        id = projectId;
        isNewDeploy = true;
      }
    } else {
      // Legacy: caller didn't send projectId, fall back to fresh UUID.
      id = uuidv4().replace(/-/g, "");
      isNewDeploy = true;
    }

    // Block new deploys past the plan's limit. Re-deploys (same projectId,
    // existing row) pass through unconditionally.
    if (isNewDeploy) {
      const used = countAppsByUser(session.email);
      const quota = deployLimit(session.email);
      if (used >= quota) {
        const tier = tierFor(session.email);
        return NextResponse.json({
          error: `Đã đạt giới hạn app deploy của gói ${TIER_LABELS[tier]} (${used}/${quota}). Xóa app cũ hoặc nâng gói để tiếp tục.`,
          code: "DEPLOY_LIMIT_EXCEEDED",
          used, quota, tier,
        }, { status: 403 });
      }
    }

    const dir = path.join(process.cwd(), "public", "apps", id);
    await fs.mkdir(dir, { recursive: true });
    // Substitute {{APP_ID}} → real id so deployed forms hit /f/<id>/submit
    // correctly. Idempotent: re-running on already-substituted HTML is a no-op.
    const finalHtml = substitutePlaceholders(html, { appId: id });
    await fs.writeFile(path.join(dir, "index.html"), finalHtml, "utf-8");

    // Preserve the slug across re-deploys; only allocate one on first deploy.
    const slug = existingSlug ?? pickSlug(title || "app", id);
    const url = appUrl(slug, id);

    try {
      addApp(id, {
        user_email: session.email,
        title: title || "Untitled App",
        url,
        created_at: new Date().toISOString(),
        slug,
      });
    } catch (e) {
      console.error("Store error:", e);
    }

    // Telemetry: a successful deploy is the strongest signal that the template
    // worked for this user. Look up the project's mode (best-effort — silent on
    // miss for legacy projects).
    if (projectId && typeof projectId === "string") {
      try {
        const proj = await getProject(projectId, session.email);
        if (proj) logTemplateUsage(session.email, projectId, proj.mode, "deploy", false);
      } catch {
        // non-fatal
      }
    }

    return NextResponse.json({ url, id, slug });
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
