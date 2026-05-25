import { notFound } from "next/navigation";
import fs from "fs/promises";
import path from "path";

// Defence-in-depth alongside the iframe sandbox: even though the sandbox already
// gives the iframe an opaque origin, an injected CSP meta tag blocks the
// deployed HTML from reaching external services (CDNs, trackers, exfiltration
// endpoints). 'unsafe-inline' is required because every generated app uses
// inline <style> and <script>.
// Allow images + fonts + stylesheets to come from any HTTPS origin so generated
// apps can use Unsplash/picsum/Cloudinary/CDN fonts/etc. The page is rendered
// inside an iframe sandbox so an asset load can't see or affect parent state.
// form-action allows the JV submit endpoint on the apex domain (deployed
// apps live at <slug>.justvibe.me; a relative form action="/f/..." resolves
// to the same subdomain; but JV's API is on the apex, so explicit allow).
// 'self' covers in-subdomain absolute URLs.
const CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https://justvibe.me",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self' https://justvibe.me",
].join("; ");

function injectCsp(html: string): string {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  // Fallback: prepend (still scoped to the document via meta).
  return tag + html;
}

// Validate id strictly (length + charset) to avoid pathological inputs reaching fs.
const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

export default async function AppPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!ID_RE.test(id)) notFound();

  const filePath = path.join(process.cwd(), "public", "apps", id, "index.html");
  let html: string;
  try {
    html = await fs.readFile(filePath, "utf-8");
  } catch {
    notFound();
  }

  return (
    <iframe
      srcDoc={injectCsp(html)}
      title="Deployed App"
      className="fixed inset-0 w-full h-full border-0 bg-white"
      sandbox="allow-scripts allow-modals allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
    />
  );
}
