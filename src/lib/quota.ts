import { getDb } from "@/lib/db";

export type Tier = "free" | "pro" | "team";

// Monthly token budgets per tier. Calibration: a typical "create app" call
// burns 5–15k tokens, an edit call 20–50k. So 200k ≈ 10–20 actions; pro tier
// is generous enough for daily power use; team is org-scale.
export const TIER_LIMITS: Record<Tier, number> = {
  free: 200_000,
  pro: 5_000_000,
  team: 50_000_000,
};

// Hard cap per single request. Sized at ~75% of the monthly quota so a
// legitimate multi-component edit ("add 3 tabs at the bottom" ≈ 150k tokens
// observed) goes through, while a runaway loop is still bounded before it
// can drain more than one user's worth of monthly budget. The point is to
// catch obvious bugs (model emits a million-token reply or infinite tool
// loop), not to force users to manually slice every feature.
export const PER_REQUEST_LIMITS: Record<Tier, number> = {
  free: 150_000,
  pro: 1_000_000,
  team: 5_000_000,
};

// Per-request hard maxTurns (latency cap). Independent of token cap — protects
// against models that emit zero-token tool loops.
export const MAX_TURNS_PER_TIER: Record<Tier, number> = {
  free: 12,
  pro: 16,
  team: 20,
};

export const TIER_LABELS: Record<Tier, string> = {
  free: "Miễn phí",
  pro: "Pro",
  team: "Team",
};

// Period key. UTC month so the rollover is the same for every user regardless
// of timezone, and the reset moment is well-defined.
function currentPeriod(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export interface UsageInfo {
  used: number;
  quota: number;
  tier: Tier;
  period: string;
  remaining: number;
  pctUsed: number;
}

export function tierFor(email: string): Tier {
  const row = getDb().prepare("SELECT tier FROM users WHERE email = ?").get(email) as { tier?: string } | undefined;
  const t = (row?.tier || "free") as Tier;
  return t in TIER_LIMITS ? t : "free";
}

export function perRequestLimit(email: string): number {
  return PER_REQUEST_LIMITS[tierFor(email)];
}

export function maxTurnsFor(email: string): number {
  return MAX_TURNS_PER_TIER[tierFor(email)];
}

export function getUsage(email: string): UsageInfo {
  const period = currentPeriod();
  const tier = tierFor(email);
  const row = getDb()
    .prepare("SELECT tokens_used FROM usage WHERE user_email = ? AND period = ?")
    .get(email, period) as { tokens_used: number } | undefined;
  const used = row?.tokens_used ?? 0;
  const quota = TIER_LIMITS[tier];
  return {
    used,
    quota,
    tier,
    period,
    remaining: Math.max(0, quota - used),
    pctUsed: quota === 0 ? 0 : Math.min(100, Math.round((used / quota) * 100)),
  };
}

// Throws on quota exceeded. Called BEFORE the LLM request so we don't waste an
// upstream call when the user has nothing left.
export function assertQuota(email: string): UsageInfo {
  const info = getUsage(email);
  if (info.remaining <= 0) {
    const err = new Error(`Đã hết quota tháng này (${info.used.toLocaleString()} / ${info.quota.toLocaleString()} tokens). Nâng cấp gói để tiếp tục.`);
    (err as Error & { code?: string }).code = "QUOTA_EXCEEDED";
    throw err;
  }
  return info;
}

// Increment usage. Called AFTER each LLM round-trip with the actual token count
// reported by the provider. UPSERT in one statement so concurrent edits don't
// race.
export function recordUsage(email: string, tokens: number): void {
  if (!tokens || tokens < 0) return;
  const period = currentPeriod();
  getDb()
    .prepare(
      `INSERT INTO usage (user_email, period, tokens_used, requests, updated_at)
       VALUES (?, ?, ?, 1, datetime('now'))
       ON CONFLICT(user_email, period) DO UPDATE SET
         tokens_used = tokens_used + excluded.tokens_used,
         requests = requests + 1,
         updated_at = datetime('now')`
    )
    .run(email, period, tokens);
}
