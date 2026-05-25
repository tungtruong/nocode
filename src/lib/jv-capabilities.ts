// Single source of truth for the `jv.*` runtime capabilities exposed inside
// generated apps. Each capability ships a `docs` string + one-line `summary`.
//
// Two consumers:
//   1. /api/chat   — lazy-injects only the relevant `docs` into the system
//                    prompt based on the capability classifier output.
//   2. /api/edit   — exposes `get_capability_docs(name)` as an agent tool so
//                    the multi-turn agent can pull docs on demand instead of
//                    hauling them in the base prompt every turn.
//
// Adding a new capability (e.g. `file_upload`, `email_send`, `payment`):
//   1. Implement the server-side endpoint + runtime helper.
//   2. Add an entry below with a short summary + docs string.
//   3. Add the name to CAPABILITY_NAMES.
//   4. Update the classifier's prompt + schema in capability-classifier.ts.

export type CapabilityName = "forms" | "db" | "auth";

export const CAPABILITY_NAMES: readonly CapabilityName[] = ["forms", "db", "auth"] as const;

export interface Capability {
  name: CapabilityName;
  // One-sentence summary always present in the base system prompt so the
  // model knows the capability exists even when its full docs aren't loaded.
  summary: string;
  // Full how-to. Loaded on demand for /api/edit (tool call) or pre-injected
  // for /api/chat (single-shot generate).
  docs: string;
}

const FORMS: Capability = {
  name: "forms",
  summary: "`forms` — public form submissions (signup, RSVP, contact, order). HTML <form action='/f/{{APP_ID}}/submit'> → stored as `submissions` for owner.",
  docs: `## FORMS — collect submissions
For any form that COLLECTS user input (signup, RSVP, contact, order, lead capture):
    <form action="/f/{{APP_ID}}/submit" method="POST">
      <input name="email" required>
      <input name="phone">
      ...
    </form>

Rules:
- Each input MUST have a \`name\` attribute → used as the field key in storage.
- Keep \`{{APP_ID}}\` literal in your output. Server substitutes it.
- Server returns a friendly thank-you HTML page after submit — do NOT add an
  \`onsubmit\` handler with \`alert()\` or \`preventDefault()\`.
- For "open in new tab", add \`target="_blank"\` to the form.
- DO NOT add any badge / footer text mentioning the storage backend
  (no "Powered by ...", "Saved to Database", "Connected to ..."). Persistence
  is invisible infrastructure to the end-user.
- If the EXISTING HTML contains such a badge ("Kết nối Google Sheet", "Powered
  by Sheets", etc), REMOVE it.
- Owner reads submissions at /dashboard/forms/<appId>.`,
};

const DB: Capability = {
  name: "db",
  summary: "`db` — read/write shared data via window.jv.db (catalog, menu, listings, products). Owner manages rows via /dashboard/data/<appId>.",
  docs: `## DATA — \`window.jv.db\`
Use for dynamic content the OWNER edits (catalog / menu / listings / events /
team / products). For static one-off content (CV / wedding invite / landing),
DO NOT introduce jv.db — hardcode the content.

Read (no auth — public):
  await jv.db.list('products')                              // newest 100, plain objects
  await jv.db.list('products', { limit: 12, orderAsc: true })
  await jv.db.list('products', { where: { featured: true } })
  await jv.db.find('products', { slug: 'cafe-sua' })        // single or null
  await jv.db.count('orders')

Each row is a plain object with owner-defined keys plus:
  _id          — row UUID (use for jv.db.update / jv.db.remove)
  _createdAt   — ISO timestamp

Table-naming convention:
- Lowercase plural: \`products\`, \`menu_items\`, \`listings\`, \`events\`, \`team\`.
- Stay consistent within an app — do NOT mix \`product\` and \`products\`.
- NEVER read from \`submissions\` or \`_jv_users\` — both are private.

Empty-state requirement:
  document.addEventListener('DOMContentLoaded', async () => {
    const items = await jv.db.list('products', { limit: 24 });
    const grid = document.getElementById('grid');
    grid.innerHTML = items.length
      ? items.map(p => \`<article>\${p.name} · \${p.price}</article>\`).join('')
      : '<p class="empty">Chưa có dữ liệu — chủ shop vào Dashboard để thêm sản phẩm.</p>';
  });

Authenticated write methods (require \`jv.auth\` capability — read its docs):
  await jv.db.add(table, row)              // server tags user_id automatically
  await jv.db.update(table, rowId, fields) // own row only — server enforces
  await jv.db.remove(table, rowId)         // own row only`,
};

const AUTH: Capability = {
  name: "auth",
  summary: "`auth` — per-app end-user login via Google OAuth. window.jv.auth + per-user reads via where:{user_id:'@me'}.",
  docs: `## AUTH — \`window.jv.auth\` (end-user login)
Use ONLY when the app needs per-user data: journal / notes / personal todo /
bookmarks / "my orders" / membership content. Marketing landing or public
catalog: NO auth — don't ask the user to sign in for nothing.

API:
  await jv.auth.user()              // → { uid, email, name, picture } or null
  jv.auth.signIn(/* returnUrl? */)  // top-nav redirect to Google + back
  await jv.auth.signOut()           // clear cookie, then reload page

Authenticated writes (server tags user_id from session — can't be spoofed):
  await jv.db.add('notes', { title, body })
  await jv.db.update('notes', noteId, { body: '...new...' })  // own row only
  await jv.db.remove('notes', noteId)                         // own row only

Per-user read (server substitutes the current uid):
  const mine = await jv.db.list('notes', { where: { user_id: '@me' } })

UI pattern (always check session before fetching user data):
  document.addEventListener('DOMContentLoaded', async () => {
    const me = await jv.auth.user();
    if (!me) {
      document.body.innerHTML = '<button onclick="jv.auth.signIn()">Đăng nhập với Google</button>';
      return;
    }
    document.getElementById('avatar').src = me.picture;
    document.getElementById('name').textContent = me.name;
    const notes = await jv.db.list('notes', { where: { user_id: '@me' } });
    render(notes);
  });

Sign-out button:
  <button onclick="jv.auth.signOut().then(()=>location.reload())">Đăng xuất</button>

NEVER write your own OAuth button, Google SDK loader, or login form — the
runtime handles all of it.`,
};

const REGISTRY: Record<CapabilityName, Capability> = {
  forms: FORMS,
  db: DB,
  auth: AUTH,
};

export function getCapability(name: CapabilityName): Capability {
  return REGISTRY[name];
}

export function getCapabilityDocs(name: CapabilityName): string {
  return REGISTRY[name].docs;
}

/** All summaries joined — used in the base prompt so the model is aware of
 *  which capabilities exist (and can decide to fetch full docs via the tool). */
export function allSummaries(): string {
  return CAPABILITY_NAMES.map((n) => `- ${REGISTRY[n].summary}`).join("\n");
}

/** Concatenate full docs for the named capabilities — used by /api/chat
 *  after the classifier picks. */
export function joinDocs(names: readonly CapabilityName[]): string {
  return names.map((n) => REGISTRY[n].docs).join("\n\n");
}

export function isValidCapabilityName(s: string): s is CapabilityName {
  return (CAPABILITY_NAMES as readonly string[]).includes(s);
}
