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

export type CapabilityName = "forms" | "db" | "auth" | "files" | "realtime" | "payment";

export const CAPABILITY_NAMES: readonly CapabilityName[] = ["forms", "db", "auth", "files", "realtime", "payment"] as const;

export interface Capability {
  name: CapabilityName;
  // One-sentence summary always present in the base system prompt so the
  // model knows the capability exists even when its full docs aren't loaded.
  summary: string;
  // Full how-to. Loaded on demand for /api/edit (tool call) or pre-injected
  // for /api/chat (single-shot generate).
  docs: string;
  // Minimum subscription tier required to USE this capability in a generated
  // app. Today we don't hard-block — the orchestrator just surfaces a soft
  // "this needs Pro/Max" notice so the upgrade prompt is contextual. Hard
  // enforcement (refuse to gen with the cap) is one config flip away.
  minTier: "free" | "pro" | "team";
}

const FORMS: Capability = {
  name: "forms",
  minTier: "free",
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
  minTier: "free",
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
  minTier: "free",
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

const FILES: Capability = {
  name: "files",
  minTier: "pro",
  summary: "`files` — upload images / PDFs / audio via window.jv.files.upload. Returns a permanent public URL. Auth required (owner or end-user).",
  docs: `## FILES — \`window.jv.files\` (upload to JustVibe storage)
Use when the app needs the OWNER or an END-USER to attach a real file:
product / menu photos, CV avatar, journal attachments, voice notes, PDFs.

API (Promises):
  // file is a File or Blob (e.g. from <input type="file"> or canvas.toBlob)
  const result = await jv.files.upload(file);
  // → { key, url, size_bytes, mime }
  // Use \`url\` directly in <img src>, <a href>, <video src>, etc.
  // Persist \`url\` or \`key\` in jv.db so it survives reloads.

Requires authentication — wrap upload calls behind \`jv.auth.user()\` check, or
trigger only from the owner's dashboard view (when sandboxed). The runtime
sends the per-app session cookie automatically.

Limits:
- Images (jpeg/png/webp/gif/heic): 10MB each
- SVG: 1MB
- PDF: 20MB
- Audio (mp3/wav/m4a/ogg/webm): 20MB
- Video (mp4/webm): 50MB
- Per-owner storage quota: 50MB free / 5GB Pro / 50GB Max
- Rate limit: 20 uploads / min / IP

Typical pattern — picture upload then save the URL into a jv.db row:
  document.getElementById('upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await jv.files.upload(file);
      await jv.db.add('products', { name: 'Cafe sữa', image: url, price: 25000 });
    } catch (err) {
      alert(err.message);
    }
  });

HTML: \`<input type="file" id="upload" accept="image/*">\`.

DO NOT:
- Upload before validating file size client-side — let the user know early.
- Send the same upload twice — \`upload()\` is not idempotent (creates a new
  key each call); store the returned URL and re-use it.
- Expose owner credentials. The runtime uses the visitor's session, not the
  owner's — visitors can ONLY upload, not delete (that's dashboard-only).`,
};

const REALTIME: Capability = {
  name: "realtime",
  minTier: "team",
  summary: "`realtime` — live subscribe to jv.db changes via window.jv.realtime.subscribe (chat, live counters, live orders, multiplayer).",
  docs: `## REALTIME — \`window.jv.realtime\` (live data updates)
Use when the app needs to react INSTANTLY to data changes — chat / comments,
live order tickets, voting / poll counters, multi-user collab, live event
attendee count. Skip for static lists where polling on user action is fine.

API:
  const sub = jv.realtime.subscribe(table, (event) => {
    // event.type ∈ 'INSERT' | 'UPDATE' | 'DELETE'
    // event.row     — row_data of the affected row (or null on DELETE)
    // event.oldRow  — previous row_data on UPDATE/DELETE (null on INSERT)
    // event.id      — Supabase row UUID
  });
  // Later:
  sub.close();

Per-user scoped subscriptions (only fires for the signed-in user's own rows):
  const sub = jv.realtime.subscribe('notes', handler, { user: '@me' });
  // Requires jv.auth — call jv.auth.user() first.

Pattern — render+subscribe (initial fetch, then live updates):
  const grid = document.getElementById('grid');
  const items = new Map();
  function render(){
    grid.innerHTML = [...items.values()]
      .sort((a,b) => b._createdAt.localeCompare(a._createdAt))
      .map(r => \`<article>\${r.name}</article>\`).join('') || '<p>Chưa có</p>';
  }

  // 1) initial load
  for (const r of await jv.db.list('messages', { limit: 50 })) items.set(r._id, r);
  render();

  // 2) live tail
  const sub = jv.realtime.subscribe('messages', (e) => {
    if (e.type === 'INSERT' || e.type === 'UPDATE') items.set(e.id, { ...e.row, _id: e.id, _createdAt: new Date().toISOString() });
    if (e.type === 'DELETE') items.delete(e.id);
    render();
  });

Rules:
- Always do an initial \`jv.db.list\` before subscribing, otherwise the UI is
  empty until the first event arrives.
- Always call \`sub.close()\` on page unload to free server FDs:
    window.addEventListener('beforeunload', () => sub.close());
- ONE subscribe per (table, scope) — don't open the same subscription twice
  for the same view.
- Max 5 concurrent subscriptions per IP per app (server-enforced).
- Submissions / _jv_users tables are NOT subscribable (private).
- Heartbeats every 25s are sent as SSE comments and never reach the handler —
  no need to filter them out yourself.`,
};

const PAYMENT: Capability = {
  name: "payment",
  minTier: "pro",
  summary: "`payment` — generate VietQR for any VN bank (Vietcombank/MB/Techcombank/...) so users scan + transfer instantly. Zero fees, offline gen.",
  docs: `## PAYMENT — \`window.jv.payment\` (VietQR — VN instant bank transfer)
Use when the app needs to ACCEPT money: booking deposit, event ticket,
product order, donation, tip, wedding gift, course fee.

The owner saves their bank account ONCE in /dashboard/data/<appId> →
Thanh toán tab. After that, any app that calls jv.payment.vietqr(...)
renders a QR pointing to that bank — no per-call configuration needed.

API:
  const qr = jv.payment.vietqr({ amount: 250000, description: 'Dat ban Ba Vi' });
  // → { url, qrUrl, jsonUrl, info: { bank, accountNo, accountName, amount, description } }
  // url      → SVG image URL, drop into <img src>
  // qrUrl    → same as url (alias)
  // jsonUrl  → JSON endpoint with EMV string + display info (for inspecting)

Render pattern:
  const div = document.getElementById('checkout');
  const qr = jv.payment.vietqr({ amount: 250000, description: 'Tip cafe' });
  div.innerHTML = \`
    <div style="text-align:center">
      <img src="\${qr.url}" alt="VietQR" style="width:280px;height:280px">
      <p>Quét bằng app banking để chuyển <b>250.000đ</b></p>
      <button onclick="confirmPaid()">Tôi đã chuyển</button>
    </div>\`;

After confirmation:
- Use a form action="/f/{{APP_ID}}/submit" so the owner gets a notification of
  pending payment to reconcile against their bank statement, OR
- Use jv.db.add('orders', { amount, description, status: 'pending' }) so it
  shows in /dashboard/data.

Rules:
- VN-only (uses Napas standard — works with EVERY VN banking app).
- For per-bank-customer flow (multiple recipients), pass overrides:
    jv.payment.vietqr({ amount, description, bank: 'TCB', account: '9999', name: 'Pham Trang' })
- The owner doesn't see the QR in code — bank info loads server-side from
  their saved config. AI should NEVER hardcode the owner's bank number.
- No webhook / auto-confirm — owner reconciles manually. For automated
  confirmation, recommend casso.vn ($20/mo, third-party) but skip in MVP.
- Amount must be VND integer ≥ 1,000. Description max 25 ASCII chars
  (server strips Vietnamese diacritics automatically).`,
};

const REGISTRY: Record<CapabilityName, Capability> = {
  forms: FORMS,
  db: DB,
  auth: AUTH,
  files: FILES,
  realtime: REALTIME,
  payment: PAYMENT,
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
