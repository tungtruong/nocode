import { NextRequest, NextResponse } from "next/server";
import { detectPromptViolation, scanGeneratedHtml, checkRateLimit } from "@/lib/security";
import { requireSession, authError, type Session } from "@/lib/auth";
import { getPrimary, getFallback, createStreamWithFallback, withFallback } from "@/lib/ai";
import { assertQuota, recordUsage, perRequestLimit, weightedTokens } from "@/lib/quota";

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
- Responsive (single column on mobile). Semantic HTML5 (button, nav, main, section).
- Keep app state in memory (JavaScript variables). Do NOT use localStorage/sessionStorage — they are unavailable in the preview sandbox. If you want persistence, mention it in a UI hint instead.
- Escape user input before injecting into innerHTML.

## DO NOT
- Do not include analytics, tracking, external CDN scripts unless explicitly requested.
- Do not add features (auth, settings, theme toggle, export) unless the user asks.
- Do not output Lorem Ipsum — use realistic Vietnamese sample data when content is needed.

START NOW with <!DOCTYPE html>`;

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

    const { newMessage } = await req.json();

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

          const { stream: genStream } = await createStreamWithFallback({
            messages: [
              { role: "system", content: NEW_APP_PROMPT },
              { role: "user", content: newMessage },
            ],
            temperature: 0.7,
            max_tokens: 16000,
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
          const final = cleanHtml(accumulated);
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
