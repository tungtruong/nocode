import { NextRequest, NextResponse } from "next/server";
import { detectPromptViolation, scanGeneratedHtml, checkRateLimit } from "@/lib/security";
import { requireSession, authError, type Session } from "@/lib/auth";
import { getPrimary, getFallback, createStreamWithFallback, withFallback } from "@/lib/ai";
import { assertQuota, recordUsage, perRequestLimit, weightedTokens } from "@/lib/quota";
import { APP_MODES, modeOf, type ModeId } from "@/lib/modes";
import { logTemplateUsage } from "@/lib/store";
import { substitutePlaceholders } from "@/lib/html-substitute";
import { joinDocs, type CapabilityName } from "@/lib/jv-capabilities";
import { planApp, type AppPlan } from "@/lib/orchestrator";
import { createJob, setHtml, setPlan, finishJob, finishJobError } from "@/lib/gen-jobs";

// Base prompt for "new app" generation. The DATA / AUTH / FORMS capability
// sections used to live inline here, but they cost ~1k prompt tokens on EVERY
// generation — wasted on the 50%+ of apps that are pure-static (CV, wedding
// invite, calculator, simple landing). We now classify the user's request
// upfront and concatenate only the relevant capability docs below this base.
const NEW_APP_PROMPT_BASE = `## ROLE
You are a web app generator. Build ONE complete single-file HTML app matching the user's description.

## OUTPUT FORMAT — STRICT
- Output ONLY raw HTML. No markdown fences. No prose before or after.
- First character must be "<". Last lines must end with </html>.
- All JavaScript MUST be inside <script> tags AND inside functions or event listeners — no top-level statements other than \`let\`, \`const\`, \`function\` declarations.
- All CSS MUST be inside a single <style> tag in <head>.

## DESIGN PRINCIPLES
- Match scope: a "simple counter" → no extra features. A "todo app with reminders" → include reminders.
- Modern but minimal: system font stack, clean spacing, subtle shadows, dark UI by default unless user specifies otherwise.
- Semantic HTML5 (button, nav, main, section).
- Keep app state in memory (JavaScript variables). Do NOT use localStorage/sessionStorage — they are unavailable in the preview sandbox. If you want persistence, mention it in a UI hint instead.
- Escape user input before injecting into innerHTML.

## MOBILE-FIRST SIZING — NON-NEGOTIABLE
The audience is Vietnamese users on phones. Tight text + small buttons get
abandoned. Hit these minimums:
- Body text: **16px** (1rem). Headings ≥ 20px.
- Inputs / textarea / select: **font-size: 16px** AT MINIMUM. Anything
  smaller triggers iOS Safari to auto-zoom on focus.
- Tap targets (buttons, links, checkboxes, inputs): height ≥ **48px**.
  Pad buttons \`0.85rem 1.5rem\` minimum.
- Vertical gap between form fields ≥ **16px** so thumbs don't mis-tap.
- Single-column layout under 640px. Use \`@media (max-width: 640px)\` to
  collapse multi-column grids.
- Viewport meta MUST be: \`<meta name="viewport" content="width=device-width, initial-scale=1">\`
  Do NOT add \`maximum-scale=1\` or \`user-scalable=no\` — pinch zoom is an
  accessibility right.
- Use \`box-sizing: border-box\` on \`*\` so padding doesn't break layouts.
- Buttons should look pressable: solid background, visible border-radius
  (8-12px), \`cursor: pointer\`, hover/active states.

## IMAGES
- External HTTPS image URLs WORK (img-src includes https:). Use them freely for photos/banners/galleries/avatars.
- Default placeholder hosts:
  - \`https://picsum.photos/seed/<keyword>/<w>/<h>\` — random matched photos
  - \`https://images.unsplash.com/photo-<id>?w=<w>\` — Unsplash if you know an id
- Pick dimensions per role: hero 1600x800, card 400x300, avatar 120x120, thumbnail 200x200.
- For icons, use inline SVG. For photos, use external URLs — do NOT try to draw a photo as SVG.
- NEVER tell the user "I can't fetch images" — that's outdated, images work fine.

## INTERACTIVITY — EVERY BUTTON MUST DO SOMETHING
Don't ship buttons that look pretty but do nothing. For each interactive
element in your output, decide what it does up-front and wire it:

- "Liên hệ" / "Contact" / "Gọi ngay": use a real anchor:
    <a href="tel:+84xxxxxxxxx">📞 Gọi ngay</a>
    <a href="mailto:contact@example.com">✉ Email</a>
    <a href="https://zalo.me/<phone>" target="_blank">💬 Zalo</a>
  Don't use \`<button onclick="alert('Coming soon')">\` — looks broken.

- "Xuất PDF" / "In CV" / "Print": \`<button onclick="window.print()">In</button>\`
  Add a \`@media print { ... }\` CSS block to hide nav/buttons during print.

- "Đặt hàng" / "Đăng ký" / forms: use \`<form action="/f/{{APP_ID}}/submit">\`
  (see FORMS section below).

- "Chia sẻ": \`<button onclick="navigator.share({title,url})">\` with
  fallback to copy-to-clipboard via \`navigator.clipboard.writeText()\`.

- "Copy link": \`navigator.clipboard.writeText(...)\` + temporary
  "Copied!" feedback.

- "Đặt lịch" / "Book now": for now use mailto or form action — no
  calendar integration yet.

- Pop-up "Notify when ready" etc: use \`alert()\` only as last resort;
  prefer inline toast div that auto-hides after 2s.

NEVER leave an \`<button>\` without an onclick OR an \`<a>\` with empty
href. Both look broken in preview when the user tests.

## DO NOT
- Do not include analytics, tracking, external CDN scripts unless explicitly requested.
- Do not add features (auth, settings, theme toggle, export) unless the user asks.
- Do not output Lorem Ipsum — use realistic Vietnamese sample data when content is needed.

START NOW with <!DOCTYPE html>`;

/**
 * Build the new-app system prompt by gluing the base + per-capability docs.
 * For static apps (caps=[]), this returns just the base — saving ~1k tokens
 * of prompt vs. the always-inline previous version.
 */
function buildNewAppPrompt(caps: readonly CapabilityName[]): string {
  if (caps.length === 0) return NEW_APP_PROMPT_BASE;
  return `${NEW_APP_PROMPT_BASE}\n\n${joinDocs(caps)}`;
}

// Used when a niche mode (qr_menu, wedding, ...) has a template skeleton. The
// model receives the template + user request and FILLS placeholders rather
// than authoring the whole document. Cuts completion tokens ~50-60% vs a
// from-scratch generation.
const TEMPLATE_FILL_PROMPT = `## ROLE
You receive an HTML template skeleton + a user request. Your ONLY job: emit the COMPLETE final HTML by substituting placeholders and expanding fill blocks.

## OUTPUT FORMAT — STRICT
- Output ONLY raw HTML. No markdown fences. No prose before or after.
- First character must be "<". Last lines must end with </html>.
- Replace EVERY {{PLACEHOLDER}} with a real value (no {{X}} can remain in output).
- Replace EVERY \`<!-- LLM_FILL: ... -->\` block with the HTML the instruction describes.
- Keep EVERYTHING ELSE byte-identical (CSS, script, layout, classes).

## CONTENT RULES
- Use realistic Vietnamese values matching the user's request (real names, real prices in VND, real Vietnamese addresses where applicable).
- Color values: pick a tasteful palette matching the brand/vibe described. Use hex codes.
- For LLM_FILL blocks, generate enough content to feel finished but not bloated (6-12 items for menus, 4-6 photos for galleries, 3-5 features for landing, 6-9 slides for decks, etc.).
- MOBILE-FIRST: any new \`<input>\`, \`<select>\`, \`<textarea>\`, \`<button>\` you add MUST have font-size ≥ 16px and tap-target height ≥ 48px. If the template's existing CSS uses smaller sizes, override with \`style="font-size:16px;padding:14px 16px"\` inline on the new element.
- For images use HTTPS URLs from picsum.photos (\`https://picsum.photos/seed/<keyword>/<w>/<h>\`) or Unsplash. Pick keywords matching the section (e.g. wedding gallery → \`seed/wedding-1\`, menu item → \`seed/banhmi\`). Do NOT leave image src as a literal "image.jpg" or similar — that breaks the preview.
- Do NOT add sections the template doesn't ask for.
- Do NOT remove or restructure the template's existing markup.`;

function validateHtml(html: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!html.trim()) {
    errors.push("HTML is empty");
    return { valid: false, errors };
  }

  if (!/<html/i.test(html)) errors.push("Missing <html> tag");
  if (!/<\/html>/i.test(html)) errors.push("Missing closing </html>");
  if (!/<body/i.test(html)) errors.push("Missing <body> tag");
  if (!/<\/body>/i.test(html)) errors.push("Missing closing </body>");

  if (/```html/i.test(html) || /```\s*$/.test(html)) {
    errors.push("Output contains markdown fences — should be raw HTML only");
  }

  const firstLine = html.trimStart().slice(0, 50).toLowerCase();
  if (firstLine.length > 0 && !firstLine.startsWith("<!") && !firstLine.startsWith("<html")) {
    errors.push("Output starts with text instead of HTML — strip preamble");
  }

  return { valid: errors.length === 0, errors };
}

function cleanHtml(raw: string): string {
  let cleaned = raw;
  cleaned = cleaned.replace(/```html?\s*\n?/gi, "").replace(/```\s*$/g, "");
  const htmlStart = Math.min(
    cleaned.indexOf("<!DOCTYPE") === -1 ? Infinity : cleaned.indexOf("<!DOCTYPE"),
    cleaned.indexOf("<html") === -1 ? Infinity : cleaned.indexOf("<html")
  );
  if (htmlStart > 0 && htmlStart < Infinity) {
    cleaned = cleaned.slice(htmlStart);
  }
  const htmlEnd = cleaned.lastIndexOf("</html>");
  if (htmlEnd > 0) {
    cleaned = cleaned.slice(0, htmlEnd + 7);
  }
  return cleaned;
}

export async function POST(req: NextRequest) {
  try {
    let session: Session;
    try { session = await requireSession(); } catch { return authError(); }

    const body = await req.json();
    const { newMessage, projectId } = body as { newMessage?: unknown; projectId?: unknown };
    const mode: ModeId = modeOf(body?.mode);
    const modeDef = APP_MODES[mode];
    const projId = typeof projectId === "string" ? projectId : null;

    if (!newMessage || typeof newMessage !== "string") {
      return NextResponse.json({ error: "Thiếu nội dung" }, { status: 400 });
    }
    if (newMessage.length > 5000) {
      return NextResponse.json({ error: "Nội dung quá dài (tối đa 5000 ký tự)" }, { status: 400 });
    }

    const violation = detectPromptViolation(newMessage);
    if (violation) {
      return NextResponse.json({ error: "Bị chặn nội dung" }, { status: 400 });
    }

    const rl = checkRateLimit(`user:${session.email}`);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Quá giới hạn. Thử lại sau." }, { status: 429 });
    }
    try { assertQuota(session.email); } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Hết quota", code: "QUOTA_EXCEEDED" }, { status: 402 });
    }

    if (!getPrimary() && !getFallback()) {
      return NextResponse.json({ error: "API key chưa cấu hình" }, { status: 500 });
    }

    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        let closed = false;
        const safeEnqueue = (data: Uint8Array) => {
          if (closed) return;
          try {
            controller.enqueue(data);
          } catch {
            // Client disconnected or controller was force-closed; stop pushing.
            closed = true;
          }
        };
        const safeClose = () => {
          if (closed) return;
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        };
        const sendProgress = (msg: string) => safeEnqueue(encoder.encode(`\x1E${msg}\n`));
        const sendChunk = (s: string) => safeEnqueue(encoder.encode(s));

        // IMPORTANT: do NOT mark this stream closed when the client aborts.
        // Mobile browsers throttle/kill tabs that go to background; if we tore
        // down generation on every abort, switching apps mid-gen would lose
        // the whole output. Instead, `closed` only flips when controller.enqueue
        // throws — meaning the response stream is actually torn down by Node.
        // The server-side gen keeps running and lands in gen_jobs DB so a
        // resuming client can pick up where the original stream dropped.

        // Pre-create the background-job row so the very first event the client
        // sees is the resume token. If anything below this point errors, the
        // catch block flips status to 'error' — clients can still see the
        // failure via /api/chat/resume/<jobId>.
        const jobId = createJob(session.email, projId);
        sendProgress(`job ${jobId}`);

        // Persist throttle — at most once every 1.5s so we don't hammer SQLite
        // for every 80-char chunk DeepSeek emits. Final write happens in
        // finishJob regardless, so brief gaps between the last persist and
        // 'complete' don't lose data.
        let lastPersistAt = 0;
        const persistThrottled = (html: string) => {
          const now = Date.now();
          if (now - lastPersistAt < 1500) return;
          lastPersistAt = now;
          try { setHtml(jobId, html); } catch (e) {
            console.warn(`[Chat] persist failed for ${jobId}:`, e instanceof Error ? e.message : e);
          }
        };

        try {
          sendProgress("progress thinking");
          sendProgress("progress generating");

          // Mode dispatch:
          //   - web_app (no template): generic prompt, larger token budget.
          //   - niche modes (qr_menu/wedding/...): TEMPLATE_FILL_PROMPT + the
          //     template skeleton in the user message; tighter token budget
          //     since the model only fills placeholders, not the whole doc.
          const usingTemplate = !!modeDef.template;
          // One unified orchestrator call replaces the previous two-step
          // (intent + capability classifier) flow. For niche templates the
          // capabilities are pre-declared in modes.ts so we still skip the
          // LLM and just read them — keeping cost flat for the common path.
          let chosenCaps: CapabilityName[] = [];
          let plan: AppPlan | null = null;
          if (usingTemplate) {
            chosenCaps = modeDef.capabilities ?? [];
          } else {
            sendProgress("progress planning");
            plan = await planApp(newMessage, session.email);
            chosenCaps = plan.caps;
            // Stream the plan to the client BEFORE generation starts so the UI
            // can render a "Sẽ tạo: X + Y + Z" banner while the model warms up.
            // Out-of-band progress marker — the client filters \x1E lines.
            const slimPlan = {
              mode: plan.mode,
              caps: plan.caps,
              suggestions: plan.suggestions,
              tierWarnings: plan.tierWarnings,
              source: plan.source,
            };
            sendProgress(`plan ${encodeURIComponent(JSON.stringify(slimPlan))}`);
            // Mirror plan into the job row so resuming clients also get the
            // banner — otherwise they'd reconnect without knowing why the
            // gen has the caps it does.
            try { setPlan(jobId, JSON.stringify(slimPlan)); } catch { /* persist failure not fatal */ }
            console.log(`[Chat] caps=${JSON.stringify(chosenCaps)} src=${plan.source} sug=${plan.suggestions.length}`);
          }
          const systemPrompt = usingTemplate
            ? `${TEMPLATE_FILL_PROMPT}\n\n${modeDef.systemHints}${chosenCaps.length ? `\n\n${joinDocs(chosenCaps)}` : ""}`
            : buildNewAppPrompt(chosenCaps);
          const userPrompt = usingTemplate
            ? `TEMPLATE:\n${modeDef.template}\n\nUSER REQUEST: ${newMessage}`
            : newMessage;
          const maxTokens = usingTemplate ? 6000 : 16000;
          console.log(`[Chat] mode=${mode} template=${usingTemplate} maxTokens=${maxTokens}`);

          const { stream: genStream } = await createStreamWithFallback({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: usingTemplate ? 0.5 : 0.7,
            max_tokens: maxTokens,
            // Orchestrator already decided mode + caps; capability docs give
            // the model exact API surface; mode template gives the skeleton.
            // Main gen doesn't need hidden chain-of-thought before writing
            // HTML — that was 5-15s of "stuck" UX before any visible chunks
            // arrived. Same model, just opt-out of reasoning.
            ...({ thinking: { type: "disabled" } } as Record<string, unknown>),
          }, (reason) => {
            console.log(`[Chat] fallback to OpenAI for gen: ${reason}`);
            sendProgress("progress fallback");
          });

          // Transition the progress bubble away from the last "planning" /
          // "generating" label as soon as bytes start arriving. The byte-
          // count progress events below do further visible work each second.
          sendProgress("progress writing");

          let accumulated = "";
          let promptTokens = 0;
          let completionTokens = 0;
          let cachedTokens = 0;
          let lastProgressAt = Date.now();
          // Defensive idle heartbeat — if the model goes silent for more
          // than 1.5s (rare with thinking disabled, but happens on slow
          // provider days), emit a tick so the bubble doesn't look stuck.
          // Client just re-renders the current byte count + elapsed time.
          const idleTick = setInterval(() => {
            const now = Date.now();
            if (now - lastProgressAt > 1500) {
              sendProgress(`writing ${accumulated.length}`);
              lastProgressAt = now;
            }
          }, 1000);

          try {
          for await (const chunk of genStream) {
            // NB: we no longer break on `closed`. The send-to-client paths
            // (sendChunk/sendProgress) are no-ops once closed, but we keep
            // draining the AI stream so the final HTML still lands in DB —
            // a backgrounded mobile client picks it up via /resume.
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              accumulated += content;
              sendChunk(content);
              persistThrottled(accumulated);
              const now = Date.now();
              if (now - lastProgressAt > 700) {
                lastProgressAt = now;
                // Single-token integer payload — the client renders this as
                // "Đang viết HTML... 3.4KB". Cheap, no JSON parse.
                sendProgress(`writing ${accumulated.length}`);
              }
            }
            // stream_options.include_usage delivers totals in the final chunk
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens || 0;
              completionTokens = chunk.usage.completion_tokens || 0;
              // DeepSeek + OpenAI both surface cache hits here. Counted at the
              // discounted rate inside weightedTokens — this is what makes a
              // long stable system+context prefix cheap on repeat calls.
              cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0;
            }
          }
          } finally {
            clearInterval(idleTick);
          }
          let billedTokens = weightedTokens(promptTokens, completionTokens, cachedTokens);
          if (billedTokens > 0) recordUsage(session.email, promptTokens, completionTokens, cachedTokens);
          // If the gen call alone blew through the per-request budget, skip
          // fix + summary (both cost more tokens) and ship what we have.
          const tokenBudget = perRequestLimit(session.email);
          const overBudget = billedTokens >= tokenBudget;

          // (Used to early-return when `closed` — removed so the final HTML
          // still lands in gen_jobs for a resuming client. Sends to the
          // disconnected client are already no-op via safeEnqueue.)

          // Validate full output. Fix only if a critical error makes the HTML un-renderable.
          const cleaned = cleanHtml(accumulated);
          const { valid, errors } = validateHtml(cleaned);
          if (!valid && errors.length > 0 && !overBudget) {
            const critical = errors.filter(
              (e) =>
                e.includes("Missing <html>") ||
                e.includes("Missing <body>") ||
                e.includes("markdown fences") ||
                e.includes("starts with text")
            );

            if (critical.length > 0) {
              sendProgress("progress correcting");
              // Tell the client to wipe its preview accumulator so the corrected
              // HTML replaces the broken one cleanly (no concatenation).
              sendProgress("reset");

              const { stream: fixStream } = await createStreamWithFallback({
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userPrompt },
                  { role: "assistant", content: accumulated },
                  {
                    role: "user",
                    content: `Your previous output has these issues:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nFix and re-output the COMPLETE corrected HTML file. Output ONLY raw HTML starting with <!DOCTYPE html>.`,
                  },
                ],
                temperature: 0.3,
                max_tokens: 16000,
                ...({ thinking: { type: "disabled" } } as Record<string, unknown>),
              }, (reason) => {
                console.log(`[Chat] fallback to OpenAI for fix: ${reason}`);
                sendProgress("progress fallback");
              });

              let fixed = "";
              let fixPrompt = 0;
              let fixCompletion = 0;
              let fixCached = 0;
              for await (const chunk of fixStream) {
                // Don't break on `closed` — same reasoning as the main loop:
                // we want the fixed HTML to land in DB for resume.
                const content = chunk.choices[0]?.delta?.content || "";
                if (content) {
                  fixed += content;
                  sendChunk(content);
                }
                if (chunk.usage) {
                  fixPrompt = chunk.usage.prompt_tokens || 0;
                  fixCompletion = chunk.usage.completion_tokens || 0;
                  fixCached = chunk.usage.prompt_tokens_details?.cached_tokens || 0;
                }
              }
              const fixBilled = weightedTokens(fixPrompt, fixCompletion, fixCached);
              if (fixBilled > 0) recordUsage(session.email, fixPrompt, fixCompletion, fixCached);
              billedTokens += fixBilled;
              if (fixed.trim()) {
                accumulated = fixed;
                try { setHtml(jobId, fixed); } catch { /* persist failure not fatal */ }
              }
            }
          }

          // (Used to early-return when `closed` — removed so finishJob still
          // captures the final HTML for resuming clients.)

          // Output-side safety scan. If the final HTML looks malicious, replace
          // with a blocked page (and tell client to reset preview first).
          // Substitute {{APP_ID}} BEFORE all downstream consumers (safety scan,
          // telemetry, stream to client) so it's invisible past this point.
          const final = substitutePlaceholders(cleanHtml(accumulated), { appId: projId });

          // Template telemetry: log every generation + flag if any {{X}}
          // placeholder slipped through (catches model failures so we can
          // tighten the template / prompt next iteration).
          const placeholderLeak = usingTemplate && /\{\{[A-Z_]+\}\}/.test(final);
          logTemplateUsage(session.email, projId, mode, "generate", placeholderLeak);
          if (placeholderLeak) {
            console.warn(`[Chat] placeholder leak in mode=${mode} project=${projId}`);
          }

          const contentViolation = scanGeneratedHtml(final);
          if (contentViolation) {
            const blockedHtml = `<html><body><h1>Content Blocked</h1><p>${contentViolation.reason}</p></body></html>`;
            sendProgress("reset");
            sendChunk(blockedHtml);
            sendProgress("progress done");
            safeClose();
            try { finishJob(jobId, blockedHtml, contentViolation.reason); } catch { /* persist failure not fatal */ }
            return;
          }

          // Generate a friendly 2–3 sentence summary so the chat bubble isn't
          // just a single "Đã hoàn thành". Cheap call (~200 tokens), runs in
          // parallel with the user reading the preview. Skipped if the gen
          // call already exhausted the per-request budget.
          if (overBudget) {
            sendProgress(`summary ${encodeURIComponent("Đã tạo xong app. (Bỏ qua tóm tắt vì đã đạt ngân sách tokens cho lần tạo này.)")}`);
          } else try {
            sendProgress("progress summarizing");
            const summaryResp = await withFallback(async (provider) => {
              return await provider.client.chat.completions.create({
                model: provider.model,
                messages: [
                  {
                    role: "system",
                    content:
                      "Bạn vừa sinh ra một web app HTML. Viết tóm tắt 2–3 câu tiếng Việt tự nhiên cho người dùng không biết code, theo cấu trúc: (1) đã tạo app gì, (2) tính năng chính, (3) gợi ý cách thử. Không markdown, không tên file/class/function, không 'Tóm tắt:', không 'Done'.",
                  },
                  {
                    role: "user",
                    content: `Yêu cầu gốc của user: ${newMessage}\n\nHTML đã sinh (rút gọn cho ngắn):\n${final.slice(0, 4000)}`,
                  },
                ],
                temperature: 0.5,
                // Tight budget with thinking opt-out — summary is short
                // friendly Vietnamese text, no reasoning needed.
                max_tokens: 250,
                ...({ thinking: { type: "disabled" } } as Record<string, unknown>),
              });
            }, (reason) => console.log(`[Chat] fallback to OpenAI for summary: ${reason}`));
            const summaryText = (summaryResp.choices[0]?.message?.content || "").trim();
            if (summaryResp.usage) recordUsage(
              session.email,
              summaryResp.usage.prompt_tokens || 0,
              summaryResp.usage.completion_tokens || 0,
              summaryResp.usage.prompt_tokens_details?.cached_tokens || 0,
            );
            if (summaryText) {
              sendProgress(`summary ${encodeURIComponent(summaryText.slice(0, 600))}`);
            }
            // Final persist — captures both the final HTML and the summary so
            // resuming clients get everything they'd have seen if they stayed
            // on the page.
            try { finishJob(jobId, final, summaryText || undefined); } catch { /* persist failure not fatal */ }
          } catch (err) {
            console.error("[Chat] summary error:", err instanceof Error ? err.message : err);
            // Non-fatal — user still sees the app, just without the summary.
            try { finishJob(jobId, final); } catch { /* persist failure not fatal */ }
          }

          // Belt-and-braces: if the over-budget branch above skipped the summary
          // try-block entirely, we still need to finalise the job row.
          // finishJob is idempotent for the same final HTML (an UPDATE), so
          // calling it twice doesn't double-write.
          if (overBudget) {
            try { finishJob(jobId, final); } catch { /* persist failure not fatal */ }
          }

          sendProgress("progress done");
          safeClose();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[Chat] Stream error:", msg);
          const userMsg = /timed?\s*out|ETIMEDOUT|ECONNRESET/i.test(msg)
            ? "AI phản hồi quá chậm. Thử lại sau ít phút."
            : "Lỗi sinh app. Thử lại nhé.";
          sendProgress(`error ${encodeURIComponent(userMsg)}`);
          safeClose();
          try { finishJobError(jobId, userMsg); } catch { /* persist failure not fatal */ }
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Chat error:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
