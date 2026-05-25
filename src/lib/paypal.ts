// PayPal Subscriptions API (REST, no SDK) — Stripe doesn't accept Vietnamese
// business accounts so PayPal is the practical recurring-billing provider.
//
// Flow:
//   1. Client POSTs to /api/checkout { tier }
//   2. Server creates a v1/billing/subscriptions resource against a Plan ID
//      (Plans are created once in PayPal Dashboard, one per tier).
//   3. PayPal returns an approval link; client redirects there.
//   4. User approves on paypal.com → back to our return_url.
//   5. PayPal fires BILLING.SUBSCRIPTION.ACTIVATED webhook → we flip tier.

import type { Tier } from "@/lib/quota";

export function paypalConfigured(): boolean {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function baseUrl(): string {
  // sandbox = test mode, live = production. Default to sandbox to avoid
  // accidentally charging real cards while you're still wiring things up.
  return process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

export function planIdFor(tier: Tier): string | null {
  if (tier === "pro") return process.env.PAYPAL_PLAN_PRO || null;
  if (tier === "team") return process.env.PAYPAL_PLAN_TEAM || null;
  return null;
}

export function tierFromPlanId(planId: string): Tier | null {
  if (planId === process.env.PAYPAL_PLAN_PRO) return "pro";
  if (planId === process.env.PAYPAL_PLAN_TEAM) return "team";
  return null;
}

// Cached OAuth token. PayPal access tokens last ~9 hours; we refresh proactively
// 5 minutes before expiry so an in-flight request never trips on expiration.
let _token: { value: string; expiresAt: number } | null = null;
async function getAccessToken(): Promise<string> {
  if (_token && _token.expiresAt > Date.now() + 5 * 60_000) return _token.value;
  const id = process.env.PAYPAL_CLIENT_ID!;
  const secret = process.env.PAYPAL_CLIENT_SECRET!;
  const r = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`paypal token ${r.status}: ${body.slice(0, 200)}`);
  }
  const data = (await r.json()) as { access_token: string; expires_in: number };
  _token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _token.value;
}

export async function paypalFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const r = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`paypal ${path} ${r.status}: ${body.slice(0, 400)}`);
  }
  // 204 No Content is common (e.g. cancel-subscription).
  if (r.status === 204) return undefined as unknown as T;
  return (await r.json()) as T;
}

// Create a subscription and return the URL the user must visit to approve it.
// We pass our user's email in `custom_id` so the webhook can credit the right
// account even before the user comes back from PayPal.
export interface CreatedSubscription {
  id: string;
  approvalUrl: string;
}
export async function createSubscription(opts: {
  planId: string;
  email: string;
  tier: Tier;
  returnUrl: string;
  cancelUrl: string;
}): Promise<CreatedSubscription> {
  const sub = await paypalFetch<{ id: string; links: Array<{ href: string; rel: string }> }>(
    "/v1/billing/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        plan_id: opts.planId,
        custom_id: opts.email,
        subscriber: { email_address: opts.email },
        application_context: {
          brand_name: "JustVibe",
          locale: "vi-VN",
          shipping_preference: "NO_SHIPPING",
          user_action: "SUBSCRIBE_NOW",
          payment_method: { payer_selected: "PAYPAL", payee_preferred: "IMMEDIATE_PAYMENT_REQUIRED" },
          return_url: opts.returnUrl,
          cancel_url: opts.cancelUrl,
        },
      }),
    }
  );
  const approval = sub.links.find((l) => l.rel === "approve");
  if (!approval) throw new Error("No approval link in PayPal response");
  return { id: sub.id, approvalUrl: approval.href };
}

// Verify webhook authenticity by asking PayPal to do it. They sign each event
// with a key tied to PAYPAL_WEBHOOK_ID; we hand the headers + raw body back to
// /v1/notifications/verify-webhook-signature and trust the SUCCESS verdict.
export async function verifyWebhook(opts: {
  headers: Record<string, string>;
  body: string; // raw JSON
}): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  // PayPal is case-sensitive about header names in the verify payload.
  const h = (k: string) => opts.headers[k.toLowerCase()] || opts.headers[k] || "";
  const payload = {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: JSON.parse(opts.body),
  };
  try {
    const res = await paypalFetch<{ verification_status: string }>(
      "/v1/notifications/verify-webhook-signature",
      { method: "POST", body: JSON.stringify(payload) }
    );
    return res.verification_status === "SUCCESS";
  } catch (e) {
    console.error("[paypal] webhook verify failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

export async function getSubscription(id: string): Promise<{
  id: string;
  status: string;
  plan_id: string;
  billing_info?: { next_billing_time?: string };
  subscriber?: { email_address?: string };
  custom_id?: string;
}> {
  return paypalFetch(`/v1/billing/subscriptions/${id}`);
}

// === One-time orders (used for token topup packs) ===
//
// Subscriptions use /v1/billing/subscriptions; one-time payments use the v2
// Orders API. Flow:
//   1. createOrder(...) → returns order id + approval URL
//   2. user approves on paypal.com → comes back to return_url
//   3. captureOrder(orderId) charges the card and returns CAPTURE_COMPLETED
//   4. our /api/topup/capture credits tokens; the webhook (idempotent) is a
//      backup for direct redirects that miss the synchronous step.
export interface CreatedOrder {
  id: string;
  approvalUrl: string;
}
export async function createOrder(opts: {
  amountUsd: number;
  description: string;
  custom_id: string;          // we encode "<email>|<packId>" here
  returnUrl: string;
  cancelUrl: string;
}): Promise<CreatedOrder> {
  const order = await paypalFetch<{ id: string; links: Array<{ href: string; rel: string }> }>(
    "/v2/checkout/orders",
    {
      method: "POST",
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            description: opts.description,
            custom_id: opts.custom_id,
            amount: { currency_code: "USD", value: opts.amountUsd.toFixed(2) },
          },
        ],
        application_context: {
          brand_name: "JustVibe",
          locale: "vi-VN",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: opts.returnUrl,
          cancel_url: opts.cancelUrl,
        },
      }),
    }
  );
  const approval = order.links.find((l) => l.rel === "approve");
  if (!approval) throw new Error("No approval link in PayPal order response");
  return { id: order.id, approvalUrl: approval.href };
}

export interface CapturedOrder {
  id: string;
  status: string; // "COMPLETED" on success
  purchase_units?: Array<{
    custom_id?: string;
    payments?: { captures?: Array<{ id: string; status: string; amount: { value: string; currency_code: string } }> };
  }>;
}
export async function captureOrder(orderId: string): Promise<CapturedOrder> {
  return paypalFetch<CapturedOrder>(`/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
