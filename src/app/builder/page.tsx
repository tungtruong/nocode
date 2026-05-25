"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LangToggle, useLang } from "@/components/LangProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UsageBadge } from "@/components/UsageBadge";
import { APP_MODES, DEFAULT_MODE, type ModeId } from "@/lib/modes";

function cleanHtml(raw: string): string {
  let cleaned = raw;
  cleaned = cleaned.replace(/```html?\s*\n?/gi, "").replace(/```\s*$/g, "");
  const h = Math.min(
    cleaned.indexOf("<!DOCTYPE") > -1 ? cleaned.indexOf("<!DOCTYPE") : 1e9,
    cleaned.indexOf("<html") > -1 ? cleaned.indexOf("<html") : 1e9
  );
  if (h > 0 && h < 1e9) cleaned = cleaned.slice(h);
  const end = cleaned.lastIndexOf("</html>");
  if (end > 0) cleaned = cleaned.slice(0, end + 7);
  return cleaned;
}

// Defence-in-depth alongside the iframe sandbox: the sandbox already gives the
// iframe an opaque origin (no allow-same-origin), so it can't reach the parent.
// This CSP meta tag adds a second layer that blocks the *user's* code inside
// the preview from reaching external services (CDNs, trackers, exfil endpoints).
// 'unsafe-inline' is required because generated apps inline their <style>/<script>.
// img-src includes `https:` so generated apps can pull from external image
// hosts (Unsplash, picsum.photos, Cloudinary, user-uploaded URLs, etc.).
// The iframe is still sandboxed with an opaque origin so any "tracker pixel"
// load can't read or exfil user state — only side effect is the image hit.
const PREVIEW_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'">`;

// In a sandboxed iframe (no allow-same-origin), localStorage/sessionStorage/cookie
// access throws SecurityError on every call. AI-generated apps frequently use
// these for "remember setting" features; the throw crashes the entire <script>
// block, which means EVERY event handler in that block silently fails to bind —
// the user sees the button but clicking does nothing.
// We install harmless in-memory shims BEFORE the user's code runs.
const PREVIEW_SHIM = `<script>(function(){
  try {
    var make = function(){ var s={}; return {
      getItem:function(k){ return Object.prototype.hasOwnProperty.call(s,k)?s[k]:null; },
      setItem:function(k,v){ s[k]=String(v); },
      removeItem:function(k){ delete s[k]; },
      clear:function(){ s={}; },
      key:function(i){ return Object.keys(s)[i]||null; },
      get length(){ return Object.keys(s).length; }
    }; };
    var noop = make();
    try { window.localStorage.length; } catch(e){
      Object.defineProperty(window,'localStorage',{value:noop,configurable:true});
    }
    try { window.sessionStorage.length; } catch(e){
      Object.defineProperty(window,'sessionStorage',{value:make(),configurable:true});
    }
  } catch(e){}
  // Surface runtime errors as a small banner so a broken button is visible,
  // not invisible. Errors from inside the user's <script> still log to the
  // iframe's DevTools console.
  window.addEventListener('error', function(ev){
    var msg = (ev.error && ev.error.message) || ev.message || 'Lỗi không xác định';
    var bar = document.getElementById('__justvibe_err__');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = '__justvibe_err__';
      bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;background:#dc2626;color:#fff;font:12px/1.4 -apple-system,sans-serif;padding:8px 12px;z-index:2147483647;box-shadow:0 -2px 8px rgba(0,0,0,.3);max-height:30vh;overflow:auto;';
      (document.body || document.documentElement).appendChild(bar);
    }
    bar.textContent = '⚠ Lỗi trong preview: ' + msg;
  });
})();</script>`;

// Inject a staggered fade-in animation so the user perceives "each piece
// appearing one by one" when the preview swaps to the final HTML. We only
// animate the first ~2 levels under <body> so a 50-row todo list doesn't
// produce a 3-second cascade. Capped at ~1s total wall-clock.
const PREVIEW_ANIM_STYLE = `<style data-justvibe-anim>
@keyframes __justvibe_fadein__ { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
body > *, body > * > * { animation: __justvibe_fadein__ .35s ease-out both; }
</style>`;
const PREVIEW_ANIM_SCRIPT = `<script>(function(){
  try {
    var sel = 'body > *, body > * > *';
    var els = document.querySelectorAll(sel);
    var step = els.length > 30 ? 25 : els.length > 15 ? 40 : 60;
    var max = 1000;
    for (var i = 0; i < els.length; i++) {
      els[i].style.animationDelay = Math.min(i * step, max) + 'ms';
    }
  } catch (e) {}
})();</script>`;

// Order matters: CSP meta must come first (so it applies to everything after),
// then the localStorage shim + error catcher (so they're installed before any
// user <script> that might call them), then the animation style. Animation
// script goes at the end of <body>.
function injectPreviewAnim(html: string): string {
  if (!html) return html;
  return injectIntoHead(
    injectIntoBody(html, PREVIEW_ANIM_SCRIPT),
    PREVIEW_CSP + PREVIEW_SHIM + PREVIEW_ANIM_STYLE
  );
}
function injectPreviewCspOnly(html: string): string {
  if (!html) return html;
  return injectIntoHead(html, PREVIEW_CSP + PREVIEW_SHIM);
}
function injectIntoHead(html: string, snippet: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${snippet}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${snippet}</head>`);
  return snippet + html;
}
function injectIntoBody(html: string, snippet: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}</body>`);
  return html + snippet;
}

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  html?: string;
  summary?: string;
  // When the AI asked the user to disambiguate, the answer comes back as a
  // set of clickable options. clarifyKey is the resume token for /api/edit.
  clarify?: { key: string; question: string; options: string[] };
}
interface SavedProject {
  appId: string;
  appName: string;
  msgs: Msg[];
  html: string;
  url: string;
  mode?: ModeId;
}

type Phase = "idle" | "new_app" | "thinking" | "streaming" | "done";

export default function BuilderPage() {
  const { t } = useLang();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [appId, setAppId] = useState("");
  const [appName, setAppName] = useState("");
  // Project mode (web_app, qr_menu, wedding, ...). Auto-detected from the
  // first user message via /api/intent; persists with the project. Badge in
  // the chat header lets the user override.
  const [mode, setMode] = useState<ModeId>(DEFAULT_MODE);
  const [showModeModal, setShowModeModal] = useState(false);
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagSent, setFlagSent] = useState(false);
  const [newAppName, setNewAppName] = useState("");
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [html, setHtml] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [secs, setSecs] = useState(0);
  const [progress, setProgress] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // If the previous assistant message asked a clarifying question, this is
  // the resume token to attach to the next /api/edit call.
  const [pendingClarifyKey, setPendingClarifyKey] = useState<string | null>(null);
  // Bump to refetch the usage badge after every AI round-trip.
  const [usageNonce, setUsageNonce] = useState(0);
  const [quotaExceeded, setQuotaExceeded] = useState<null | { used: number; quota: number; tier: string }>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [active, setActive] = useState<0 | 1>(0);
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");
  const activeRef = useRef(0);
  useEffect(() => { activeRef.current = active; }, [active]);
  const frameA = useRef<HTMLIFrameElement>(null);
  const frameB = useRef<HTMLIFrameElement>(null);
  const abort = useRef<AbortController | null>(null);
  const t0 = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const bot = useRef<HTMLDivElement>(null);
  const aidRef = useRef("");

  // Load saved projects from server on mount
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        if (d.projects) {
            setSavedProjects(d.projects.map((p: { id: string; data: { appName: string; msgs: Msg[]; html: string; url: string } }) => ({
            appId: p.id,
            appName: p.data.appName,
            msgs: p.data.msgs || [],
            html: p.data.html || "",
            url: p.data.url || "",
          })));
        }
      })
      .catch(() => {});
  }, []);

  // Auto-save current project to server
  useEffect(() => {
    if (!appId || !appName) return;
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: appId, appName, msgs, html, url, mode }),
    }).catch(() => {});
  }, [appId, appName, msgs, html, url, mode]);

  // Sidebar list = server-fetched projects with current project merged in (no setState in effect)
  const allProjects = useMemo<SavedProject[]>(() => {
    if (!appId || !appName) return savedProjects;
    const current: SavedProject = { appId, appName, msgs, html, url, mode };
    return [current, ...savedProjects.filter((p) => p.appId !== appId)];
  }, [savedProjects, appId, appName, msgs, html, url, mode]);

  // Open existing project
  const openProject = useCallback((p: SavedProject) => {
    setAppId(p.appId);
    setAppName(p.appName);
    setMsgs(p.msgs);
    setHtml(p.html);
    setUrl(p.url);
    setMode(p.mode ?? DEFAULT_MODE);
    setPhase("idle");
    if (p.html) setMobileTab("preview");
  }, []);

  // Create new app
  const createApp = useCallback(() => {
    const name = newAppName.trim();
    if (!name) return;
    const id = Date.now().toString(36);
    setAppId(id);
    setAppName(name);
    setMsgs([]);
    setHtml("");
    setUrl("");
    setMode(DEFAULT_MODE);
    setFlagSent(false);
    setPhase("idle");
    setNewAppName("");
    setMobileTab("chat");
  }, [newAppName]);

  useEffect(() => { bot.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, phase]);

  // The HTML last published to /apps/<id>. We compare to `html` to know if
  // the user has edited since the last deploy — if so, the "Mở app" link
  // would open a stale page, so we re-deploy first.
  const [deployedHtml, setDeployedHtml] = useState("");

  const deploy = useCallback(async (h: string): Promise<string | null> => {
    setDeploying(true);
    setError("");
    try {
      const r = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: h, title: appName || "Untitled", projectId: appId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Deploy thất bại");
      setUrl(d.url);
      setDeployedHtml(h);
      return d.url as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi deploy");
      return null;
    } finally {
      setDeploying(false);
    }
  }, [appName, appId]);

  // Click handler for the combined Deploy / Open button: if the current
  // HTML is newer than what's deployed (or nothing deployed yet), publish
  // first, then open in a new tab. If already up-to-date, just open.
  const deployOrOpen = useCallback(async () => {
    if (!html) return;
    if (url && html === deployedHtml) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    const fresh = await deploy(html);
    if (fresh) window.open(fresh, "_blank", "noopener,noreferrer");
  }, [html, url, deployedHtml, deploy]);

  const send = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text) return;
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    if (overrideText === undefined) setInput("");
    setError(""); setSecs(0); setProgress("");
    setMobileTab("preview");

    const um: Msg = { id: Date.now().toString(), role: "user", text };
    const aid = (Date.now() + 1).toString();
    aidRef.current = aid;
    // Add user msg + empty assistant placeholder atomically so the chat shows
    // a single AI bubble (whose body fills in as progress arrives) instead of a
    // gap until the first HTML chunk.
    const all = [...msgs, um, { id: aid, role: "assistant" as const, text: "", html: "" }];
    setMsgs(all);
    setPhase("thinking");
    t0.current = Date.now();
    timer.current = setInterval(() => setSecs(Math.floor((Date.now() - t0.current) / 1000)), 200);

    // Stage iframe target (the inactive one — we swap to it when streaming completes).
    // We can't write to iframe.contentDocument because the sandbox iframe lives in an
    // opaque origin (no allow-same-origin, by design). Instead we set `srcdoc`,
    // throttled to avoid thrashing the iframe on every chunk.
    const si = activeRef.current === 0 ? 1 : 0;
    const sf = si === 0 ? frameA : frameB;
    let lastPreviewAt = 0;
    const updatePreview = (htmlStr: string, force = false) => {
      const now = Date.now();
      if (!force && now - lastPreviewAt < 250) return;
      lastPreviewAt = now;
      const node = sf.current;
      // CSP applies on every render (always). Animation only on FINAL render
      // (force=true) — mid-stream srcdoc swaps would re-trigger the animation
      // every 250ms and look like a strobe.
      if (node) node.srcdoc = force ? injectPreviewAnim(htmlStr) : injectPreviewCspOnly(htmlStr);
    };

    try {
      const isFirst = !html;
      // Auto-detect mode from the user's first message before /api/chat. Falls
      // back gracefully if /api/intent errors — we just keep the default mode.
      let effectiveMode = mode;
      if (isFirst && mode === DEFAULT_MODE) {
        try {
          setProgress(t.modeDetecting);
          const r = await fetch("/api/intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text }),
            signal: c.signal,
          });
          if (r.ok) {
            const d = await r.json();
            if (d?.mode && d.mode !== DEFAULT_MODE) {
              effectiveMode = d.mode;
              setMode(d.mode);
            }
          }
        } catch { /* classifier best-effort — proceed with default */ }
      }

      const ep = isFirst ? "/api/chat" : "/api/edit";
      const bd = isFirst
        ? JSON.stringify({ messages: all.slice(0, -1), currentHtml: html, newMessage: text, projectId: appId, mode: effectiveMode })
        : JSON.stringify({
            currentHtml: html,
            newMessage: text,
            projectId: appId,
            mode: effectiveMode,
            // If this is the answer to a previous clarify question, attach the
            // resume token so the server picks up the cached agent state
            // instead of re-reading every file.
            ...(pendingClarifyKey ? { clarifyKey: pendingClarifyKey } : {}),
          });
      // Single-use: consumed by THIS request whether it succeeds or fails.
      if (pendingClarifyKey) setPendingClarifyKey(null);
      const r = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/json" }, body: bd, signal: c.signal });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        // Quota exceeded — show the dedicated modal and bail out cleanly.
        if (r.status === 402 || d?.code === "QUOTA_EXCEEDED") {
          fetch("/api/usage").then((res) => res.ok ? res.json() : null).then((u) => {
            if (u) setQuotaExceeded({ used: u.used, quota: u.quota, tier: u.tier });
            else setQuotaExceeded({ used: 0, quota: 0, tier: "free" });
          }).catch(() => setQuotaExceeded({ used: 0, quota: 0, tier: "free" }));
          setMsgs((p) => p.filter((m) => m.id !== aid));
          setPhase("idle");
          return;
        }
        throw new Error(d?.error || "Sinh thất bại");
      }

      const reader = r.body?.getReader();
      if (!reader) throw new Error("Không có nội dung trả về");
      const dec = new TextDecoder();
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        let chunk = dec.decode(value, { stream: true });
        const parts = chunk.split(/\x1E/);
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) {
            const pl = parts[i].split("\n")[0];
            if (pl.startsWith("done ")) {
              setProgress(pl.slice(5));
            } else if (pl.startsWith("summary ")) {
              try {
                const st = decodeURIComponent(pl.slice(8));
                setMsgs((p) => p.map((m) => (m.id === aid ? { ...m, summary: st } : m)));
              } catch {}
            } else if (pl.startsWith("clarify ")) {
              try {
                const data = JSON.parse(decodeURIComponent(pl.slice(8))) as { key: string; question: string; options: string[] };
                setMsgs((p) => p.map((m) => (m.id === aid ? { ...m, summary: data.question, clarify: data } : m)));
                setPendingClarifyKey(data.key);
              } catch {}
            } else if (pl === "reset") {
              // Server told us its previous output was wrong; drop everything
              // we accumulated so the next chunks replace it cleanly.
              acc = "";
              const node = sf.current;
              if (node) node.srcdoc = "";
            } else if (pl.startsWith("error ")) {
              // Server-side failure (e.g. DeepSeek timeout). Surface the message
              // and drop the placeholder assistant bubble so the chat doesn't
              // look stuck on "Đang sinh HTML...".
              try {
                const errMsg = decodeURIComponent(pl.slice(6));
                setError(errMsg);
              } catch {
                setError("Lỗi không xác định");
              }
              setMsgs((p) => p.filter((m) => m.id !== aid));
              setPhase("idle");
              // Drain the rest of the response and bail out.
              try { reader.cancel(); } catch {}
              return;
            } else if (pl.startsWith("progress ")) {
              const stepKey = pl.slice(9).trim();
              const label =
                stepKey === "thinking" ? t.buildThinking :
                stepKey === "generating" ? t.buildGenerating :
                stepKey === "verifying" ? t.buildVerifying :
                stepKey === "correcting" ? t.buildCorrecting :
                stepKey === "summarizing" ? t.buildSummarizing :
                stepKey === "fallback" ? t.buildFallback :
                stepKey === "done" ? t.buildDone : stepKey;
              setProgress(label);
            } else if (pl) {
              setProgress(pl);
            }
            parts[i] = parts[i].slice(parts[i].indexOf("\n") + 1);
          }
        }
        chunk = parts.join("");
        if (!chunk.trim()) continue;
        acc += chunk;
        const c2 = cleanHtml(acc);
        setHtml(c2);
        updatePreview(c2);
        setMsgs((p) => p.map((m) => (m.id === aid ? { ...m, text: c2, html: c2 } : m)));
        if (phase === "thinking") setPhase("streaming");
      }
      acc += dec.decode();
      const fin = cleanHtml(acc);
      updatePreview(fin, true);
      setHtml(fin);
      setActive(si as 0 | 1);
      setMsgs((p) => p.map((m) => (m.id === aid ? { ...m, text: fin, html: fin } : m)));
      setPhase("done");
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") {
        setError(e.message);
      }
      setPhase("idle");
    } finally {
      if (timer.current) clearInterval(timer.current);
      abort.current = null;
      // Re-pull usage now that the round-trip has completed (success or fail).
      setUsageNonce((n) => n + 1);
    }
  }, [input, msgs, html, phase, t, pendingClarifyKey, mode, appId]);

  // Memoize the animated version so reopening a project or toggling
  // between iframes doesn't re-inject every render.
  const animatedHtml = useMemo(() => (html ? injectPreviewAnim(html) : ""), [html]);

  // Manual reload: blank both iframes then re-set srcdoc so the user's in-memory
  // state (counters, form input, theme toggle) starts from scratch — useful
  // when testing flows or after the user code crashes mid-interaction.
  const refreshPreview = useCallback(() => {
    if (!animatedHtml) return;
    [frameA.current, frameB.current].forEach((f) => {
      if (!f) return;
      f.srcdoc = "";
      // Schedule the real srcdoc on the next frame so the browser actually
      // tears down the old document — setting the same string in one tick is
      // a no-op.
      requestAnimationFrame(() => { f.srcdoc = animatedHtml; });
    });
  }, [animatedHtml]);
  useEffect(() => {
    if (phase !== "done" && phase !== "idle") return;
    if (!animatedHtml) return;
    [frameA.current, frameB.current].forEach((f) => { if (f && f.srcdoc !== animatedHtml) f.srcdoc = animatedHtml; });
  }, [phase, animatedHtml]);

  const cancel = useCallback(() => { abort.current?.abort(); if (timer.current) clearInterval(timer.current); setPhase("idle"); }, []);
  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };
  const busy = phase === "thinking" || phase === "streaming";

  const copyText = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
  }, []);

  const regenerate = useCallback((assistantMsgId: string) => {
    if (busy) return;
    const idx = msgs.findIndex((m) => m.id === assistantMsgId);
    if (idx <= 0) return;
    const userMsg = msgs[idx - 1];
    if (userMsg.role !== "user") return;
    setMsgs((prev) => prev.slice(0, idx - 1));
    send(userMsg.text);
  }, [msgs, busy, send]);

  const startEdit = useCallback((msgId: string, currentText: string) => {
    setEditingMsgId(msgId);
    setEditingText(currentText);
  }, []);

  const confirmEdit = useCallback(() => {
    const newText = editingText.trim();
    if (!newText || !editingMsgId || busy) {
      setEditingMsgId(null);
      return;
    }
    const idx = msgs.findIndex((m) => m.id === editingMsgId);
    if (idx < 0) {
      setEditingMsgId(null);
      return;
    }
    setMsgs((prev) => prev.slice(0, idx));
    setEditingMsgId(null);
    send(newText);
  }, [editingText, editingMsgId, msgs, busy, send]);

  const cancelEdit = useCallback(() => {
    setEditingMsgId(null);
    setEditingText("");
  }, []);

  const [confirmReset, setConfirmReset] = useState(false);
  const doReset = useCallback(() => {
    abort.current?.abort();
    setAppId(""); setAppName(""); setMsgs([]); setHtml(""); setUrl(""); setPhase("idle"); setProgress("");
    setConfirmReset(false);
  }, []);
  const resetProject = useCallback(() => {
    if (busy) {
      setConfirmReset(true);
      return;
    }
    doReset();
  }, [busy, doReset]);

  // Delete project from sidebar
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const deletingProjectName = useMemo(
    () => allProjects.find((p) => p.appId === deletingProjectId)?.appName ?? "",
    [allProjects, deletingProjectId]
  );
  const confirmDeleteProject = useCallback(async () => {
    const id = deletingProjectId;
    setDeletingProjectId(null);
    if (!id) return;
    try {
      await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch { /* ignore — still drop locally */ }
    setSavedProjects((prev) => prev.filter((p) => p.appId !== id));
    // If we just deleted the project that's currently open, drop back to the
    // "new project" screen.
    if (appId === id) {
      abort.current?.abort();
      setAppId(""); setAppName(""); setMsgs([]); setHtml(""); setUrl(""); setPhase("idle"); setProgress("");
    }
  }, [deletingProjectId, appId]);

  // Load project from ?project=<id> URL param on first mount
  const projectIdFromUrl = searchParams.get("project");
  const urlLoadedRef = useRef(false);
  useEffect(() => {
    if (urlLoadedRef.current || !projectIdFromUrl || appId) return;
    const found = savedProjects.find((p) => p.appId === projectIdFromUrl);
    if (!found) return;
    urlLoadedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    openProject(found);
  }, [projectIdFromUrl, savedProjects, appId, openProject]);

  // Show "New App" or "Open Project" screen when no project loaded
  if (!appId) {
    return (
      <div className="flex h-screen flex-col bg-[#fcfcfd] overflow-hidden">
        <header className="flex items-center justify-between border-b border-[#e2e8f0] bg-white px-4 sm:px-6 py-3 shrink-0">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#a855f7] shadow-sm shadow-[#7c3aed]/20">
              <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <span className="text-base font-bold tracking-tight text-[#0f172a]">JustVibe</span>
          </Link>
          <div className="flex items-center gap-2">
            <UsageBadge refreshKey={usageNonce} />
            <LangToggle />
            <button onClick={handleLogout} className="rounded-lg px-2.5 py-1.5 text-xs text-[#64748b] hover:text-[#64748b] hover:bg-[#f1f5f9] transition-all">{t.signout}</button>
          </div>
        </header>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Sidebar: existing projects. On desktop a fixed column; on mobile a collapsible <details>. */}
          <details className="md:hidden border-b border-[#e2e8f0] bg-white" open={allProjects.length > 0 && allProjects.length <= 3}>
            <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold text-[#7c3aed] uppercase tracking-wider flex items-center justify-between">
              <span>{t.buildYourProjects} ({allProjects.length})</span>
              <span aria-hidden="true">▾</span>
            </summary>
            <div className="px-4 pb-4 space-y-2 max-h-[40vh] overflow-y-auto">
              {allProjects.length === 0 ? (
                <p className="text-xs text-[#cbd5e1]">{t.buildNoProjects}</p>
              ) : (
                allProjects.map((p) => (
                  <div key={p.appId} className="group relative rounded-xl border border-[#e2e8f0] bg-white hover:border-[#7c3aed]/30 hover:bg-[#7c3aed]/[0.02] active:bg-[#7c3aed]/5 transition-all">
                    <button type="button" onClick={() => openProject(p)} className="w-full text-left px-3 py-2.5 pr-10 block">
                      <span className="block text-sm font-medium text-[#18181b] truncate">{p.appName}</span>
                      <span className="block text-[10px] text-[#a1a1aa] mt-0.5">{p.msgs.filter((m) => m.role === "user").length} {t.buildMsgs}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeletingProjectId(p.appId); }}
                      aria-label={`${t.dashDelete} ${p.appName}`}
                      title={t.dashDelete}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-[#94a3b8] hover:bg-red-50 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 transition-colors"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </details>

          <div className="w-64 border-r border-[#e2e8f0] bg-white p-4 space-y-3 overflow-y-auto hidden md:block">
            <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider">{t.buildYourProjects}</h3>
            {allProjects.length === 0 ? (
              <p className="text-xs text-[#cbd5e1]">{t.buildNoProjects}</p>
            ) : (
              allProjects.map((p) => (
                <div key={p.appId} className="group relative rounded-xl border border-[#e2e8f0] bg-white hover:border-[#7c3aed]/30 hover:bg-[#7c3aed]/[0.02] transition-all">
                  <button type="button" onClick={() => openProject(p)} className="w-full text-left px-3 py-2.5 pr-10 block">
                    <span className="block text-sm font-medium text-[#18181b] truncate">{p.appName}</span>
                    <span className="block text-[10px] text-[#a1a1aa] mt-0.5">{p.msgs.filter((m) => m.role === "user").length} {t.buildMsgs}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDeletingProjectId(p.appId); }}
                    aria-label={`${t.dashDelete} ${p.appName}`}
                    title={t.dashDelete}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-[#94a3b8] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-50 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 transition-all"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Main: create new */}
          <div className="flex-1 flex flex-col items-center justify-center p-6">
            <div className="w-full max-w-md text-center">
              <div className="mb-6 flex h-16 w-16 mx-auto items-center justify-center rounded-2xl bg-gradient-to-br from-[#7c3aed]/10 to-[#a855f7]/5 ring-1 ring-[#7c3aed]/10">
                <svg className="h-7 w-7 text-[#7c3aed]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-[#0f172a] mb-2">{t.buildNewApp}</h2>
              <p className="text-sm text-[#64748b] mb-6">{t.buildNewAppDesc}</p>
              <input
                type="text"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createApp()}
                placeholder={t.buildNamePlaceholder}
                className="w-full rounded-xl border border-[#e2e8f0] bg-white px-4 py-3 text-sm text-[#18181b] placeholder:text-[#d4d4d8] focus:border-[#7c3aed]/40 focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/10 transition-all mb-4"
              />
              <button onClick={createApp} disabled={!newAppName.trim()}
                className="w-full rounded-xl bg-[#7c3aed] py-3 text-sm font-semibold text-white hover:bg-[#6d28d9] disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm shadow-[#7c3aed]/20">
                {t.buildCreateBtn}
              </button>
            </div>
          </div>
        </div>
        <ConfirmDialog
          open={deletingProjectId !== null}
          title={t.buildDeleteProjectTitle}
          message={t.buildDeleteProjectConfirm.replace("{name}", deletingProjectName)}
          confirmLabel={t.dashDelete}
          destructive
          onConfirm={confirmDeleteProject}
          onCancel={() => setDeletingProjectId(null)}
        />
        {quotaExceeded && (
          <ConfirmDialog
            open
            title={t.quotaExceededTitle}
            message={t.quotaExceededDesc
              .replace("{used}", quotaExceeded.used.toLocaleString())
              .replace("{quota}", quotaExceeded.quota.toLocaleString())
              .replace("{tier}", quotaExceeded.tier)}
            confirmLabel={t.quotaUpgrade}
            cancelLabel={t.dialogCancel}
            onConfirm={() => { setQuotaExceeded(null); router.push("/pricing"); }}
            onCancel={() => setQuotaExceeded(null)}
          />
        )}
      </div>
    );
  }

  // Main builder UI (with project loaded)
  return (
    <div className="flex h-screen flex-col bg-[#fcfcfd] overflow-hidden">
      <header className="flex items-center justify-between border-b border-[#e2e8f0] bg-white px-4 sm:px-6 py-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="shrink-0 flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#7c3aed] to-[#a855f7] shadow-sm shadow-[#7c3aed]/20">
              <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
          </Link>
          <button onClick={resetProject}
            className="text-xs text-[#64748b] hover:text-[#7c3aed] transition-colors ml-2" title={t.otherProjects}>
            ← {t.otherProjects}
          </button>
          <span className="text-sm font-semibold text-[#18181b] truncate">{appName}</span>
        </div>
        <div className="flex items-center gap-2">
          <UsageBadge refreshKey={usageNonce} />
          <LangToggle />
          {html && (() => {
            const stale = url && html !== deployedHtml;
            const label = deploying ? t.buildDeploying : !url ? t.deploy : stale ? t.buildUpdateOpen : `${t.openApp} →`;
            const tone = !url
              ? "border-[#e2e8f0] bg-white text-[#64748b] hover:text-[#7c3aed] hover:border-[#7c3aed]/30"
              : stale
                ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100";
            return (
              <button
                onClick={deployOrOpen}
                disabled={deploying}
                title={stale ? t.buildUpdateOpenHint : undefined}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-wait ${tone}`}
              >
                {label}
              </button>
            );
          })()}
          <button onClick={handleLogout} className="rounded-lg px-2.5 py-1.5 text-xs text-[#64748b] hover:text-[#64748b] hover:bg-[#f1f5f9] transition-all">{t.signout}</button>
        </div>
      </header>

      {/* Mobile tabs */}
      <div className="flex md:hidden border-b border-[#e2e8f0] bg-white shrink-0">
        {([
          { id: "chat" as const, label: t.buildMobileChat },
          { id: "preview" as const, label: t.buildMobilePreview },
        ]).map(({ id, label }) => {
          const isActive = mobileTab === id;
          return (
            <button key={id} onClick={() => setMobileTab(id)}
              aria-label={label}
              aria-pressed={isActive}
              className={`flex-1 py-3 text-xs font-semibold text-center transition-all relative ${
                isActive ? "text-[#7c3aed]" : "text-[#64748b] hover:text-[#334155]"
              }`}>
              {label}
              {isActive && <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full bg-[#7c3aed]" />}
              {id === "preview" && busy && <span className="absolute top-1.5 right-1/4 h-1.5 w-1.5 rounded-full bg-[#7c3aed] animate-pulse" />}
            </button>
          );
        })}
      </div>

      <div className="flex flex-1 min-h-0">
        <div className={`${mobileTab === "preview" ? "hidden" : "flex"} md:flex w-full flex-col md:w-[384px] lg:w-[440px] xl:w-[480px] bg-white border-r border-[#e2e8f0]`}>
          <div className="border-b border-[#e2e8f0] px-4 py-2 flex items-center justify-between gap-2 bg-[#fafafa]">
            <button
              type="button"
              onClick={() => setShowModeModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-[#e2e8f0] hover:border-[#7c3aed]/40 text-xs font-medium text-[#334155] transition"
              title={t.modeChangeAction}
            >
              <span>{APP_MODES[mode].emoji}</span>
              <span>{t[APP_MODES[mode].labelKey]}</span>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="opacity-50"><path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
            {html && !flagSent && (
              <button
                type="button"
                onClick={() => setShowFlagModal(true)}
                className="text-xs text-[#94a3b8] hover:text-[#ef4444] transition px-2 py-1"
                title={t.templateFlagBtn}
              >
                👎 {t.templateFlagBtn}
              </button>
            )}
            {flagSent && (
              <span className="text-xs text-emerald-600">✓ {t.templateFlagThanks}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-5">
            {msgs.map((m) => {
              const isLast = m.id === msgs[msgs.length - 1]?.id;
              const isStreaming = phase === "streaming" && isLast;
              const isEditing = editingMsgId === m.id;
              const summary = m.role === "assistant" ? (m.summary || t.buildDone) : "";
              return (
              <div key={m.id} className={`group flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  m.role === "user"
                    ? "bg-gradient-to-br from-[#7c3aed] to-[#a855f7] text-white shadow-sm shadow-[#7c3aed]/20"
                    : "bg-[#f1f5f9] text-[#7c3aed] ring-1 ring-[#e2e8f0]"
                }`}>
                  {m.role === "user" ? "B" : "AI"}
                </div>
                <div className={`flex flex-col gap-1 min-w-0 ${m.role === "user" ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[280px] sm:max-w-[320px] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "rounded-tr-md bg-gradient-to-br from-[#7c3aed] to-[#8b5cf6] text-white shadow-sm shadow-[#7c3aed]/15"
                      : "rounded-tl-md bg-[#f8fafc] text-[#334155] ring-1 ring-[#e2e8f0]"
                  }`}>
                    {m.role === "user" ? (
                      isEditing ? (
                        <textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirmEdit(); }
                            else if (e.key === "Escape") cancelEdit();
                          }}
                          rows={2}
                          autoFocus
                          className="w-full min-w-[200px] resize-none bg-transparent text-white placeholder-white/60 focus:outline-none"
                        />
                      ) : m.text
                    ) : (isLast && busy) ? (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="flex h-2 w-2 rounded-full bg-[#7c3aed] animate-pulse" />
                        <span className="text-[#64748b] font-medium truncate">
                          {progress || (phase === "thinking" ? t.buildThinking : t.buildBuilding)}
                        </span>
                        <span className="text-[10px] text-[#a1a1aa] tabular-nums ml-1">{secs}s</span>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs text-[#334155] leading-relaxed whitespace-pre-line">{summary}</p>
                        {m.clarify && !busy && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {m.clarify.options.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => send(opt)}
                                className="text-[11px] leading-snug text-left rounded-lg border border-[#7c3aed]/30 bg-white hover:bg-[#7c3aed]/[0.05] hover:border-[#7c3aed]/50 text-[#5b21b6] px-2.5 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/30"
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {!isStreaming && !isEditing && (
                    <div className={`flex items-center gap-1 opacity-60 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                      <button
                        onClick={() => copyText(m.id, m.role === "user" ? m.text : summary)}
                        aria-label={copiedId === m.id ? t.msgCopied : t.msgCopy}
                        className="text-[10px] text-[#64748b] hover:text-[#7c3aed] focus:text-[#7c3aed] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/30 px-1.5 py-0.5 rounded transition-colors"
                        title={t.msgCopy}
                      >
                        {copiedId === m.id ? t.msgCopied : t.msgCopy}
                      </button>
                      {m.role === "user" && !busy && (
                        <button
                          onClick={() => startEdit(m.id, m.text)}
                          aria-label={t.msgEdit}
                          className="text-[10px] text-[#64748b] hover:text-[#7c3aed] focus:text-[#7c3aed] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/30 px-1.5 py-0.5 rounded transition-colors"
                          title={t.msgEdit}
                        >
                          {t.msgEdit}
                        </button>
                      )}
                      {m.role === "assistant" && m.html && !busy && (
                        <button
                          onClick={() => regenerate(m.id)}
                          aria-label={t.msgRegenerate}
                          className="text-[10px] text-[#64748b] hover:text-[#7c3aed] focus:text-[#7c3aed] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/30 px-1.5 py-0.5 rounded transition-colors"
                          title={t.msgRegenerate}
                        >
                          {t.msgRegenerate}
                        </button>
                      )}
                    </div>
                  )}
                  {isEditing && (
                    <div className="flex gap-2 mt-1">
                      <button onClick={confirmEdit} className="text-[10px] font-medium text-[#7c3aed] hover:text-[#6d28d9] px-2 py-1 rounded">
                        {t.msgEdit} ↵
                      </button>
                      <button onClick={cancelEdit} className="text-[10px] text-[#64748b] hover:text-[#64748b] px-2 py-1 rounded">
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>
              );
            })}

            <div ref={bot} />
          </div>

          <div className="px-3 sm:px-4 pb-3 sm:pb-4 bg-white shrink-0">
            {error && (
              <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
            )}
            <div className="flex items-center gap-2 bg-[#f8fafc] rounded-2xl border border-[#e2e8f0] focus-within:border-[#7c3aed]/40 focus-within:ring-2 focus-within:ring-[#7c3aed]/10 focus-within:bg-white transition-all px-3 sm:px-4 py-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={html ? t.buildPlaceholderEdit : t.buildPlaceholderFirst}
                rows={2}
                disabled={busy}
                className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-[#0f172a] placeholder:text-[#cbd5e1] focus:outline-none disabled:opacity-40 py-0.5"
              />
              {busy ? (
                <button onClick={cancel} aria-label={t.msgStop} title={t.msgStop} className="shrink-0 flex items-center justify-center rounded-xl border border-[#e2e8f0] bg-white w-9 h-9 text-[#64748b] hover:text-[#334155] hover:bg-[#f1f5f9] transition-all">
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" /></svg>
                </button>
              ) : (
                <button onClick={() => send()} disabled={!input.trim()} aria-label={t.msgSend} title={t.msgSend}
                  className="shrink-0 flex items-center justify-center rounded-xl bg-[#7c3aed] w-9 h-9 text-white hover:bg-[#6d28d9] disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm shadow-[#7c3aed]/20">
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 8h12M10 4l4 4-4 4" /></svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className={`${mobileTab === "chat" ? "hidden" : "flex"} md:flex flex-1 flex-col bg-[#fcfcfd]`}>
          <div className="hidden md:flex items-center justify-between border-b border-[#e2e8f0] bg-white px-5 py-3">
            <div className="flex items-center gap-2.5">
              <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${busy ? "bg-[#7c3aed] animate-pulse" : html ? "bg-emerald-400" : "bg-[#e2e8f0]"}`} />
              <span className="text-xs font-semibold text-[#64748b] uppercase tracking-wider">{t.buildPreview}</span>
            </div>
            {html && !busy && (
              <button
                onClick={refreshPreview}
                aria-label={t.buildRefreshPreview}
                title={t.buildRefreshPreview}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#7c3aed] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/30 transition-colors"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
                  <path d="M13.5 2v3h-3" />
                </svg>
              </button>
            )}
          </div>
          <div className="relative flex-1 bg-white">
            <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-8">
              <div className="h-full w-full sm:max-w-[420px] sm:h-auto sm:aspect-[9/16] sm:max-h-[85vh] rounded-3xl sm:shadow-2xl sm:shadow-black/[0.06] sm:ring-1 sm:ring-black/[0.04] overflow-hidden">
                <iframe ref={frameA} title="A" className="absolute inset-0 w-full h-full border-0 transition-opacity duration-100"
                  style={{ opacity: active === 0 ? 1 : 0, pointerEvents: active === 0 ? "auto" : "none", zIndex: active === 0 ? 2 : 1 }}
                  sandbox="allow-scripts allow-modals allow-forms" referrerPolicy="no-referrer" />
                <iframe ref={frameB} title="B" className="absolute inset-0 w-full h-full border-0 transition-opacity duration-100"
                  style={{ opacity: active === 1 ? 1 : 0, pointerEvents: active === 1 ? "auto" : "none", zIndex: active === 1 ? 2 : 1 }}
                  sandbox="allow-scripts allow-modals allow-forms" referrerPolicy="no-referrer" />
              </div>
            </div>
            {!html && !busy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-[#cbd5e1] z-0">
                <p className="text-base font-semibold text-[#64748b]">{t.buildPreviewEmpty}</p>
                <p className="text-sm text-[#cbd5e1] mt-1">{t.buildPreviewHint}</p>
              </div>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmReset}
        title={t.buildAbortConfirm}
        message={t.buildAbortConfirm}
        confirmLabel={t.otherProjects}
        cancelLabel={t.dialogCancel}
        destructive
        onConfirm={doReset}
        onCancel={() => setConfirmReset(false)}
      />
      <ConfirmDialog
        open={deletingProjectId !== null}
        title={t.buildDeleteProjectTitle}
        message={t.buildDeleteProjectConfirm.replace("{name}", deletingProjectName)}
        confirmLabel={t.dashDelete}
        destructive
        onConfirm={confirmDeleteProject}
        onCancel={() => setDeletingProjectId(null)}
      />
      {quotaExceeded && (
        <ConfirmDialog
          open
          title={t.quotaExceededTitle}
          message={t.quotaExceededDesc
            .replace("{used}", quotaExceeded.used.toLocaleString())
            .replace("{quota}", quotaExceeded.quota.toLocaleString())
            .replace("{tier}", quotaExceeded.tier)}
          confirmLabel={t.quotaUpgrade}
          cancelLabel={t.dialogCancel}
          onConfirm={() => { setQuotaExceeded(null); router.push("/pricing"); }}
          onCancel={() => setQuotaExceeded(null)}
        />
      )}

      {showModeModal && (
        <ModePickerModal
          current={mode}
          hasContent={!!html}
          onPick={(id) => {
            // Warn before switching mid-project: switching only affects future
            // edits — the existing HTML is not regenerated. Confirm so the user
            // doesn't think it'll magically remake the app.
            if (html && id !== mode && !window.confirm(t.modeChangeConfirm)) return;
            setMode(id);
            setShowModeModal(false);
          }}
          onClose={() => setShowModeModal(false)}
          t={t}
        />
      )}

      {showFlagModal && (
        <FlagTemplateModal
          mode={mode}
          projectId={appId || null}
          onSent={() => {
            setShowFlagModal(false);
            setFlagSent(true);
          }}
          onClose={() => setShowFlagModal(false)}
          t={t}
        />
      )}
    </div>
  );
}

function ModePickerModal(props: {
  current: ModeId;
  hasContent: boolean;
  onPick: (id: ModeId) => void;
  onClose: () => void;
  t: ReturnType<typeof useLang>["t"];
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={props.onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-[#e2e8f0] flex items-center justify-between">
          <h2 className="font-semibold text-[#0f172a]">{props.t.modeModalTitle}</h2>
          <button onClick={props.onClose} className="text-[#64748b] hover:text-[#0f172a] text-xl leading-none" aria-label="Close">×</button>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.values(APP_MODES).map((m) => {
            const isCur = m.id === props.current;
            return (
              <button
                key={m.id}
                onClick={() => props.onPick(m.id)}
                className={`text-left p-4 rounded-xl border transition ${
                  isCur
                    ? "border-[#7c3aed] bg-[#7c3aed]/5"
                    : "border-[#e2e8f0] hover:border-[#7c3aed]/40 hover:bg-[#7c3aed]/[0.02]"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">{m.emoji}</span>
                  <span className="font-medium text-[#0f172a]">{props.t[m.labelKey]}</span>
                  {isCur && <span className="ml-auto text-[10px] uppercase tracking-wide text-[#7c3aed] font-semibold">Đang chọn</span>}
                </div>
                <p className="text-xs text-[#64748b]">{props.t[m.descKey]}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FlagTemplateModal(props: {
  mode: ModeId;
  projectId: string | null;
  onSent: () => void;
  onClose: () => void;
  t: ReturnType<typeof useLang>["t"];
}) {
  const [reason, setReason] = useState<"missing" | "wrong_industry" | "ugly" | "other">("missing");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await fetch("/api/feedback/template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: props.mode, reason, note: note.trim() || null, projectId: props.projectId }),
      });
      props.onSent();
    } catch {
      props.onSent();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={props.onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-[#e2e8f0] flex items-center justify-between">
          <h2 className="font-semibold text-[#0f172a]">{props.t.templateFlagTitle}</h2>
          <button onClick={props.onClose} className="text-[#64748b] hover:text-[#0f172a] text-xl leading-none" aria-label="Close">×</button>
        </div>
        <div className="p-5 space-y-2">
          {([
            ["missing", props.t.templateFlagReasonMissing],
            ["wrong_industry", props.t.templateFlagReasonWrongIndustry],
            ["ugly", props.t.templateFlagReasonUgly],
            ["other", props.t.templateFlagReasonOther],
          ] as const).map(([id, label]) => (
            <label key={id} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="reason" checked={reason === id} onChange={() => setReason(id)} />
              <span className="text-sm text-[#334155]">{label}</span>
            </label>
          ))}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={props.t.templateFlagNotePlaceholder}
            className="w-full mt-3 px-3 py-2 border border-[#e2e8f0] rounded-lg text-sm resize-none"
            rows={3}
            maxLength={1000}
          />
        </div>
        <div className="p-4 border-t border-[#e2e8f0] flex justify-end">
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 bg-[#7c3aed] text-white rounded-lg text-sm font-medium hover:bg-[#6d28d9] disabled:opacity-50"
          >
            {props.t.templateFlagSubmit}
          </button>
        </div>
      </div>
    </div>
  );
}
