import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appBySlug } from "@/lib/store";
import { getDomain } from "@/lib/domains";

// Next 16 proxy always runs on Node.js runtime, so we can call into
// better-sqlite3 to resolve <slug>.justvibe.me → /apps/<id>.

const PROTECTED = ["/builder"];

export default async function proxy(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase();
  const appsDomain = (process.env.APPS_DOMAIN || "").toLowerCase();
  const hostNoPort = host.replace(/:\d+$/, "");

  // Custom-domain routing (e.g. shop.khachhang.com → /apps/<id>). Checked
  // BEFORE the wildcard subdomain branch so a custom domain that happens to
  // collide with our apex (it won't, but defensively) still resolves correctly.
  // Skip when the host is our own apex / wildcard — those go through the
  // sections below.
  if (hostNoPort && hostNoPort !== appsDomain && !hostNoPort.endsWith(`.${appsDomain || "_"}`)) {
    const cd = getDomain(hostNoPort);
    if (cd) {
      // Only verified domains route. Unverified rows exist while the owner
      // is mid-DNS-setup — refusing them here protects against DNS hijacking
      // where an attacker temporarily takes over a domain in our table.
      if (cd.verified_at) {
        const url = req.nextUrl.clone();
        url.pathname = `/apps/${cd.app_id}${url.pathname === "/" ? "" : url.pathname}`;
        return NextResponse.rewrite(url);
      }
    }
  }

  // Wildcard subdomain routing: <slug>.<APPS_DOMAIN> → rewrite to /apps/<id>.
  // Strip the port (host header includes it in dev) before comparing.
  if (appsDomain) {
    if (hostNoPort !== appsDomain && hostNoPort.endsWith(`.${appsDomain}`)) {
      const slug = hostNoPort.slice(0, -appsDomain.length - 1);
      // Ignore conventional non-app subdomains (www, www2, etc.) — they should
      // be redirected to the bare domain at the DNS/CDN layer, not handled here.
      if (slug && slug !== "www") {
        const app = appBySlug(slug);
        if (app) {
          const url = req.nextUrl.clone();
          // Preserve any sub-path the user typed (rarely useful for single-file
          // apps, but doesn't hurt).
          url.pathname = `/apps/${app.id}${url.pathname === "/" ? "" : url.pathname}`;
          return NextResponse.rewrite(url);
        }
        // Unknown slug → 404 page on the bare domain, so the user sees
        // something coherent instead of the auth-gated builder.
        const notFound = req.nextUrl.clone();
        notFound.pathname = "/_not-found";
        return NextResponse.rewrite(notFound);
      }
    }
  }

  const path = req.nextUrl.pathname;
  if (PROTECTED.some((p) => path.startsWith(p))) {
    const session = await getSession();
    if (!session) {
      const url = new URL("/login", req.url);
      url.searchParams.set("redirect", path);
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|api|static|.*\\.).*)"],
};
