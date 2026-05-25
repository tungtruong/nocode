// HTML placeholder substitution applied AFTER the LLM finishes generating /
// editing the page, BEFORE it's stored on disk or streamed to the client.
//
// The single placeholder we honor is `{{APP_ID}}` — used by form templates
// (e.g. `<form action="/f/{{APP_ID}}/submit">`) so the LLM doesn't have to
// learn the actual app id. Keeps prompts simpler + LLM output cacheable
// (the placeholder doesn't churn per project).
//
// Add more placeholders here if needed (e.g. {{OWNER_EMAIL}}, {{API_BASE}}).

export function substitutePlaceholders(html: string, vars: { appId?: string | null }): string {
  let out = html;
  if (vars.appId) {
    out = out.replaceAll("{{APP_ID}}", vars.appId);
  }
  return out;
}
