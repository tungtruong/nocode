# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> Next.js 16.2.6 + React 19 + Tailwind v4. **Read `node_modules/next/dist/docs/01-app/...` before touching framework APIs** — many things (e.g. `cookies()`, `headers()`, dynamic route `params`) are now async and differ from older docs.

## Commands

```bash
npm run dev      # next dev (default :3000; .env points NEXT_PUBLIC_BASE_URL to :3002 — see note below)
npm run build    # next build
npm run start    # next start (production)
npm run lint     # eslint (flat config in eslint.config.mjs)
```

No test runner is configured.

### Env vars (`.env`)

- `DEEPSEEK_API_KEY` — required. Both AI routes (`/api/chat`, `/api/edit`) return HTTP 500 with `{ error: "API key chưa cấu hình" }` when missing.
- `DEEPSEEK_MODEL` — optional override (default `deepseek-chat`).
- `AUTH_SECRET` — required; module throws at import if missing.
- `NEXT_PUBLIC_BASE_URL` — used to build deployed-app URLs in `/api/deploy`. Currently set to `:3002` while `next dev` defaults to `:3000` — if you change the dev port, update this too or deployed links will be wrong.

## Architecture

This is **JustVibe** (deployed at https://justvibe.me, GH repo still named `tungtruong/nocode` for legacy reasons) — an AI-powered single-file HTML web-app builder. The user describes an app in chat; an LLM streams back a complete `<!DOCTYPE html>…</html>` document, which is rendered live in an iframe and can be one-click "deployed" as a static page served from `<slug>.justvibe.me` (wildcard subdomain) or `/apps/<id>`.

### Two AI endpoints

| Route | Mode | Notes |
| --- | --- | --- |
| `src/app/api/chat/route.ts` | **Generate + verify + self-correct** | Buffers the model output server-side, validates structure (presence of `<html>/<body>`, no markdown fences, no preamble), re-prompts the model with the error list if critical issues found, then streams the validated HTML to the client. Sends `\x1E`-prefixed progress markers (`thinking`, `generating`, `verifying`, `correcting`). Used for the first turn of a project. |
| `src/app/api/edit/route.ts` | **Tool-using agent (multi-turn)** | Splits the current HTML into a virtual filesystem (`/index.html`, `/style.css`, `/script.js`), exposes `read_file/edit_file/write_file/grep` as OpenAI tools, runs up to 4 turns. The system prompt forces an explicit `read_file('/index.html')` self-check before replying — no separate auto-validator. |

DeepSeek is called via the `openai` SDK with `baseURL: https://api.deepseek.com/v1`.

### Virtual filesystem (`src/lib/vfs.ts`)

The agent edit flow never sees raw HTML directly. `parseHtmlToFiles` strips `<style>` and `<script>` blocks out into separate "files", and `mergeFilesToHtml` re-inlines them after edits. `extractRelevantFiles` uses Vietnamese+English keyword heuristics to decide whether to send the model the CSS, the JS, or both — and always sends a slim HTML "skeleton" with CSS/JS placeholders. **Anything that round-trips HTML through the agent must use these helpers**, otherwise inline styles/scripts will duplicate or vanish.

The agent's tool implementations live in `src/lib/tools.ts` and operate on a plain `Record<string, string>` map — they never touch the real filesystem.

### Persistence

There is **no database**. Two JSON files in `data/` (created on first write):

- `data/apps.json` — deployed apps (id → `{user_email, title, url, created_at}`)
- `data/projects.json` — in-progress projects (id → `{user_email, appName, msgs, html, url, updated_at}`)

`src/lib/store.ts` reads each file once into a module-level cache and writes the whole map back on every mutation. This is **not concurrent-safe** — two simultaneous writes can lose data, and the cache is per-process so it won't survive across serverless instances.

Deployed apps are written as static files to `public/apps/<id>/index.html` and served via `src/app/apps/[id]/page.tsx`, which reads the file at request time and renders it inside a sandboxed iframe (`allow-scripts allow-same-origin allow-modals allow-forms`).

### Auth

`src/lib/auth.ts` — JWT (jose) stored in an `httpOnly` cookie `justvibe_session`, 1-hour expiry. Mock credentials (only in dev / when `ALLOW_MOCK_AUTH=true`): `demo@justvibe.me` / `demo123`, `admin@justvibe.me` / `admin123`. Primary auth in prod is Google OAuth (Facebook + Zalo wired but UI-hidden by policy). `next-auth` is a dependency but **not used** — don't be misled.

Every protected API route uses the same idiom:
```ts
let session; try { session = await requireSession(); } catch { return authError(); }
```

### Middleware lives at `src/proxy.ts`, not `middleware.ts`

The file is named `proxy.ts` and uses `export default async function proxy(...)`. It guards `/builder` and redirects to `/login?redirect=...` for unauthenticated users. If Next stops picking it up after an upgrade, this is the first place to check — confirm the framework's current middleware convention in `node_modules/next/dist/docs/01-app/` before renaming.

### Security layer (`src/lib/security.ts`)

Called from `chat` and `edit` routes. Three pieces:
- `detectPromptViolation(input)` — regex-based check for prompt injection + 11 content categories (also matches Vietnamese phrases for phishing/fraud).
- `scanGeneratedHtml(html)` — output-side scan for phishing patterns, obfuscated JS (`eval(atob(`, `document.write(unescape(`), unknown external `<script src>`, and adult content.
- `checkRateLimit(key)` — 20 req/hour in-memory `Map`. Per-process; resets on restart; useless in a multi-instance deployment.

### Builder UI (`src/app/builder/page.tsx`)

A single large client component. The non-obvious bit: it uses **two iframes (`frameA`, `frameB`) with an `active: 0 | 1` toggle** to double-buffer streamed HTML, so the user sees a stable preview while the next version streams into the hidden frame. The `\x1E`-prefixed lines from `/api/edit` are out-of-band progress messages (`Đang phân tích giao diện...`, `summary <url-encoded>`, `done N tools M tokens`) that the UI parses out of the response stream before the actual HTML body.

### i18n

`src/lib/i18n.ts` holds a flat `t.vi` / `t.en` dictionary. `src/components/LangProvider.tsx` provides the React context and `<LangToggle>`. The default language is detected server-side in `src/app/layout.tsx` from a `lang` cookie, falling back to the `Accept-Language` header (defaults to `en`). UI copy is primarily Vietnamese — keep both translations in sync when adding strings.

## Conventions

- Path alias `@/*` → `./src/*` (tsconfig).
- TypeScript strict mode is on; `target: ES2017`, `moduleResolution: bundler`.
- Tailwind v4 via `@tailwindcss/postcss` (see `postcss.config.mjs`); global styles in `src/app/globals.css`.
- API routes return Vietnamese error messages (`"Vui lòng đăng nhập"`, `"Lỗi máy chủ"`, …). Keep that convention.
- The `/api/edit` and `/api/chat` routes log heavily to stdout (`[EDIT]`, `[Verify]`, `[Orchestrate]`) — those logs are intentional and useful when debugging the agent loop.
