import { getDb } from "@/lib/db";
import type { Tier } from "@/lib/quota";

export type BenefitType = "free_pro" | "free_team";

interface InvitationRow {
  code: string;
  benefit_type: BenefitType;
  benefit_value: number;       // days
  max_redemptions: number;
  used_count: number;
  expires_at: string | null;
}

export interface RedeemResult {
  ok: boolean;
  error?: string;
  tier?: Tier;
  daysGranted?: number;
  newExpiresAt?: string;
}

// Validate + apply an invitation code for a user. Atomic-ish: we use a single
// SQLite transaction so two concurrent redemptions of the last seat of a
// limited code can't both succeed.
export function redeemCode(email: string, rawCode: string): RedeemResult {
  const code = (rawCode || "").trim();
  if (!code) return { ok: false, error: "Vui lòng nhập mã" };
  if (!/^[a-zA-Z0-9_-]{2,40}$/.test(code)) {
    return { ok: false, error: "Mã không hợp lệ" };
  }

  const db = getDb();
  const tx = db.transaction((): RedeemResult => {
    const row = db
      .prepare("SELECT code, benefit_type, benefit_value, max_redemptions, used_count, expires_at FROM invitation_codes WHERE code = ?")
      .get(code) as InvitationRow | undefined;
    if (!row) return { ok: false, error: "Mã không tồn tại" };

    // Code expired (campaign ended)?
    if (row.expires_at) {
      const exp = new Date(row.expires_at).getTime();
      if (Number.isFinite(exp) && exp < Date.now()) {
        return { ok: false, error: "Mã đã hết hạn" };
      }
    }

    // Quota of redemptions per code (e.g. first 100 signups only).
    if (row.used_count >= row.max_redemptions) {
      return { ok: false, error: "Mã đã hết lượt dùng" };
    }

    // Same user can't redeem twice. UNIQUE(code, user_email) backs this up
    // at the schema level, but we want a nice error message instead of a
    // raw SQLite constraint failure.
    const already = db.prepare("SELECT 1 FROM redemptions WHERE code = ? AND user_email = ?").get(code, email);
    if (already) return { ok: false, error: "Bạn đã dùng mã này rồi" };

    const tier: Tier = row.benefit_type === "free_team" ? "team" : "pro";
    const days = row.benefit_value;
    const newExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    // Bump the user's tier. If they already have a paid subscription via
    // Stripe with a later renewal date, leave that alone (don't downgrade
    // them when their invitation expires earlier than their paid plan).
    const u = db
      .prepare("SELECT tier, subscription_renews_at, subscription_status FROM users WHERE email = ?")
      .get(email) as { tier: string; subscription_renews_at: string | null; subscription_status: string | null } | undefined;
    if (!u) return { ok: false, error: "Tài khoản không tìm thấy" };

    const hasLongerPaidPlan =
      u.subscription_status === "active" &&
      u.subscription_renews_at &&
      new Date(u.subscription_renews_at).getTime() > Date.now() + days * 24 * 60 * 60 * 1000;
    if (hasLongerPaidPlan) {
      return { ok: false, error: "Bạn đang có gói trả phí dài hạn hơn — không cần mã mời" };
    }

    db.prepare(
      `UPDATE users SET tier = ?, subscription_status = 'trial', subscription_renews_at = ? WHERE email = ?`
    ).run(tier, newExpiresAt, email);

    db.prepare("INSERT INTO redemptions (code, user_email) VALUES (?, ?)").run(code, email);
    db.prepare("UPDATE invitation_codes SET used_count = used_count + 1 WHERE code = ?").run(code);

    return { ok: true, tier, daysGranted: days, newExpiresAt };
  });

  try {
    return tx();
  } catch (e) {
    console.error("[invites] redeem failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Lỗi khi áp dụng mã" };
  }
}

// Convenience for the admin/seed flow.
export function createInvitationCode(opts: {
  code: string;
  benefit: BenefitType;
  days: number;
  maxRedemptions?: number;
  expiresAt?: string;
}) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO invitation_codes (code, benefit_type, benefit_value, max_redemptions, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(opts.code, opts.benefit, opts.days, opts.maxRedemptions ?? 1, opts.expiresAt ?? null);
}
