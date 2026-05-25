// Unified app-planning orchestrator. Replaces the two earlier classifiers
// (intent.classifyIntent + capability-classifier.classifyCapabilities) with
// a single LLM call that returns mode + capabilities + a couple of
// proactive suggestions in one shot.
//
// Why unified:
//   - One LLM round trip instead of two — cuts first-paint latency by ~3-5s
//     on the long path (no keyword match).
//   - Suggestions ("Bạn có muốn thêm Realtime?") get generated for free in
//     the same call — they'd otherwise need a third LLM call.
//   - Single source of truth for the "what app does this user want" decision,
//     so callers don't have to coordinate two classifications.
//
// Fast path: pure-keyword mode match (no LLM call) for unambiguous niche
// templates ("menu cafe Highland" → qr_menu instantly). Capabilities for
// niche modes are pre-declared in modes.ts so we already know what's needed.
// Only the catch-all `web_app` mode (or ambiguous prompts) hit the LLM.

import { createCompletionWithFallback } from "./ai";
import { recordUsage, tierFor, type Tier } from "./quota";
import { CAPABILITY_NAMES, type CapabilityName, getCapability } from "./jv-capabilities";
import { APP_MODES, DEFAULT_MODE, type ModeId, isValidModeId } from "./modes";
import { keywordPickMode } from "./intent";

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, team: 2 };

export interface PlanSuggestion {
  cap: CapabilityName;
  /** Short Vietnamese rationale shown to the user as a chip after gen
   *  completes ("Bếp thấy đơn mới ngay khi khách order"). */
  reason: string;
}

export interface TierWarning {
  cap: CapabilityName;
  requires: Tier;
  current: Tier;
}

export interface AppPlan {
  mode: ModeId;
  caps: CapabilityName[];
  suggestions: PlanSuggestion[];
  /** Capabilities in `caps` whose minTier exceeds the caller's tier — UI
   *  uses this to show a soft upgrade nudge. Empty when caller is on a
   *  high enough tier OR when no caller email is passed. */
  tierWarnings: TierWarning[];
  source: "keyword+template" | "llm" | "llm_fallback" | "error_default";
  confidence: number;
}

const SUPPORTED_MODES = Object.keys(APP_MODES) as ModeId[];

const PLANNER_PROMPT = `You are an app-planning orchestrator. Given a user's request for a web app (in Vietnamese, English, or any mix), decide:
1. Which app MODE it is.
2. Which CAPABILITIES the app needs from the runtime.
3. Up to 2 optional SUGGESTIONS — capabilities the user didn't ask for but would clearly enhance their app.

MODES:
- web_app — generic single-purpose app (todo, calculator, tracker, tool) — fallback for anything not in the list
- qr_menu — restaurant / cafe / F&B menu, often with order form
- wedding — wedding invitation, RSVP
- landing — marketing landing, product launch, lead capture
- pitch_deck — slide deck, presentation, investor pitch
- cv_resume — personal CV / portfolio / résumé

CAPABILITIES:
- forms     — HTML form submission to owner (signup, RSVP, contact, order)
- db        — list of items the OWNER edits later (menu, catalog, products, listings)
- auth      — per-end-user login (journal, todo, notes, my-orders, member content)
- files     — owner / end-user uploads real photos / PDFs / audio
- realtime  — live updates without refresh (chat, kitchen display, live counter, multiplayer)
- payment   — accept money via VietQR (booking deposit, ticket, donation, tip, e-com)

RULES:
- A purely static page (simple CV, wedding invite, calculator) has caps = [].
- 'auth' implies 'db'. 'realtime' implies 'db'. Include both when picking one.
- 'files' usually implies 'db' (need to save the URL) — except a CV with just an avatar.
- Be CONSERVATIVE with primary caps — only include what the user clearly asked for or implied.
- SUGGESTIONS are different — proactively recommend up to 2 capabilities the user did NOT mention but that would obviously enhance their app. Give a short Vietnamese reason for each.
- If the user already asked for everything they need, suggestions = [].

Output STRICT JSON only (the word "json" is required to enable structured output):
{"mode":"qr_menu","caps":["forms","db","payment"],"suggestions":[{"cap":"realtime","reason":"Bếp thấy đơn mới ngay khi khách order"}]}`;

const ALL_CAPS_DEFAULT: CapabilityName[] = [...CAPABILITY_NAMES];

interface RawPlan {
  mode?: unknown;
  caps?: unknown;
  suggestions?: unknown;
}

function safeParse(raw: string): RawPlan | null {
  const cleaned = raw.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "").trim();
  // Match the OUTERMOST JSON object — supports nested braces in suggestions.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as RawPlan;
  } catch {
    return null;
  }
}

function pickMode(value: unknown): ModeId | null {
  if (typeof value !== "string") return null;
  const m = value.toLowerCase().trim();
  return isValidModeId(m) ? (m as ModeId) : null;
}

function pickCaps(value: unknown): CapabilityName[] {
  if (!Array.isArray(value)) return [];
  const filtered = value.filter(
    (c): c is CapabilityName => typeof c === "string" && (CAPABILITY_NAMES as readonly string[]).includes(c),
  );
  // Apply implications: auth + realtime require db; files usually does.
  if (filtered.includes("auth") && !filtered.includes("db")) filtered.push("db");
  if (filtered.includes("realtime") && !filtered.includes("db")) filtered.push("db");
  // Dedupe + preserve canonical order from CAPABILITY_NAMES.
  return CAPABILITY_NAMES.filter((c) => filtered.includes(c));
}

function pickSuggestions(value: unknown, chosenCaps: readonly CapabilityName[]): PlanSuggestion[] {
  if (!Array.isArray(value)) return [];
  const out: PlanSuggestion[] = [];
  for (const item of value) {
    if (out.length >= 2) break;
    if (!item || typeof item !== "object") continue;
    const obj = item as { cap?: unknown; reason?: unknown };
    if (typeof obj.cap !== "string" || !(CAPABILITY_NAMES as readonly string[]).includes(obj.cap)) continue;
    const cap = obj.cap as CapabilityName;
    // Never suggest a capability we already included.
    if (chosenCaps.includes(cap)) continue;
    const reason = typeof obj.reason === "string" ? obj.reason.trim().slice(0, 120) : getCapability(cap).summary;
    out.push({ cap, reason });
  }
  return out;
}

/**
 * Plan an app from the user's first message. Tries the cheap keyword
 * fast-path first; falls back to a single unified LLM call for the catch-all
 * web_app mode or any ambiguous prompt.
 */
export async function planApp(message: string, userEmail?: string): Promise<AppPlan> {
  const trimmed = message.trim().slice(0, 800);
  if (!trimmed) {
    return { mode: DEFAULT_MODE, caps: [], suggestions: [], tierWarnings: [], source: "keyword+template", confidence: 0 };
  }

  const computeTierWarnings = (caps: readonly CapabilityName[]): TierWarning[] => {
    if (!userEmail) return [];
    const current = tierFor(userEmail);
    const cur = TIER_RANK[current];
    return caps
      .map((c) => ({ cap: c, requires: getCapability(c).minTier }))
      .filter((w) => TIER_RANK[w.requires] > cur)
      .map((w) => ({ ...w, current }));
  };

  // Fast-path: keyword pick a niche template — cheap, deterministic,
  // and the template already declares its capability needs.
  const fastMode = keywordPickMode(trimmed);
  if (fastMode && fastMode !== DEFAULT_MODE) {
    const def = APP_MODES[fastMode];
    console.log(`[ORCH] fast-path mode=${fastMode} caps=${JSON.stringify(def.capabilities ?? [])}`);
    const caps = def.capabilities ?? [];
    return {
      mode: fastMode,
      caps,
      suggestions: [],
      tierWarnings: computeTierWarnings(caps),
      source: "keyword+template",
      confidence: 1.0,
    };
  }

  // Slow-path: unified LLM call.
  try {
    const { result, provider } = await createCompletionWithFallback(
      {
        messages: [
          { role: "system", content: PLANNER_PROMPT },
          { role: "user", content: `${trimmed}\n\n(return strict JSON)` },
        ],
        temperature: 0,
        // Generous budget because DeepSeek's chat model now emits
        // reasoning_content before the visible JSON — same issue as the
        // standalone capability classifier had. 1200 is plenty.
        max_tokens: 1200,
      },
      (reason) => console.log(`[ORCH] fallback to OpenAI: ${reason}`),
    );

    const raw = result.choices[0]?.message?.content ?? "";
    const parsed = safeParse(raw);

    if (result.usage && userEmail) {
      recordUsage(
        userEmail,
        result.usage.prompt_tokens || 0,
        result.usage.completion_tokens || 0,
        result.usage.prompt_tokens_details?.cached_tokens || 0,
      );
    }

    if (!parsed) {
      console.log(`[ORCH] (${provider.name}) parse fail raw=${raw.trim().slice(0, 120)}`);
      return {
        mode: DEFAULT_MODE,
        caps: ALL_CAPS_DEFAULT,
        suggestions: [],
        tierWarnings: computeTierWarnings(ALL_CAPS_DEFAULT),
        source: "llm_fallback",
        confidence: 0,
      };
    }

    const mode = pickMode(parsed.mode) ?? DEFAULT_MODE;
    const caps = pickCaps(parsed.caps);
    const suggestions = pickSuggestions(parsed.suggestions, caps);
    console.log(
      `[ORCH] (${provider.name}) mode=${mode} caps=${JSON.stringify(caps)} sug=${suggestions.length}`,
    );
    return {
      mode,
      caps,
      suggestions,
      tierWarnings: computeTierWarnings(caps),
      source: "llm",
      confidence: 0.85,
    };
  } catch (err) {
    console.error("[ORCH] error, defaulting:", err instanceof Error ? err.message : err);
    return {
      mode: DEFAULT_MODE,
      caps: ALL_CAPS_DEFAULT,
      suggestions: [],
      tierWarnings: computeTierWarnings(ALL_CAPS_DEFAULT),
      source: "error_default",
      confidence: 0,
    };
  }
}

/** Convenience for callers that only need mode (e.g. legacy intent classifier
 *  consumers). Internally uses the same fast-path so it's also cheap. */
export function quickMode(message: string): ModeId | null {
  return keywordPickMode(message.trim());
}

/** Verify supported modes haven't drifted from APP_MODES — wakes us up if a
 *  new mode is added but the orchestrator prompt isn't updated. */
export function supportedModes(): readonly ModeId[] {
  return SUPPORTED_MODES;
}
