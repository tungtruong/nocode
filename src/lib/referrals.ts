import { randomBytes } from "crypto";
import { getDb } from "@/lib/db";

// Commission rate on the FIRST paid invoice of each referred user.
// 30% of the invoice amount, capped to keep payouts predictable.
// Tunable from one place if we decide to switch to recurring.
export const REFERRAL_COMMISSION_RATE = 0.30;

// Generate a short, URL-friendly referral code. Format: 6 chars, alphanumeric
// uppercase, no ambiguous chars (0/O, 1/I/L). UNIQUE indexed on users table —
// retry on collision (extremely rare with 32^6 = 1B possibilities).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars
function genCode(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function getOrCreateReferralCode(email: string): string {
  const db = getDb();
  const row = db.prepare("SELECT referral_code FROM users WHERE email = ?").get(email) as { referral_code: string | null } | undefined;
  if (row?.referral_code) return row.referral_code;
  // Generate a unique code (with a few retries for the unlikely collision).
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = genCode();
    try {
      const upd = db.prepare("UPDATE users SET referral_code = ? WHERE email = ? AND referral_code IS NULL").run(code, email);
      if (upd.changes > 0) return code;
      // Already had one (race) — re-read.
      const after = db.prepare("SELECT referral_code FROM users WHERE email = ?").get(email) as { referral_code: string | null } | undefined;
      if (after?.referral_code) return after.referral_code;
    } catch (e) {
      // UNIQUE collision on referral_code — try a new one.
      if (e instanceof Error && /UNIQUE/.test(e.message)) continue;
      throw e;
    }
  }
  throw new Error("Failed to allocate referral code");
}

// Look up the email of the referrer for a given code. Used during signup.
export function referrerEmailFor(code: string): string | null {
  if (!code || !/^[A-Z0-9]{4,12}$/.test(code)) return null;
  const row = getDb()
    .prepare("SELECT email FROM users WHERE referral_code = ?")
    .get(code) as { email: string } | undefined;
  return row?.email ?? null;
}

// Called from POST /api/auth/signup. Validates the code and stores the link.
// Self-referral and unknown codes are silently ignored — we don't error out
// the signup just because the share link was wrong.
export function attachReferral(newUserEmail: string, code: string | undefined): void {
  if (!code) return;
  const refEmail = referrerEmailFor(code.trim().toUpperCase());
  if (!refEmail) return;
  if (refEmail.toLowerCase() === newUserEmail.toLowerCase()) return;
  getDb()
    .prepare("UPDATE users SET referred_by_email = ? WHERE email = ? AND referred_by_email IS NULL")
    .run(refEmail, newUserEmail);
}

// Called from the Stripe webhook on invoice.paid. Computes commission, writes
// one row idempotently keyed on invoice_id. Only fires for the user's FIRST
// paid invoice — repeated invoices on the same subscription don't pay out
// again (this is "first payment" commission, not recurring).
export interface InvoiceForCommission {
  invoiceId: string;
  customerEmail: string;
  amountPaidCents: number;
  currency: string;
}
export function maybeRecordCommission(inv: InvoiceForCommission): { recorded: boolean; reason?: string } {
  const db = getDb();
  // Who referred this customer?
  const user = db
    .prepare("SELECT referred_by_email FROM users WHERE email = ?")
    .get(inv.customerEmail) as { referred_by_email: string | null } | undefined;
  if (!user?.referred_by_email) return { recorded: false, reason: "no_referrer" };

  // Already paid commission on a prior invoice from this same referred user?
  const prior = db
    .prepare("SELECT 1 FROM commissions WHERE referred_email = ? AND referrer_email = ?")
    .get(inv.customerEmail, user.referred_by_email);
  if (prior) return { recorded: false, reason: "first_payment_only" };

  const amount = Math.round(inv.amountPaidCents * REFERRAL_COMMISSION_RATE);
  try {
    db.prepare(
      `INSERT INTO commissions
        (referrer_email, referred_email, amount_cents, currency, stripe_invoice_id, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).run(user.referred_by_email, inv.customerEmail, amount, inv.currency.toUpperCase(), inv.invoiceId);
    return { recorded: true };
  } catch (e) {
    // UNIQUE collision on stripe_invoice_id — webhook re-fired, that's fine.
    if (e instanceof Error && /UNIQUE/.test(e.message)) return { recorded: false, reason: "duplicate_invoice" };
    throw e;
  }
}

export interface ReferralStats {
  code: string;
  totalReferred: number;
  paidReferred: number;
  pendingCents: number;
  paidCents: number;
  currency: string;
  recent: Array<{
    referredEmail: string;
    amountCents: number;
    currency: string;
    status: string;
    createdAt: string;
  }>;
}

export function getReferralStats(email: string): ReferralStats {
  const db = getDb();
  const code = getOrCreateReferralCode(email);

  const totalReferred = (db
    .prepare("SELECT COUNT(*) as n FROM users WHERE referred_by_email = ?")
    .get(email) as { n: number }).n;

  const paidReferred = (db
    .prepare("SELECT COUNT(DISTINCT referred_email) as n FROM commissions WHERE referrer_email = ?")
    .get(email) as { n: number }).n;

  const pendingCents = (db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) as s FROM commissions WHERE referrer_email = ? AND status = 'pending'")
    .get(email) as { s: number }).s;

  const paidCents = (db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) as s FROM commissions WHERE referrer_email = ? AND status = 'paid'")
    .get(email) as { s: number }).s;

  const recent = db
    .prepare(
      `SELECT referred_email, amount_cents, currency, status, created_at
       FROM commissions WHERE referrer_email = ? ORDER BY created_at DESC LIMIT 10`
    )
    .all(email) as Array<{ referred_email: string; amount_cents: number; currency: string; status: string; created_at: string }>;

  return {
    code,
    totalReferred,
    paidReferred,
    pendingCents,
    paidCents,
    currency: "USD",
    recent: recent.map((r) => ({
      referredEmail: r.referred_email,
      amountCents: r.amount_cents,
      currency: r.currency,
      status: r.status,
      createdAt: r.created_at,
    })),
  };
}
