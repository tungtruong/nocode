import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook, getSubscription, tierFromPlanId } from "@/lib/paypal";
import { getDb } from "@/lib/db";
import { maybeRecordCommission } from "@/lib/referrals";

// PayPal webhook handler. Listens for subscription state changes + paid
// invoices, mirrors them into the SQLite users.subscription_* columns, and
// credits referral commissions on the first paid sale per referred user.
//
// Event types we care about (set these in PayPal Dashboard → Webhooks):
//   BILLING.SUBSCRIPTION.ACTIVATED   → user successfully approved, tier on
//   BILLING.SUBSCRIPTION.UPDATED     → plan change, status change
//   BILLING.SUBSCRIPTION.CANCELLED   → user canceled, downgrade to free
//   BILLING.SUBSCRIPTION.SUSPENDED   → payment problem
//   PAYMENT.SALE.COMPLETED           → money received, refresh next_billing
export async function POST(req: NextRequest) {
  const raw = await req.text();
  // Forward all paypal-* headers to verify(); case-insensitive lookup later.
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

  const ok = await verifyWebhook({ headers, body: raw });
  if (!ok) {
    console.warn("[paypal webhook] signature verification failed");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: { event_type: string; resource: Record<string, unknown> };
  try { event = JSON.parse(raw); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const db = getDb();
  try {
    switch (event.event_type) {
      case "BILLING.SUBSCRIPTION.ACTIVATED":
      case "BILLING.SUBSCRIPTION.UPDATED":
      case "BILLING.SUBSCRIPTION.RE_ACTIVATED": {
        const r = event.resource as { id: string; status: string; plan_id?: string; custom_id?: string; billing_info?: { next_billing_time?: string } };
        // custom_id was set to the user's email when we created the
        // subscription. Refresh from the API in case we lost it (e.g. an
        // older subscription created before custom_id was set).
        const email = (r.custom_id || (await safeFetchEmail(r.id)) || "").toLowerCase();
        if (!email) break;
        const tier = r.plan_id ? tierFromPlanId(r.plan_id) : null;
        const renews = r.billing_info?.next_billing_time ?? null;
        db.prepare(
          `UPDATE users SET
             stripe_subscription_id = ?,
             subscription_status = ?,
             subscription_renews_at = ?,
             tier = COALESCE(?, tier)
           WHERE email = ?`
        ).run(r.id, mapStatus(r.status), renews, tier, email);
        console.log(`[paypal] ${event.event_type} ${email} → ${tier ?? "(no plan change)"} status=${r.status}`);
        break;
      }
      case "BILLING.SUBSCRIPTION.CANCELLED":
      case "BILLING.SUBSCRIPTION.EXPIRED": {
        const r = event.resource as { id: string; custom_id?: string };
        const email = (r.custom_id || (await safeFetchEmail(r.id)) || "").toLowerCase();
        if (!email) break;
        db.prepare(
          `UPDATE users SET subscription_status = 'canceled', subscription_renews_at = NULL, tier = 'free'
           WHERE email = ?`
        ).run(email);
        console.log(`[paypal] canceled ${email}`);
        break;
      }
      case "BILLING.SUBSCRIPTION.SUSPENDED":
      case "BILLING.SUBSCRIPTION.PAYMENT.FAILED": {
        const r = event.resource as { id: string; custom_id?: string };
        const email = (r.custom_id || (await safeFetchEmail(r.id)) || "").toLowerCase();
        if (!email) break;
        // Keep their tier but flag the dashboard. Stripe-style: don't punish
        // immediately, give PayPal's retry logic time to recover the payment.
        db.prepare("UPDATE users SET subscription_status = 'past_due' WHERE email = ?").run(email);
        break;
      }
      case "PAYMENT.SALE.COMPLETED": {
        // Each successful charge. We use this to record referral commission
        // on the first paid sale. PayPal's invoice equivalent is the
        // sale `id`, used here as our idempotency key.
        const r = event.resource as { id: string; billing_agreement_id?: string; amount?: { total: string; currency: string }; custom?: string };
        const subscriptionId = r.billing_agreement_id;
        if (!subscriptionId || !r.amount) break;
        let email = (r.custom || "").toLowerCase();
        if (!email) email = (await safeFetchEmail(subscriptionId)) ?? "";
        if (!email) break;
        const cents = Math.round(parseFloat(r.amount.total) * 100);
        if (cents <= 0) break;
        const result = maybeRecordCommission({
          invoiceId: r.id,
          customerEmail: email,
          amountPaidCents: cents,
          currency: r.amount.currency,
        });
        if (result.recorded) console.log(`[paypal] referral commission for ${email}, sale=${r.id}`);
        break;
      }
      case "PAYMENT.CAPTURE.COMPLETED": {
        // One-time order capture — used for token topup packs. Idempotent:
        // we look up the topups row by paypal_order_id and flip status only
        // if still pending. supplementary_data.related_ids.order_id is where
        // the order id sits inside the capture event.
        const r = event.resource as {
          id: string;                  // capture id (not order id)
          status?: string;             // "COMPLETED"
          supplementary_data?: { related_ids?: { order_id?: string } };
          custom_id?: string;
        };
        const orderId = r.supplementary_data?.related_ids?.order_id;
        if (!orderId) {
          console.log("[paypal] PAYMENT.CAPTURE.COMPLETED with no order_id, skipping");
          break;
        }
        const row = db
          .prepare("SELECT user_email, status, tokens_added FROM topups WHERE paypal_order_id = ?")
          .get(orderId) as { user_email: string; status: string; tokens_added: number } | undefined;
        if (!row) {
          // Not a topup we created (or stale event before DB write).
          break;
        }
        if (row.status === "completed") break;
        db.prepare(
          "UPDATE topups SET status = 'completed', completed_at = ? WHERE paypal_order_id = ?"
        ).run(new Date().toISOString(), orderId);
        console.log(`[paypal] topup capture credited ${row.user_email} +${row.tokens_added} order=${orderId}`);
        break;
      }
      default:
        // ignore — many event types we didn't subscribe to (e.g. CHECKOUT.*)
        break;
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("[paypal webhook] handler error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }
}

// Map PayPal subscription status (ACTIVE, SUSPENDED, etc.) to the same
// vocabulary the rest of the app uses (active, past_due, canceled, trial).
function mapStatus(paypalStatus: string): string {
  switch (paypalStatus) {
    case "ACTIVE": return "active";
    case "SUSPENDED": return "past_due";
    case "CANCELLED": return "canceled";
    case "EXPIRED": return "canceled";
    case "APPROVAL_PENDING":
    case "APPROVED":
    default: return paypalStatus.toLowerCase();
  }
}

// Recover the customer's email from the subscription resource if the webhook
// payload didn't include it. Best-effort — failures fall back to no-op.
async function safeFetchEmail(subscriptionId: string): Promise<string | null> {
  try {
    const s = await getSubscription(subscriptionId);
    return s.custom_id || s.subscriber?.email_address || null;
  } catch {
    return null;
  }
}
