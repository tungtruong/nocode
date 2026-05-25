import { NextRequest, NextResponse } from "next/server";
import { detectPromptViolation, scanGeneratedHtml, checkRateLimit } from "@/lib/security";
import { requireSession, authError, type Session } from "@/lib/auth";
import { getPrimary, getFallback, createStreamWithFallback, withFallback } from "@/lib/ai";
import { assertQuota, recordUsage, perRequestLimit, weightedTokens } from "@/lib/quota";
import { APP_MODES, modeOf, type ModeId } from "@/lib/modes";
import { logTemplateUsage } from "@/lib/store";
import { substitutePlaceholders } from "@/lib/html-substitute";

const NEW_APP_PROMPT = `## ROLE
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

## FORMS — IMPORTANT
- For any form that COLLECTS data (signup, contact, RSVP, order, lead capture), use:
    <form action="/f/{{APP_ID}}/submit" method="POST">
      <input name="email" ...>
      ...
    </form>
- Submissions are stored automatically — owner reads them in the dashboard.
- Each input MUST have a \`name\` attribute — used as the field key in storage.
- Keep \`{{APP_ID}}\` literal in your output. Server substitutes it.
- After submit, server returns a friendly HTML thank-you page automatically —
  do NOT add an \`onsubmit\` handler with \`alert()\` or \`preventDefault()\`.
- For "open in new tab", add \`target="_blank"\` to the form.
- DO NOT add any badge / footer text mentioning the storage backend
  (no "Powered by Google Sheets", "Saved to Database", "Connected to ..."
  etc). The persistence is invisible infrastructure to the end-user.

## DO NOT
- Do not include analytics, tracking, external CDN scripts unless explicitly requested.
- Do not add features (auth, settings, theme toggle, export) unless the user asks.
- Do not output Lorem Ipsum — use realistic Vietnamese sample data when content is needed.

START NOW with <!DOCTYPE html>`;

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

        // Detect client abort to stop streaming DeepSeek output.
        req.signal.addEventListener("abort", () => { closed = true; });

        try {
          sendProgress("progress thinking");
          sendProgress("progress generating");

          // Mode dispatch:
          //   - web_app (no template): generic prompt, larger token budget.
          //   - niche modes (qr_menu/wedding/...): TEMPLATE_FILL_PROMPT + the
          //     template skeleton in the user message; tighter token budget
          //     since the model only fills placeholders, not the whole doc.
          const usingTemplate = !!modeDef.template;
          const systemPrompt = usingTemplate
            ? `${TEMPLATE_FILL_PROMPT}\n\n${modeDef.systemHints}`
            : NEW_APP_PROMPT;
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
          }, (reason) => {
            console.log(`[Chat] fallback to OpenAI for gen: ${reason}`);
            sendProgress("progress fallback");
          });

          let accumulated = "";
          let promptTokens = 0;
          let completionTokens = 0;
          let cachedTokens = 0;
          for await (const chunk of genStream) {
            if (closed) break;
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              accumulated += content;
              sendChunk(content);
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
          let billedTokens = weightedTokens(promptTokens, completionTokens, cachedTokens);
          if (billedTokens > 0) recordUsage(session.email, promptTokens, completionTokens, cachedTokens);
          // If the gen call alone blew through the per-request budget, skip
          // fix + summary (both cost more tokens) and ship what we have.
          const tokenBudget = perRequestLimit(session.email);
          const overBudget = billedTokens >= tokenBudget;

          if (closed) return;

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
                  { role: "system", content: NEW_APP_PROMPT },
                  { role: "user", content: newMessage },
                  { role: "assistant", content: accumulated },
                  {
                    role: "user",
                    content: `Your previous output has these issues:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nFix and re-output the COMPLETE corrected HTML file. Output ONLY raw HTML starting with <!DOCTYPE html>.`,
                  },
                ],
                temperature: 0.3,
                max_tokens: 16000,
              }, (reason) => {
                console.log(`[Chat] fallback to OpenAI for fix: ${reason}`);
                sendProgress("progress fallback");
              });

              let fixed = "";
              let fixPrompt = 0;
              let fixCompletion = 0;
              let fixCached = 0;
              for await (const chunk of fixStream) {
                if (closed) break;
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
              if (fixed.trim()) accumulated = fixed;
            }
          }

          if (closed) return;

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
            sendProgress("reset");
            sendChunk(
              `<html><body><h1>Content Blocked</h1><p>${contentViolation.reason}</p></body></html>`
            );
            sendProgress("progress done");
            safeClose();
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
                // Generous budget — reasoning models (e.g. deepseek-v4-pro) burn
                // tokens on hidden chain-of-thought before they emit visible text;
                // a tight cap (250) leaves zero room for the actual reply.
                max_tokens: 1200,
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
          } catch (err) {
            console.error("[Chat] summary error:", err instanceof Error ? err.message : err);
            // Non-fatal — user still sees the app, just without the summary.
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
