import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, tierFromPriceId } from "@/lib/stripe";
import { getDb } from "@/lib/db";

// Stripe sends signed events to this endpoint. We verify the signature with
// STRIPE_WEBHOOK_SECRET, then update the user row when their subscription
// state changes. The set of events we handle covers initial purchase,
// renewals, cancellations, and payment failures.
export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !whSecret) {
    return NextResponse.json({ error: "Stripe webhook chưa cấu hình" }, { status: 500 });
  }

  // Raw body required for signature verification — Next runtime gives us bytes.
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, whSecret);
  } catch (err) {
    console.error("[Stripe webhook] signature verify failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const db = getDb();
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        // First time a user finishes Checkout. Pull the email + subscription
        // id and link them to the user record.
        const s = event.data.object as Stripe.Checkout.Session;
        const email = (s.client_reference_id || s.customer_email || "").toLowerCase();
        const customerId = typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;
        const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null;
        const tier = (s.metadata?.tier as "pro" | "team" | undefined) ?? null;
        if (!email) break;
        db.prepare(
          `UPDATE users SET
             stripe_customer_id = COALESCE(?, stripe_customer_id),
             stripe_subscription_id = COALESCE(?, stripe_subscription_id),
             subscription_status = 'active',
             tier = COALESCE(?, tier)
           WHERE email = ?`
        ).run(customerId, subId, tier, email);
        console.log(`[Stripe] activated ${tier} for ${email}`);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        // Plan changes, renewals, trial → active transitions. Re-derive tier
        // from the current price so an in-app upgrade Pro → Team is reflected.
        const sub = event.data.object as Stripe.Subscription;
        const priceId = sub.items.data[0]?.price.id ?? "";
        const tier = tierFromPriceId(priceId);
        // `current_period_end` is on the Subscription at runtime but the
        // bundled types in stripe-node 17+ moved it. Read defensively.
        const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end
          ?? sub.items.data[0]?.current_period_end;
        const renewsAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
        db.prepare(
          `UPDATE users SET
             stripe_subscription_id = ?,
             subscription_status = ?,
             subscription_renews_at = ?,
             tier = COALESCE(?, tier)
           WHERE stripe_customer_id = ?`
        ).run(sub.id, sub.status, renewsAt, tier, sub.customer as string);
        break;
      }
      case "customer.subscription.deleted": {
        // Subscription canceled (end of period or hard cancel). Drop back to
        // free and clear the renewal date.
        const sub = event.data.object as Stripe.Subscription;
        db.prepare(
          `UPDATE users SET
             subscription_status = 'canceled',
             subscription_renews_at = NULL,
             tier = 'free'
           WHERE stripe_customer_id = ?`
        ).run(sub.customer as string);
        break;
      }
      case "invoice.payment_failed": {
        // Mark past_due so the UI can warn; we keep their tier until Stripe
        // gives up (eventually fires subscription.deleted).
        const inv = event.data.object as Stripe.Invoice;
        db.prepare(
          "UPDATE users SET subscription_status = 'past_due' WHERE stripe_customer_id = ?"
        ).run(inv.customer as string);
        break;
      }
      default:
        // Many event types we don't care about (e.g. customer.created).
        break;
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("[Stripe webhook] handler error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }
}
