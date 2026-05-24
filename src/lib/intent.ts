// Classify the user's first chat message into one of APP_MODES so /api/chat
// can pick the right template + system hints.
//
// Two-stage:
//   1. Keyword short-circuit — count VN/EN keyword hits per mode; if a single
//      mode has ≥ 2 hits and beats every other mode, return immediately (no
//      LLM cost). Catches the clear cases like "menu cafe Highland" or
//      "thiệp cưới có countdown".
//   2. LLM fallback — small classification call (~$0.0001), short prompt,
//      temperature 0, max_tokens 8. Output is parsed back to a ModeId; any
//      garbage (hallucinated id, timeout, etc.) falls back to DEFAULT_MODE so
//      the user always gets the generic flow rather than a broken one.

import { APP_MODES, DEFAULT_MODE, isValidModeId, type ModeId } from "./modes";
import { createCompletionWithFallback } from "./ai";
import { recordUsage } from "./quota";

const CLASSIFIER_PROMPT = `Bạn là phân loại yêu cầu ứng dụng web. Đọc 1 câu mô tả app của user, trả về CHÍNH XÁC 1 trong các id sau (chữ thường, không dấu nháy, không giải thích):

- qr_menu — menu/thực đơn nhà hàng, cafe, F&B, đồ ăn, đồ uống
- wedding — thiệp cưới, mời cưới, lễ cưới, đám cưới
- landing — landing page, trang chủ marketing, ra mắt sản phẩm, thu lead
- pitch_deck — slide pitch, presentation, thuyết trình, gọi vốn
- cv_resume — CV, resume, portfolio cá nhân, xin việc
- web_app — bất kỳ ứng dụng nào KHÔNG rơi vào các nhóm trên (todo, calculator, game, tracker, tool, ...)

Quy tắc:
- Nếu mô tả thuộc nhiều nhóm, chọn nhóm CỤ THỂ hơn. Ví dụ "landing page cho thiệp cưới" → wedding.
- Nếu mơ hồ hoặc thuộc nhóm chưa hỗ trợ (extension, bot Telegram, mobile app, game...) → web_app.
- Output: 1 token duy nhất, ví dụ: qr_menu`;

function keywordScores(message: string): Map<ModeId, number> {
  const lower = message.toLowerCase();
  const scores = new Map<ModeId, number>();
  for (const mode of Object.values(APP_MODES)) {
    let hits = 0;
    for (const kw of mode.keywords) {
      if (lower.includes(kw.toLowerCase())) hits++;
    }
    if (hits > 0) scores.set(mode.id, hits);
  }
  return scores;
}

function bestByKeyword(scores: Map<ModeId, number>): ModeId | null {
  let best: ModeId | null = null;
  let bestScore = 0;
  let secondScore = 0;
  for (const [id, score] of scores) {
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = id;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }
  // Need ≥ 2 hits AND strictly beat the runner-up so we don't pick a tie at random.
  if (best && bestScore >= 2 && bestScore > secondScore) return best;
  return null;
}

function parseModeId(raw: string | null | undefined): ModeId | null {
  if (!raw) return null;
  // Model may wrap in quotes / backticks / extra words — extract bare id.
  const match = raw
    .toLowerCase()
    .replace(/[`'"]/g, "")
    .match(/\b(web_app|qr_menu|wedding|landing|pitch_deck|cv_resume)\b/);
  if (!match) return null;
  const id = match[1];
  return isValidModeId(id) ? id : null;
}

export async function classifyIntent(
  message: string,
  userEmail?: string,
): Promise<ModeId> {
  const trimmed = message.trim().slice(0, 500);
  if (!trimmed) return DEFAULT_MODE;

  // Stage 1: keyword short-circuit.
  const scores = keywordScores(trimmed);
  const keywordPick = bestByKeyword(scores);
  if (keywordPick) {
    console.log(`[INTENT] keyword pick=${keywordPick} from msg="${trimmed.slice(0, 60)}"`);
    return keywordPick;
  }

  // Stage 2: LLM classifier. Best-effort — if it fails for any reason, return
  // DEFAULT_MODE so the user's request still goes through.
  try {
    const { result } = await createCompletionWithFallback(
      {
        messages: [
          { role: "system", content: CLASSIFIER_PROMPT },
          { role: "user", content: trimmed },
        ],
        temperature: 0,
        max_tokens: 8,
      },
      (reason) => console.log(`[INTENT] fallback to OpenAI: ${reason}`),
    );

    const raw = result.choices[0]?.message?.content ?? "";
    const parsed = parseModeId(raw);

    if (result.usage && userEmail) {
      recordUsage(
        userEmail,
        result.usage.prompt_tokens || 0,
        result.usage.completion_tokens || 0,
        result.usage.prompt_tokens_details?.cached_tokens || 0,
      );
    }

    console.log(`[INTENT] llm pick=${parsed ?? "DEFAULT"} (raw="${raw.trim()}") msg="${trimmed.slice(0, 60)}"`);
    return parsed ?? DEFAULT_MODE;
  } catch (err) {
    console.error("[INTENT] classifier error, defaulting:", err instanceof Error ? err.message : err);
    return DEFAULT_MODE;
  }
}
