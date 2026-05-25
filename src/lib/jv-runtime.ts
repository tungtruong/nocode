// JustVibe client-side runtime script.
// Injected (server-side) into every generated app — both the builder
// preview iframe and deployed pages under /apps/<id>.
//
// Exposes `window.jv` so AI-generated HTML can read data from the shared
// Supabase backend WITHOUT bundling fetch/auth boilerplate every time:
//
//   const products = await jv.db.list('products');                // newest 100
//   const featured = await jv.db.list('products', {
//     where: { featured: true }, limit: 12, orderAsc: true,
//   });
//   const item     = await jv.db.find('products', { slug: 'cafe-sua' });
//   const total    = await jv.db.count('products');
//
// Writes (form submissions) still go through the public `/f/<APP_ID>/submit`
// form-post endpoint — those are owner-private by design.
//
// PII guard: the public-list endpoint refuses to serve `table_name === 'submissions'`.
// Owners read submissions via the authenticated dashboard route instead.

export const JV_RUNTIME_VERSION = "1";

// The runtime is intentionally ES5-ish + no build step — it has to run
// inside the sandboxed iframe verbatim with no transpiler in the way.
const RUNTIME_BODY = `(function(){
  if (window.jv) return;
  var APP_ID = window.__JV_APP_ID__ || "";
  var API = window.__JV_API_BASE__ || "https://justvibe.me";
  function rpc(table, body){
    return fetch(API + "/api/db/" + encodeURIComponent(APP_ID) + "/" + encodeURIComponent(table) + "/list", {
      method: "POST",
      headers: {"content-type":"application/json"},
      body: JSON.stringify(body || {})
    }).then(function(r){
      if (!r.ok) return r.json().catch(function(){return {error:"HTTP "+r.status};}).then(function(e){throw new Error(e.error || ("HTTP "+r.status));});
      return r.json();
    }).then(function(r){
      return (r.rows||[]).map(function(row){
        var d = row.row_data || {};
        d._id = row.id;
        d._createdAt = row.created_at;
        return d;
      });
    });
  }
  window.jv = {
    appId: APP_ID,
    db: {
      list: function(table, opts){ return rpc(table, opts || {}); },
      find: function(table, where){ return rpc(table, {where: where, limit: 1}).then(function(a){ return a[0] || null; }); },
      count: function(table, where){ return rpc(table, {where: where, limit: 1000}).then(function(a){ return a.length; }); }
    }
  };
})();`;

/**
 * Returns the full `<script>` block to inject. Caller supplies appId so the
 * helper boots with the correct identity even when run via subdomain or under
 * /apps/<id>.
 */
export function jvRuntimeScriptTag(appId: string): string {
  // appId is alphanumeric+_- (validated by ID_RE upstream), but escape for safety.
  const safeId = appId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `<script>window.__JV_APP_ID__=${JSON.stringify(safeId)};</script><script>${RUNTIME_BODY}</script>`;
}

/**
 * Inject the JV runtime + appId bootstrap into HTML, ideally right after
 * `<head>` so it loads before any user script that calls `jv.db.*`.
 */
export function injectJvRuntime(html: string, appId: string | null | undefined): string {
  if (!appId) return html;
  const tag = jvRuntimeScriptTag(appId);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  // Fallback when the generated HTML omits <head> (shouldn't happen post-verify).
  return tag + html;
}
