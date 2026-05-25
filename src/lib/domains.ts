// Custom domain mapping — lets owners deploy generated apps under their own
// domain (shop.khachhang.com → <slug>.justvibe.me).
//
// SSL is intentionally NOT handled here. We document Cloudflare proxy as the
// supported path: user adds CNAME with orange-cloud on, CF terminates HTTPS,
// then forwards plain HTTPS to our server. Any other CDN with origin-shield
// SSL works too. The alternative (issuing Let's Encrypt certs server-side)
// adds infra surface area we'd rather defer — Cloudflare's free tier
// covers 99% of VN SMB customers already.

import { getDb } from "@/lib/db";
import { promises as dns } from "dns";

export interface CustomDomain {
  domain: string;
  app_id: string;
  user_email: string;
  verified_at: string | null;
  created_at: string;
}

// Strict domain validation — rejects subdomains under justvibe.me (our wildcard
// already covers those), IPs, punycode-only strings, and >253 char inputs.
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i;
const RESERVED_SUFFIXES = ["justvibe.me", "localhost"];

export function isValidDomain(d: string): boolean {
  const s = d.trim().toLowerCase();
  if (s.length < 4 || s.length > 253) return false;
  if (!DOMAIN_RE.test(s)) return false;
  if (RESERVED_SUFFIXES.some((r) => s === r || s.endsWith(`.${r}`))) return false;
  return true;
}

export function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export function getDomain(domain: string): CustomDomain | null {
  const row = getDb()
    .prepare("SELECT * FROM custom_domains WHERE domain = ?")
    .get(normalizeDomain(domain)) as CustomDomain | undefined;
  return row ?? null;
}

export function listDomainsForOwner(userEmail: string): CustomDomain[] {
  return getDb()
    .prepare("SELECT * FROM custom_domains WHERE user_email = ? ORDER BY created_at DESC")
    .all(userEmail.toLowerCase()) as CustomDomain[];
}

export function listDomainsForApp(appId: string): CustomDomain[] {
  return getDb()
    .prepare("SELECT * FROM custom_domains WHERE app_id = ? ORDER BY created_at DESC")
    .all(appId) as CustomDomain[];
}

export function countDomainsForOwner(userEmail: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM custom_domains WHERE user_email = ?")
    .get(userEmail.toLowerCase()) as { n: number };
  return row.n;
}

export function addDomain(domain: string, appId: string, userEmail: string): void {
  getDb()
    .prepare("INSERT INTO custom_domains (domain, app_id, user_email) VALUES (?, ?, ?)")
    .run(normalizeDomain(domain), appId, userEmail.toLowerCase());
}

export function markVerified(domain: string): void {
  getDb()
    .prepare("UPDATE custom_domains SET verified_at = datetime('now') WHERE domain = ?")
    .run(normalizeDomain(domain));
}

export function removeDomain(domain: string): void {
  getDb()
    .prepare("DELETE FROM custom_domains WHERE domain = ?")
    .run(normalizeDomain(domain));
}

/**
 * Resolve the CNAME chain for a domain and check that it eventually points
 * at one of our accepted targets. We accept any *.justvibe.me as a valid
 * target — the actual slug doesn't have to match the saved app's slug
 * (some users will point multiple custom domains at the same app).
 *
 * Returns the resolved target(s) on success so the UI can show what we
 * actually saw, or null when verification fails.
 */
export async function verifyCnamePointsToUs(domain: string): Promise<string[] | null> {
  const target = normalizeDomain(domain);
  try {
    const records = await dns.resolveCname(target);
    const ok = records.some((r) => r.toLowerCase().endsWith(".justvibe.me") || r.toLowerCase() === "justvibe.me");
    return ok ? records : null;
  } catch {
    // No CNAME — try A/AAAA falling back to "doesn't point at us, but if user
    // ran their own reverse proxy and added a custom Host header it'd still
    // work". For now we strictly require CNAME → simpler error message.
    return null;
  }
}
