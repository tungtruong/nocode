// LLM-only capability classifier — given any-language user prompt, decides
// which `jv.*` capabilities the generated app needs so /api/chat can inject
// only the relevant docs into the system prompt.
//
// We deliberately avoid keyword/regex matching here. Users speak Vietnamese,
// English, mixed Vinglish, sometimes Chinese-character names, sometimes
// emoji-heavy. Regex misses cases ("voi của tôi" = "vault for my own" type
// puns), and adding per-language keyword tables for 5+ languages is a tax
// every new feature pays. A single tiny LLM call (~50 in / ~30 out tokens)
// covers everything for ~$0.00001 per request.
//
// Cost discipline: max_tokens 300 (DeepSeek's chat model now emits hidden
// reasoning_content tokens before the visible answer — a tight budget gets
// fully consumed by reasoning and returns empty content), temperature 0.
// Failure = "include everything" so we never break a generation over
// classifier errors; the cost of an extra ~400 prompt tokens in that
// fallback is far less than a missed feature in the gen output.

import { createCompletionWithFallback } from "./ai";
import { recordUsage } from "./quota";
import { CAPABILITY_NAMES, type CapabilityName } from "./jv-capabilities";

const CLASSIFIER_PROMPT = `You decide which runtime capabilities a single-file HTML web app needs based on the user's request. The user may write in Vietnamese, English, or any mix.

Available capabilities:
- forms     — the app collects input from visitors via an HTML form (signup, contact, RSVP, order, booking request, lead capture, survey, quiz, registration, feedback)
- db        — the app shows a list of items the OWNER will edit later (menu, catalog, products, listings, news, events, team, gallery items, real-estate properties, schedule)
- auth      — the app needs per-end-user login so each visitor sees only their own data (journal, personal todo, notes, bookmarks, "my orders", member-only content, profile page, personal dashboard)
- files     — the app needs the OWNER or end-user to UPLOAD files: real product photos, menu food photos, profile avatar, gallery images, PDF resume / brochure, voice notes, course materials, attachment, document
- realtime  — the app updates LIVE without page refresh: chat, comments, live order ticket / kitchen display, voting / poll counters, multiplayer presence, live event attendee count, collaborative whiteboard, sports score, auction bidding
- payment   — the app needs to ACCEPT money from visitors via VN bank transfer (VietQR): booking deposit, event ticket sale, product order, donation, tip jar, wedding gift, course fee, paid membership signup, restaurant deposit. Vietnamese market specifically.

Rules:
- A purely static page (CV with no real avatar, wedding invite, simple landing, pitch deck, calculator, single-page tool that runs in the browser) needs NONE of these — return [].
- 'forms' covers gathering data INTO the system. 'db' covers showing/managing data OUT OF the system. They are independent.
- 'auth' implies the app needs at least 'db' for the per-user data — include both if you pick auth.
- 'files' usually pairs with 'db' (the upload URL needs to be saved somewhere). Include 'db' if you pick 'files' for catalog/menu/listing photos. A CV that needs a real photo upload is the exception — 'files' alone is fine there.
- 'realtime' implies 'db' (you subscribe to db changes) — include both.
- 'payment' often pairs with 'forms' (confirmation note) or 'db' (order tracking); include those if the description implies "save the order" or "notify owner".
- Be CONSERVATIVE. When in doubt, return fewer capabilities. The model can always add later.

Output: STRICT JSON only, one line, no prose, no markdown fence. Must contain the word "json" in your understanding only — output is pure data:
  {"caps":["forms","db","files"]}

Empty case:
  {"caps":[]}`;

export interface CapabilityPick {
  caps: CapabilityName[];
  source: "llm" | "llm_fallback" | "error_default";
  raw?: string;
}

const DEFAULT_ON_ERROR: CapabilityName[] = ["forms", "db", "auth", "files", "realtime", "payment"];

function safeParse(raw: string): CapabilityName[] | null {
  // Trim ```json fences, leading/trailing junk.
  const cleaned = raw
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  // Find the first { ... } substring.
  const m = cleaned.match(/\{[^{}]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as { caps?: unknown };
    if (!Array.isArray(obj.caps)) return null;
    const filtered = obj.caps.filter(
      (c): c is CapabilityName => typeof c === "string" && (CAPABILITY_NAMES as readonly string[]).includes(c),
    );
    // If auth is picked, db is required.
    if (filtered.includes("auth") && !filtered.includes("db")) filtered.push("db");
    // If realtime is picked, db is required.
    if (filtered.includes("realtime") && !filtered.includes("db")) filtered.push("db");
    // Dedupe preserving order from CAPABILITY_NAMES so prompt assembly is deterministic.
    return CAPABILITY_NAMES.filter((c) => filtered.includes(c));
  } catch {
    return null;
  }
}

export async function classifyCapabilities(
  message: string,
  userEmail?: string,
  modelOverride?: string | null,
): Promise<CapabilityPick> {
  const trimmed = message.trim().slice(0, 800);
  if (!trimmed) return { caps: [], source: "llm" };

  try {
    const { result, provider } = await createCompletionWithFallback(
      {
        messages: [
          { role: "system", content: CLASSIFIER_PROMPT },
          // DeepSeek's json_object mode silently returns empty content unless
          // the literal word "json" appears in messages. Cheap & safe to put
          // it here AND drop the response_format constraint — the parser
          // below already tolerates loose formatting.
          { role: "user", content: `${trimmed}\n\n(return strict JSON)` },
        ],
        temperature: 0,
        // Thinking-disabled below: tight budget is fine because the model
        // emits the JSON directly without hidden chain-of-thought tokens.
        max_tokens: 120,
        // DeepSeek-V4 hybrid-thinking opt-out. OpenAI SDK strips unknown
        // typed params; spread-cast forwards the raw field through.
        ...({ thinking: { type: "disabled" } } as Record<string, unknown>),
      },
      (reason) => console.log(`[CAPS] fallback to OpenAI: ${reason}`),
      modelOverride,
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

    console.log(`[CAPS] (${provider.name}) pick=${JSON.stringify(parsed ?? "PARSE_FAIL")} raw=${raw.trim().slice(0, 80)}`);
    return { caps: parsed ?? DEFAULT_ON_ERROR, source: parsed ? "llm" : "llm_fallback", raw };
  } catch (err) {
    console.error("[CAPS] classifier error, defaulting to all:", err instanceof Error ? err.message : err);
    return { caps: DEFAULT_ON_ERROR, source: "error_default" };
  }
}
