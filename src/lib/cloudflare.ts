// Thin wrapper around Cloudflare for SaaS — Custom Hostnames API.
//
// We use CF as the public-facing TLS + edge for any custom domain a customer
// points at us (shop.khachhang.com → CNAME → customers.justvibe.me). CF auto-
// issues a Let's Encrypt cert on first hit, serves through their global CDN,
// and proxies HTTP back to our VPS origin. The origin already has a CF Origin
// Cert that justvibe.me's nginx terminates with — no change to nginx needed
// for the new hosts because nginx's default behavior is to use the first
// configured server block for any unrecognised Host header.
//
// Why CF SaaS over Caddy + Let's Encrypt on-box:
//   - VPS already runs nginx fronting a Docker Next.js — adding a Caddy
//     stream-module passthrough is non-trivial and risks the live justvibe.me
//     traffic.
//   - CF SaaS handles SSL renewal, DDoS shielding, and edge caching for free
//     up to 100 hostnames; $0.10/hostname/mo beyond that.
//   - One-time API integration vs. ongoing infra maintenance.
//
// Env vars (set in .env on the server + DEPLOY_ENV GH secret):
//   CF_API_TOKEN          API token with `SSL and Certificates:Edit` +
//                         `Custom Hostnames:Edit` scopes on the justvibe.me zone
//   CF_ZONE_ID            the justvibe.me zone ID (from CF dashboard → Overview)
//   CF_FALLBACK_HOSTNAME  defaults to "customers.justvibe.me" — must already
//                         resolve to the VPS via DNS in the same zone

const CF_API = "https://api.cloudflare.com/client/v4";

export function cloudflareConfigured(): boolean {
  return !!(process.env.CF_API_TOKEN && process.env.CF_ZONE_ID);
}

function token(): string {
  const t = process.env.CF_API_TOKEN;
  if (!t) throw new Error("CF_API_TOKEN chưa cấu hình");
  return t;
}
function zone(): string {
  const z = process.env.CF_ZONE_ID;
  if (!z) throw new Error("CF_ZONE_ID chưa cấu hình");
  return z;
}

/** Subset of CF's response. We don't trust the full shape — only read fields
 *  we actually use. */
export interface CfCustomHostname {
  id: string;
  hostname: string;
  /** Cloudflare hostname-level status. "pending" / "active" / "blocked" /
   *  "moved" / "deleted". Active means CF is serving the hostname. */
  status: string;
  ssl: {
    /** Cert lifecycle status. "pending_validation" / "pending_issuance" /
     *  "active" / "expired" / "deleted" / etc. Active means cert installed. */
    status: string;
    /** When CF needs HTTP-01 validation, it returns the records the user
     *  must add. With CNAME mode we don't usually see these — CF validates
     *  by following the CNAME chain. */
    validation_records?: Array<{ txt_name?: string; txt_value?: string; http_url?: string; http_body?: string }>;
    validation_errors?: Array<{ message: string }>;
  };
}

interface CfApiResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
  result: T;
}

async function call<T>(path: string, init?: RequestInit): Promise<CfApiResponse<T>> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as CfApiResponse<T>;
  if (!res.ok || !json.success) {
    const msg = json.errors?.[0]?.message || `CF API ${res.status}`;
    throw new Error(`Cloudflare: ${msg}`);
  }
  return json;
}

/** Create a custom hostname under our zone — CF will auto-issue a LE cert. */
export async function createCustomHostname(hostname: string): Promise<CfCustomHostname> {
  const resp = await call<CfCustomHostname>(`/zones/${zone()}/custom_hostnames`, {
    method: "POST",
    body: JSON.stringify({
      hostname,
      ssl: {
        // HTTP-01 challenge via CF — works for any DNS provider on customer side
        // because CF resolves the CNAME chain to validate.
        method: "http",
        type: "dv",
        settings: {
          min_tls_version: "1.2",
          // Disable HTTP/2 to origin — origin nginx may not support it on
          // the per-Host fallback path. Cheap to flip back on if needed.
          http2: "off",
        },
      },
    }),
  });
  return resp.result;
}

export async function getCustomHostname(id: string): Promise<CfCustomHostname> {
  const resp = await call<CfCustomHostname>(`/zones/${zone()}/custom_hostnames/${id}`);
  return resp.result;
}

export async function deleteCustomHostname(id: string): Promise<void> {
  await call<{ id: string }>(`/zones/${zone()}/custom_hostnames/${id}`, { method: "DELETE" });
}

/** Returns true when CF reports the hostname is fully provisioned (cert
 *  active + status active) so it can serve traffic. */
export function isCustomHostnameLive(ch: CfCustomHostname): boolean {
  return ch.status === "active" && ch.ssl?.status === "active";
}

/** The CNAME target customers point at — published in dashboard instructions. */
export function fallbackHostname(): string {
  return process.env.CF_FALLBACK_HOSTNAME || "customers.justvibe.me";
}
