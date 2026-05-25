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
// Plans sized so the worst-case (no cache) cost stays below the gross margin
// target. Real cost is much lower because prompt caching gives ~5-10×
// effective discount on multi-turn flows.
//
//   Plan   Price/mo   Weighted budget     Worst-case cost   Gross margin
//   Free   $0         300,000             $0.08             —
//   Pro    $14.99     11,000,000          $2.97             5.0×
//   Max    $39.99     60,000,000          $16.20            2.5× (worst-case)
//
// Topup packs (one-time) are priced 2-3× above the matching sub's per-token
// rate so they don't cannibalize subscriptions — see TOPUP_PACKS.
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
// Capped so the total edit duration stays UNDER Cloudflare's 100s proxy
// timeout — going over kills the stream client-side ("Load failed") even
// though the server completes happily. With our agent averaging 5-10s per
// tool call, ~8 turns is the realistic ceiling at the free CF plan.
// If we move to a paid CF plan (or DNS-only for the API), bump these back up.
export const MAX_TURNS_PER_TIER: Record<Tier, number> = {
  free: 6,
  pro: 10,
  team: 14,
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

// R2 file upload storage per user. Free is intentionally tight to keep abuse
// (someone signing up just to host a movie) small while still letting a real
// user upload a few menu / product photos. Pro covers a small SMB shop. Max
// covers a serious catalog or course platform.
export const UPLOAD_BYTES_LIMITS: Record<Tier, number> = {
  free:   50 * 1024 * 1024,         //   50 MB
  pro:     5 * 1024 * 1024 * 1024,  //    5 GB
  team:   50 * 1024 * 1024 * 1024,  //   50 GB
};

export function projectLimit(email: string): number {
  if (isUnlimited()) return Number.MAX_SAFE_INTEGER;
  return PROJECT_LIMITS[tierFor(email)];
}

export function deployLimit(email: string): number {
  if (isUnlimited()) return Number.MAX_SAFE_INTEGER;
  return DEPLOY_LIMITS[tierFor(email)];
}

export function uploadBytesLimit(email: string): number {
  if (isUnlimited()) return Number.MAX_SAFE_INTEGER;
  return UPLOAD_BYTES_LIMITS[tierFor(email)];
}

// === TOKEN TOPUP PACKS ===
//
// One-time PayPal purchases that add weighted tokens to the current month's
// quota (consumed before/alongside the subscription quota; either way the
// total `remaining` just goes up). Only Pro and Max can buy — Free users see
// "upgrade tier" instead so they can't avoid the subscription path.
//
// Pricing is intentionally a 1.5-2.5× premium per token vs the matching
// subscription tier so users still prefer upgrading their plan. Topup is
// "emergency fuel" for users who would otherwise be blocked.
export type TopupPackId = "pack10m" | "pack25m";
export interface TopupPack {
  id: TopupPackId;
  tokens: number;     // weighted tokens added
  priceUsd: number;
  label: string;      // i18n key isn't worth it for 2 strings; inline.
}
// Prices set assuming PayPal cross-border fee of 4.4% + $0.30. Post-fee
// per-token rate stays ≥ 2× the matching subscription so users still see
// upgrading their plan as the cheaper long-term option.
export const TOPUP_PACKS: Record<TopupPackId, TopupPack> = {
  pack10m: { id: "pack10m", tokens: 10_000_000, priceUsd: 19, label: "10M Token" },
  pack25m: { id: "pack25m", tokens: 25_000_000, priceUsd: 39, label: "25M Token" },
};
export function isValidPackId(id: unknown): id is TopupPackId {
  return typeof id === "string" && id in TOPUP_PACKS;
}

// Tiers allowed to buy topups (Free has to upgrade their plan first).
export function canBuyTopup(email: string): boolean {
  const t = tierFor(email);
  return t === "pro" || t === "team";
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

// Sum of `tokens_added` from completed topups in the user's current period.
// Cached not worth it — single indexed query, tiny rows.
export function getTopupTokens(email: string, period: string = currentPeriod()): number {
  const row = getDb()
    .prepare(
      "SELECT COALESCE(SUM(tokens_added), 0) AS n FROM topups WHERE user_email = ? AND period = ? AND status = 'completed'"
    )
    .get(email, period) as { n: number };
  return row.n;
}

export function getUsage(email: string): UsageInfo {
  const period = currentPeriod();
  const tier = tierFor(email);
  const row = getDb()
    .prepare("SELECT tokens_used FROM usage WHERE user_email = ? AND period = ?")
    .get(email, period) as { tokens_used: number } | undefined;
  const used = row?.tokens_used ?? 0;
  const unlimited = isUnlimited();
  // Subscription quota + any topup tokens purchased this period. Topups expire
  // at period rollover by design (same window as sub).
  const baseQuota = unlimited ? Number.MAX_SAFE_INTEGER : TIER_LIMITS[tier];
  const topupTokens = unlimited ? 0 : getTopupTokens(email, period);
  const quota = unlimited ? baseQuota : baseQuota + topupTokens;
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
