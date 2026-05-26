import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming, ChatCompletion, ChatCompletionChunk } from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";

// We have two providers: DeepSeek (primary, cheap) and OpenAI (fallback,
// reliable). DeepSeek goes through the OpenAI SDK with a custom baseURL.
// When DeepSeek times out or errors, we transparently retry on OpenAI.
//
// Models:
//   DEEPSEEK_MODEL  default deepseek-v4-pro (user standard — set in .env)
//   OPENAI_MODEL    default gpt-4o-mini (cheap, supports tool use)

export interface AiProvider {
  name: "deepseek" | "openai";
  client: OpenAI;
  model: string;
}

let _primary: AiProvider | null | undefined;
let _fallback: AiProvider | null | undefined;

export function getPrimary(): AiProvider | null {
  if (_primary !== undefined) return _primary;
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    _primary = null;
    return null;
  }
  _primary = {
    name: "deepseek",
    client: new OpenAI({
      apiKey: key,
      baseURL: "https://api.deepseek.com/v1",
      timeout: 60_000,
      maxRetries: 0,
    }),
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro",
  };
  return _primary;
}

export function getFallback(): AiProvider | null {
  if (_fallback !== undefined) return _fallback;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    _fallback = null;
    return null;
  }
  _fallback = {
    name: "openai",
    client: new OpenAI({
      apiKey: key,
      timeout: 60_000,
      maxRetries: 0,
    }),
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  };
  return _fallback;
}

// True only for transient upstream failures where retrying on a different
// provider has a chance of working (timeouts, rate limits, 5xx). 4xx auth /
// validation errors get rethrown — they'd just fail on the fallback too.
function isRetriable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message || "";
  if (/timed?\s*out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up/i.test(msg)) return true;
  // OpenAI SDK throws APIError with .status
  const status = (err as { status?: number }).status;
  if (typeof status === "number" && (status === 429 || status >= 500)) return true;
  return false;
}

// Heuristic: which provider does a given model name belong to?
// Used when a per-user `modelOverride` forces a specific model — we have to
// route to the provider that actually serves that model.
function providerForModel(model: string): "deepseek" | "openai" {
  const m = model.toLowerCase();
  if (m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return "openai";
  // Default everything else (deepseek-*, plus unrecognised names) to deepseek
  // — that's the cheaper provider and the platform standard.
  return "deepseek";
}

/**
 * Resolve which provider serves `modelOverride`, returning that provider
 * with `.model` swapped. Returns null when the required provider isn't
 * configured (e.g. user picked gpt-4.1-mini but OPENAI_API_KEY is missing).
 */
function pickOverrideProvider(modelOverride: string): AiProvider | null {
  const targetName = providerForModel(modelOverride);
  const base = targetName === "openai" ? getFallback() : getPrimary();
  if (!base) return null;
  return { ...base, model: modelOverride };
}

// Run `fn` against the primary provider; if it throws a retriable error and a
// fallback exists, swap to the fallback model and try once more. Useful for
// non-streaming calls (summaries, agent tool-use turns).
//
// When `modelOverride` is set (per-user setting from /api/user/settings),
// we route directly to the provider that owns that model and skip the
// platform default. The fallback still kicks in on retriable errors.
export async function withFallback<T>(
  fn: (provider: AiProvider) => Promise<T>,
  onFallback?: (reason: string) => void,
  modelOverride?: string | null,
): Promise<T> {
  let primary: AiProvider | null;
  if (modelOverride) {
    primary = pickOverrideProvider(modelOverride);
    if (!primary) throw new Error(`Model override "${modelOverride}" requested but its provider isn't configured`);
  } else {
    primary = getPrimary();
  }
  if (!primary) throw new Error("No AI provider configured (set DEEPSEEK_API_KEY)");

  try {
    return await fn(primary);
  } catch (err) {
    // Fallback only kicks in when there's no override (override = user is
    // explicitly asking for this model — don't silently swap to another).
    if (modelOverride) throw err;
    const fallback = getFallback();
    if (!fallback || !isRetriable(err)) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    onFallback?.(reason);
    return await fn(fallback);
  }
}

// Convenience for non-streaming chat completions: try primary, fall back on
// retriable errors.
export async function createCompletionWithFallback(
  params: Omit<ChatCompletionCreateParamsNonStreaming, "model">,
  onFallback?: (reason: string) => void,
  modelOverride?: string | null,
): Promise<{ result: ChatCompletion; provider: AiProvider }> {
  return withFallback(async (provider) => {
    const result = await provider.client.chat.completions.create({
      ...params,
      model: provider.model,
    });
    return { result, provider };
  }, onFallback, modelOverride);
}

// Streaming version: we can only swap providers BEFORE any chunk is delivered
// downstream. Returns the chosen provider + the AsyncIterable. Caller is
// responsible for consuming the stream and handling mid-stream failures itself
// (we can't safely retry once bytes are en route to the client).
export async function createStreamWithFallback(
  params: Omit<ChatCompletionCreateParamsStreaming, "model" | "stream">,
  onFallback?: (reason: string) => void,
  modelOverride?: string | null,
): Promise<{ stream: Stream<ChatCompletionChunk>; provider: AiProvider }> {
  let primary: AiProvider | null;
  if (modelOverride) {
    primary = pickOverrideProvider(modelOverride);
    if (!primary) throw new Error(`Model override "${modelOverride}" requested but its provider isn't configured`);
  } else {
    primary = getPrimary();
  }
  if (!primary) throw new Error("No AI provider configured (set DEEPSEEK_API_KEY)");

  const open = (provider: AiProvider) =>
    provider.client.chat.completions.create({
      ...params,
      model: provider.model,
      stream: true,
      // Ask the provider to emit a final chunk with token usage stats so we
      // can charge the user's quota accurately (instead of guessing from
      // accumulated output length).
      stream_options: { include_usage: true },
    }) as Promise<Stream<ChatCompletionChunk>>;

  try {
    return { stream: await open(primary), provider: primary };
  } catch (err) {
    // No silent fallback when user explicitly picked a model.
    if (modelOverride) throw err;
    const fallback = getFallback();
    if (!fallback || !isRetriable(err)) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    onFallback?.(reason);
    return { stream: await open(fallback), provider: fallback };
  }
}
