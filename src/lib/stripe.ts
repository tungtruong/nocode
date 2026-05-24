import Stripe from "stripe";
import type { Tier } from "@/lib/quota";

// Lazy singleton so the SDK doesn't choke when STRIPE_SECRET_KEY is missing
// in environments where billing isn't configured yet (local without keys).
let _client: Stripe | null | undefined;
export function getStripe(): Stripe | null {
  if (_client !== undefined) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { _client = null; return null; }
  // Pin to a known-good API version. (Newer stripe-node ships its own default,
  // so we omit apiVersion to avoid type-only build errors when versions move.)
  _client = new Stripe(key);
  return _client;
}

// Map our tier → the Stripe Price ID for that tier's subscription.
// Set these in .env after creating the products in Stripe Dashboard (Products
// → New product → Recurring price). Test mode uses test prices (price_xxx).
export function priceIdFor(tier: Tier): string | null {
  if (tier === "pro") return process.env.STRIPE_PRICE_PRO || null;
  if (tier === "team") return process.env.STRIPE_PRICE_TEAM || null;
  return null;
}

// Reverse: given a Stripe Price ID (from a webhook event), figure out which
// tier the customer just signed up for.
export function tierFromPriceId(priceId: string): Tier | null {
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_TEAM) return "team";
  return null;
}
