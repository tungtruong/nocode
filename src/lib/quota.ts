import { getDb } from "@/lib/db";

export type Tier = "free" | "pro" | "team";

// === PRICING MODEL ===
//
// DeepSeek charges input and output tokens at very different rates (output is
// ~4× input). Charging users on raw `total_tokens` would either undercharge
// long replies or overcharge short ones, so we normalize to "weighted tokens"
// where 1 weighted token = 1 input token = (1 / OUTPUT_TO_INPUT_RATIO) of an
// output token. Quotas are denominated in weighted tokens.
//
// Reference DeepSeek V3 chat rates (2025):
//   input  cache-miss   $0.27 / 1M
//   output              $1.10 / 1M
//   → OUTPUT_TO_INPUT_RATIO = 1.10 / 0.27 ≈ 4.07
//
// Cost per weighted token (= input token cost): $0.27 / 1M = $0.00000027.
// Paid plans sized so price covers DeepSeek cost with a 4× gross margin:
//
//   Plan   Price/mo   Cost target (price/4)   Weighted-token budget
//   Free   $0         — (subsidized)          1,000,000
//   Pro    $12        $3                      $3   / $0.27/M = 11,000,000
//   Team   $39        $9.75                   $9.75/ $0.27/M = 36,000,000
//
// Recalibrate when DeepSeek rates or the fallback (OpenAI) mix changes.
export const INPUT_RATE_PER_TOKEN = 0.27 / 1_000_000;   // USD per input token
export const OUTPUT_RATE_PER_TOKEN = 1.10 / 1_000_000;  // USD per output token
export const OUTPUT_TO_INPUT_RATIO = OUTPUT_RATE_PER_TOKEN / INPUT_RATE_PER_TOKEN;

export function weightedTokens(promptTokens: number, completionTokens: number): number {
  return Math.round((promptTokens || 0) + (completionTokens || 0) * OUTPUT_TO_INPUT_RATIO);
}

export const TIER_LIMITS: Record<Tier, number> = {
  free: 1_000_000,
  pro: 11_000_000,
  team: 36_000_000,
};

// Hard cap per single request (weighted tokens). Sized at ~50% of the monthly
// quota so a legitimate multi-component edit ("add 3 tabs at the bottom"
// ≈ 150k weighted tokens observed) goes through with room to spare, while a
// runaway loop or pathological prompt is bounded before it can drain more
// than half a month's budget.
export const PER_REQUEST_LIMITS: Record<Tier, number> = {
  free: 500_000,
  pro: 5_500_000,
  team: 18_000_000,
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

// Increment usage. Pass input + output tokens separately from the LLM provider
// (response.usage.prompt_tokens, completion_tokens). We store the *weighted*
// total in tokens_used so the quota check and the LLM bill stay aligned even
// when a request has an unusually output-heavy ratio.
export function recordUsage(email: string, promptTokens: number, completionTokens: number): void {
  const weighted = weightedTokens(promptTokens, completionTokens);
  if (weighted <= 0) return;
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
    .run(email, period, weighted);
}
