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
//
// Surface:
//   jv.appId                                     // string
//   jv.db.list(table, {where, limit, orderAsc})  // [{...row, _id, _createdAt}, ...]
//   jv.db.find(table, where)                     // single row or null
//   jv.db.count(table, where?)                   // number
//   jv.db.add(table, row)                        // {id, created_at} (auth required)
//   jv.db.update(table, rowId, fields)           // {ok, updated_at} (own row only)
//   jv.db.remove(table, rowId)                   // {ok}              (own row only)
//   jv.auth.user()                               // {uid, email, name, picture} or null
//   jv.auth.signIn(returnUrl?)                   // top-nav redirect to Google
//   jv.auth.signOut()                            // clears cookie, reload optional
//   jv.files.upload(File)                        // {key, url, size_bytes, mime} (auth required)
//   jv.realtime.subscribe(table, handler, opts?) // {close} — SSE of INSERT/UPDATE/DELETE
//   jv.payment.vietqr({amount, description, ...}) // {url, qrUrl, jsonUrl, info}
//
// All write/auth calls send credentials so the per-app session cookie
// (`__jv_au_<appId>` on .justvibe.me) reaches the API origin cross-subdomain.
const RUNTIME_BODY = `(function(){
  if (window.jv) return;
  var APP_ID = window.__JV_APP_ID__ || "";
  var API = window.__JV_API_BASE__ || "https://justvibe.me";
  function jpost(path, body){
    return fetch(API + path, {
      method: "POST",
      credentials: "include",
      headers: {"content-type":"application/json"},
      body: JSON.stringify(body || {})
    }).then(function(r){
      return r.json().catch(function(){return {};}).then(function(j){
        if (!r.ok) throw new Error(j.error || ("HTTP "+r.status));
        return j;
      });
    });
  }
  function jget(path){
    return fetch(API + path, {credentials:"include"}).then(function(r){
      return r.json().catch(function(){return {};}).then(function(j){
        if (!r.ok) throw new Error(j.error || ("HTTP "+r.status));
        return j;
      });
    });
  }
  function mapRows(r){
    return (r.rows||[]).map(function(row){
      var d = row.row_data || {};
      d._id = row.id;
      d._createdAt = row.created_at;
      return d;
    });
  }
  window.jv = {
    appId: APP_ID,
    db: {
      list: function(table, opts){ return jpost("/api/db/"+encodeURIComponent(APP_ID)+"/"+encodeURIComponent(table)+"/list", opts||{}).then(mapRows); },
      find: function(table, where){ return jpost("/api/db/"+encodeURIComponent(APP_ID)+"/"+encodeURIComponent(table)+"/list", {where:where,limit:1}).then(mapRows).then(function(a){return a[0]||null;}); },
      count: function(table, where){ return jpost("/api/db/"+encodeURIComponent(APP_ID)+"/"+encodeURIComponent(table)+"/list", {where:where,limit:1000}).then(mapRows).then(function(a){return a.length;}); },
      add: function(table, row){ return jpost("/api/db/"+encodeURIComponent(APP_ID)+"/"+encodeURIComponent(table)+"/add", {row:row}); },
      update: function(table, rowId, fields){ return jpost("/api/db/"+encodeURIComponent(APP_ID)+"/"+encodeURIComponent(table)+"/own-update", {rowId:rowId,fields:fields}); },
      remove: function(table, rowId){ return jpost("/api/db/"+encodeURIComponent(APP_ID)+"/"+encodeURIComponent(table)+"/own-delete", {rowId:rowId}); }
    },
    auth: {
      user: function(){ return jget("/api/auth/app/me?app="+encodeURIComponent(APP_ID)).then(function(r){return r.user;}); },
      signIn: function(returnUrl){
        var ret = returnUrl || location.href;
        var url = API + "/api/auth/app/start?app=" + encodeURIComponent(APP_ID) + "&redirect=" + encodeURIComponent(ret);
        if (window.top) window.top.location.href = url; else location.href = url;
      },
      signOut: function(){ return jpost("/api/auth/app/signout?app="+encodeURIComponent(APP_ID), {}); }
    },
    files: {
      upload: function(file){
        if (!file) return Promise.reject(new Error("Thiếu file"));
        var fd = new FormData();
        fd.append("file", file);
        fd.append("appId", APP_ID);
        return fetch(API + "/api/files/upload", {method:"POST", credentials:"include", body: fd}).then(function(r){
          return r.json().catch(function(){return {};}).then(function(j){
            if (!r.ok) throw new Error(j.error || ("HTTP "+r.status));
            return j; // {key, url, size_bytes, mime}
          });
        });
      }
    },
    realtime: {
      subscribe: function(table, handler, opts){
        opts = opts || {};
        var url = API + "/api/db/" + encodeURIComponent(APP_ID) + "/" + encodeURIComponent(table) + "/subscribe";
        if (opts.user === "@me") url += "?user=%40me";
        var es = new EventSource(url, { withCredentials: true });
        es.addEventListener("db", function(ev){
          try { handler(JSON.parse(ev.data)); } catch (e) { /* malformed payload */ }
        });
        es.addEventListener("error", function(ev){
          var d; try { d = JSON.parse(ev.data); } catch (e) { d = null; }
          if (d && opts.onError) opts.onError(d);
        });
        return { close: function(){ es.close(); } };
      }
    },
    payment: {
      vietqr: function(opts){
        opts = opts || {};
        var p = new URLSearchParams();
        if (opts.amount) p.set("amount", String(opts.amount));
        if (opts.description) p.set("description", opts.description);
        if (opts.bank) p.set("bank", opts.bank);
        if (opts.account) p.set("account", opts.account);
        if (opts.name) p.set("name", opts.name);
        var qs = p.toString();
        var base = API + "/api/payment/" + encodeURIComponent(APP_ID) + "/vietqr";
        var imgUrl = base + (qs ? "?" + qs : "");
        return {
          url: imgUrl,
          qrUrl: imgUrl,
          jsonUrl: base + (qs ? "?" + qs + "&format=json" : "?format=json"),
          info: {
            amount: opts.amount || null,
            description: opts.description || null,
          }
        };
      }
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
