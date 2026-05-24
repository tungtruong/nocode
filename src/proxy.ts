import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appBySlug } from "@/lib/store";

// Next 16 proxy always runs on Node.js runtime, so we can call into
// better-sqlite3 to resolve <slug>.vibemvp.io → /apps/<id>.

const PROTECTED = ["/builder"];

export default async function proxy(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase();
  const appsDomain = (process.env.APPS_DOMAIN || "").toLowerCase();

  // Wildcard subdomain routing: <slug>.<APPS_DOMAIN> → rewrite to /apps/<id>.
  // Strip the port (host header includes it in dev) before comparing.
  if (appsDomain) {
    const hostNoPort = host.replace(/:\d+$/, "");
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
