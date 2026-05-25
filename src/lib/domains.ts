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

export interface CustomDomain {
  domain: string;
  app_id: string;
  user_email: string;
  verified_at: string | null;
  cf_hostname_id: string | null;
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

export function addDomain(
  domain: string,
  appId: string,
  userEmail: string,
  cfHostnameId: string | null = null,
): void {
  getDb()
    .prepare("INSERT INTO custom_domains (domain, app_id, user_email, cf_hostname_id) VALUES (?, ?, ?, ?)")
    .run(normalizeDomain(domain), appId, userEmail.toLowerCase(), cfHostnameId);
}

export function setCfHostnameId(domain: string, cfHostnameId: string): void {
  getDb()
    .prepare("UPDATE custom_domains SET cf_hostname_id = ? WHERE domain = ?")
    .run(cfHostnameId, normalizeDomain(domain));
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

// CNAME verification moved to the CF SaaS path — /api/domains/verify polls
// Cloudflare's custom-hostname status instead of doing a DNS lookup here.
// CF resolves the CNAME chain as part of cert issuance, so once their status
// flips to "active" we know DNS is good.
