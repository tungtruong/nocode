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
//   input  cache-hit    $0.014 / 1M  (≈ 5% of cache-miss — DeepSeek auto-caches
//                                     identical prompt prefixes across calls)
//   output              $1.10 / 1M
//   → OUTPUT_TO_INPUT_RATIO = 1.10 / 0.27 ≈ 4.07
//   → CACHED_TO_INPUT_RATIO = 0.014 / 0.27 ≈ 0.052
//
// Cost per weighted token (= cache-miss input token cost): $0.27 / 1M.
// Paid plans sized so price covers DeepSeek cost with a 4× gross margin:
//
//   Plan   Price/mo   Cost target (price/4)   Weighted-token budget
//   Free   $0         — (subsidized)          1,000,000
//   Pro    $12        $3                      $3   / $0.27/M = 11,000,000
//   Team   $39        $9.75                   $9.75/ $0.27/M = 36,000,000
//
// Recalibrate when DeepSeek rates or the fallback (OpenAI) mix changes.
export const INPUT_RATE_PER_TOKEN = 0.27 / 1_000_000;          // USD per cache-miss input token
export const CACHED_INPUT_RATE_PER_TOKEN = 0.014 / 1_000_000;  // USD per cache-hit input token
export const OUTPUT_RATE_PER_TOKEN = 1.10 / 1_000_000;         // USD per output token
export const OUTPUT_TO_INPUT_RATIO = OUTPUT_RATE_PER_TOKEN / INPUT_RATE_PER_TOKEN;
export const CACHED_TO_INPUT_RATIO = CACHED_INPUT_RATE_PER_TOKEN / INPUT_RATE_PER_TOKEN;

// Bill in "weighted tokens" where 1 weighted token = 1 cache-miss input token.
// Cache-hit input tokens are billed at ~5% (matches our DeepSeek cost), so a
// multi-turn agent loop that keeps a stable system+context prefix only pays
// full price for the *new* tokens each turn — the user gets the same discount
// DeepSeek gives us. Output tokens are billed at the ~4× output/input ratio.
//
// Pass `cachedTokens` from the LLM's usage.prompt_tokens_details.cached_tokens
// field. Callers that don't have a cache count can pass 0 (legacy behavior).
export function weightedTokens(promptTokens: number, completionTokens: number, cachedTokens: number = 0): number {
  const prompt = promptTokens || 0;
  const cached = Math.min(cachedTokens || 0, prompt);
  const nonCached = prompt - cached;
  return Math.round(
    nonCached +
    cached * CACHED_TO_INPUT_RATIO +
    (completionTokens || 0) * OUTPUT_TO_INPUT_RATIO
  );
}

// Free is intentionally tight — just enough to try the product on 1 small app.
// Pro is the workhorse tier. Max gives 5.45× tokens for 3.25× price (1.68×
// better $/token) so users on Pro who hit the cap see a clear value ladder up.
//
// NOTE: the tier identifier "team" is kept in the DB + PayPal plan mapping
// to avoid invalidating existing subscriptions; UI labels it as "Max".
export const TIER_LIMITS: Record<Tier, number> = {
  free: 300_000,
  pro: 11_000_000,
  team: 60_000_000,
};

// Hard cap per single request (weighted tokens). Sized so a legitimate
// multi-component edit goes through with room to spare, while a runaway loop
// is bounded before it eats meaningful quota.
export const PER_REQUEST_LIMITS: Record<Tier, number> = {
  free: 100_000,
  pro: 5_500_000,
  team: 25_000_000,
};

// Per-request hard maxTurns (latency cap). Independent of token cap — protects
// against models that emit zero-token tool loops.
export const MAX_TURNS_PER_TIER: Record<Tier, number> = {
  free: 8,
  pro: 16,
  team: 22,
};

// How many in-progress projects (chat history rows) a user can keep, and how
// many deployed apps (subdomain-claiming rows) they can own. Free is kept
// extra tight (1 each) so it really is a trial, not a workspace. Max has no
// draft cap so a studio juggling many client projects isn't blocked.
export const PROJECT_LIMITS: Record<Tier, number> = {
  free: 1,
  pro: 30,
  team: Number.MAX_SAFE_INTEGER,
};

export const DEPLOY_LIMITS: Record<Tier, number> = {
  free: 1,
  pro: 20,
  team: 200,
};

export function projectLimit(email: string): number {
  if (isUnlimited()) return Number.MAX_SAFE_INTEGER;
  return PROJECT_LIMITS[tierFor(email)];
}

export function deployLimit(email: string): number {
  if (isUnlimited()) return Number.MAX_SAFE_INTEGER;
  return DEPLOY_LIMITS[tierFor(email)];
}

export const TIER_LABELS: Record<Tier, string> = {
  free: "Miễn phí",
  pro: "Pro",
  team: "Max",
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
  unlimited?: boolean;
}

// Dev override: set UNLIMITED_QUOTA=true in .env to bypass quota/per-request
// caps. Tokens are still recorded so you can measure real usage; only the
// checks are skipped. Useful for "measure what a real edit costs" sessions.
function isUnlimited(): boolean {
  return process.env.UNLIMITED_QUOTA === "true";
}

export function tierFor(email: string): Tier {
  const row = getDb()
    .prepare("SELECT tier, subscription_renews_at, subscription_status FROM users WHERE email = ?")
    .get(email) as { tier?: string; subscription_renews_at?: string | null; subscription_status?: string | null } | undefined;
  let t = (row?.tier || "free") as Tier;
  // Trial (invitation code) and canceled subs: drop back to free once the
  // renewal date passes. Active paid subs (Stripe) are renewed automatically
  // via the webhook so we don't need to expire them here.
  const renews = row?.subscription_renews_at ? new Date(row.subscription_renews_at).getTime() : null;
  const expired = renews !== null && renews < Date.now();
  const status = row?.subscription_status;
  if (t !== "free" && expired && (status === "trial" || status === "canceled" || !status)) {
    t = "free";
  }
  return t in TIER_LIMITS ? t : "free";
}

export function perRequestLimit(email: string): number {
  if (isUnlimited()) return Number.MAX_SAFE_INTEGER;
  return PER_REQUEST_LIMITS[tierFor(email)];
}

export function maxTurnsFor(email: string): number {
  // In UNLIMITED_QUOTA mode (dev calibration), drop the turn cap too — the
  // only remaining stop is the per-call upstream timeout (60s) and the user
  // hitting the cancel button. Use MAX_SAFE_INTEGER so the agent only stops
  // when it actually finishes or errors out.
  if (isUnlimited()) return Number.MAX_SAFE_INTEGER;
  return MAX_TURNS_PER_TIER[tierFor(email)];
}

export function getUsage(email: string): UsageInfo {
  const period = currentPeriod();
  const tier = tierFor(email);
  const row = getDb()
    .prepare("SELECT tokens_used FROM usage WHERE user_email = ? AND period = ?")
    .get(email, period) as { tokens_used: number } | undefined;
  const used = row?.tokens_used ?? 0;
  const unlimited = isUnlimited();
  const quota = unlimited ? Number.MAX_SAFE_INTEGER : TIER_LIMITS[tier];
  return {
    used,
    quota,
    tier,
    period,
    remaining: Math.max(0, quota - used),
    pctUsed: unlimited || quota === 0 ? 0 : Math.min(100, Math.round((used / quota) * 100)),
    unlimited: unlimited || undefined,
  };
}

// Throws on quota exceeded. Called BEFORE the LLM request so we don't waste an
// upstream call when the user has nothing left. Bypassed by UNLIMITED_QUOTA.
export function assertQuota(email: string): UsageInfo {
  const info = getUsage(email);
  if (info.unlimited) return info;
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
export function recordUsage(email: string, promptTokens: number, completionTokens: number, cachedTokens: number = 0): void {
  const weighted = weightedTokens(promptTokens, completionTokens, cachedTokens);
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
