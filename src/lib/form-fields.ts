// Pull form field names out of generated HTML so we can auto-create a
// Google Sheet whose columns match exactly.
//
// We only look inside <form action="/f/<id>/submit"> elements — the
// rest of the page might have decorative inputs (search bar, theme
// toggle) that aren't real submission fields.

const FORM_RE = /<form\b[^>]*action\s*=\s*["']\/f\/[^"']+\/submit["'][^>]*>([\s\S]*?)<\/form>/gi;
const NAMED_INPUT_RE = /<(?:input|textarea|select)\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/gi;

const NOISE_NAMES = new Set([
  "_csrf", "csrf", "csrf_token", "_token", "honeypot", "submit", "button",
]);

export function extractFormFields(html: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let formMatch: RegExpExecArray | null;
  while ((formMatch = FORM_RE.exec(html)) !== null) {
    const inner = formMatch[1];
    let inputMatch: RegExpExecArray | null;
    NAMED_INPUT_RE.lastIndex = 0;
    while ((inputMatch = NAMED_INPUT_RE.exec(inner)) !== null) {
      const raw = inputMatch[1].trim();
      if (!raw || NOISE_NAMES.has(raw.toLowerCase())) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      names.push(raw);
    }
  }
  // Always append a timestamp column so the owner can sort by submit time
  // even if the form itself doesn't include one.
  if (!names.includes("submitted_at")) names.push("submitted_at");
  return names;
}
