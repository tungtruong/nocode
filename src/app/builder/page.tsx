"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { LangToggle, useLang } from "@/components/LangProvider";

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

interface Msg { id: string; role: "user" | "assistant"; text: string; html?: string; summary?: string }
interface SavedProject {
  appId: string;
  appName: string;
  msgs: Msg[];
  html: string;
  url: string;
}

type Phase = "idle" | "new_app" | "thinking" | "streaming" | "done";

export default function BuilderPage() {
  const { t } = useLang();

  const [appId, setAppId] = useState("");
  const [appName, setAppName] = useState("");
  const [newAppName, setNewAppName] = useState("");
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [html, setHtml] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [chars, setChars] = useState(0);
  const [secs, setSecs] = useState(0);
  const [progress, setProgress] = useState("");
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
    const project: SavedProject = { appId, appName, msgs, html, url };
    setSavedProjects((prev) => {
      const filtered = prev.filter((p) => p.appId !== appId);
      return [project, ...filtered];
    });
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: appId, appName, msgs, html, url }),
    }).catch(() => {});
  }, [appId, appName, msgs, html, url]);

  // Open existing project
  const openProject = useCallback((p: SavedProject) => {
    setAppId(p.appId);
    setAppName(p.appName);
    setMsgs(p.msgs);
    setHtml(p.html);
    setUrl(p.url);
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
    setPhase("idle");
    setNewAppName("");
    setMobileTab("chat");
  }, [newAppName]);

  useEffect(() => { bot.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, phase]);

  const deploy = useCallback(async (h: string) => {
    setDeploying(true);
    setError("");
    try {
      const r = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: h, title: appName || "Untitled" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Deploy thất bại");
      setUrl(d.url);
    } catch (e: any) {
      setError(e.message || "Lỗi deploy");
    } finally {
      setDeploying(false);
    }
  }, [appName]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    setInput(""); setError(""); setChars(0); setSecs(0); setProgress("");
    setMobileTab("preview");

    const um: Msg = { id: Date.now().toString(), role: "user", text };
    const all = [...msgs, um];
    setMsgs(all);
    setPhase("thinking");
    t0.current = Date.now();
    timer.current = setInterval(() => setSecs(Math.floor((Date.now() - t0.current) / 1000)), 200);

    const aid = (Date.now() + 1).toString();
    aidRef.current = aid;
    let assistantAdded = false;

    const si = activeRef.current === 0 ? 1 : 0;
    const sf = si === 0 ? frameA : frameB;
    const sif = sf.current;
    let doc: Document | null = null;
    if (sif) {
      doc = sif.contentDocument || sif.contentWindow?.document || null;
      if (doc) doc.open();
    }

    try {
      const isFirst = !html;
      const ep = isFirst ? "/api/chat" : "/api/edit";
      const bd = isFirst
        ? JSON.stringify({ messages: all.slice(0, -1), currentHtml: html, newMessage: text })
        : JSON.stringify({ currentHtml: html, newMessage: text });
      const r = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/json" }, body: bd, signal: c.signal });
      if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(d?.error || "Sinh thất bại"); }

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
            if (pl.startsWith("done ")) setProgress(pl.slice(5));
            else if (pl.startsWith("summary ")) {
              try {
                const st = decodeURIComponent(pl.slice(8));
                setMsgs((p) => p.map((m) => (m.id === aid ? { ...m, summary: st } : m)));
              } catch {}
            } else if (pl) setProgress(pl);
            parts[i] = parts[i].slice(parts[i].indexOf("\n") + 1);
          }
        }
        chunk = parts.join("");
        if (!chunk.trim()) continue;
        acc += chunk;
        if (doc) doc.write(chunk);
        const c2 = cleanHtml(acc);
        setChars(acc.length);
        setHtml(c2);
        if (!assistantAdded) {
          assistantAdded = true;
          setMsgs((p) => [...p, { id: aid, role: "assistant", text: c2, html: c2 }]);
        } else {
          setMsgs((p) => p.map((m) => (m.id === aid ? { ...m, text: c2, html: c2 } : m)));
        }
        if (phase === "thinking") setPhase("streaming");
      }
      acc += dec.decode();
      if (doc) doc.close();
      const fin = cleanHtml(acc);
      setHtml(fin);
      setActive(si as 0 | 1);
      setMsgs((p) => {
        const exists = p.some((m) => m.id === aid);
        if (!exists) return [...p, { id: aid, role: "assistant", text: fin, html: fin }];
        return p.map((m) => (m.id === aid ? { ...m, text: fin, html: fin } : m));
      });
      setPhase("done");
    } catch (e: any) {
      if (doc) doc.close();
      if (e.name !== "AbortError") { setError(e.message); setPhase("idle"); } else setPhase("idle");
    } finally {
      if (timer.current) clearInterval(timer.current);
      abort.current = null;
    }
  }, [input, msgs, html, deploy, active, phase]);

  useEffect(() => {
    if (phase !== "done" && phase !== "idle") return;
    if (!html) return;
    [frameA.current, frameB.current].forEach((f) => { if (f && f.srcdoc !== html) f.srcdoc = html; });
  }, [phase, html]);

  const cancel = useCallback(() => { abort.current?.abort(); if (timer.current) clearInterval(timer.current); setPhase("idle"); }, []);
  const handleLogout = async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; };
  const busy = phase === "thinking" || phase === "streaming";
  const pct = useMemo(() => chars === 0 ? 0 : Math.min(95, Math.round((chars / 10000) * 100)), [chars]);

  // Show "New App" or "Open Project" screen when no project loaded
  if (!appId) {
    return (
      <div className="flex h-screen flex-col bg-[#fcfcfd] overflow-hidden">
        <header className="flex items-center justify-between border-b border-[#e2e8f0] bg-white px-4 sm:px-6 py-3 shrink-0">
          <a href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#a855f7] shadow-sm shadow-[#7c3aed]/20">
              <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <span className="text-base font-bold tracking-tight text-[#0f172a]">nocode</span>
          </a>
          <div className="flex items-center gap-2">
            <LangToggle />
            <a href="/dashboard" className="text-xs text-[#94a3b8] hover:text-[#64748b] transition-colors">{t.myApps}</a>
            <button onClick={handleLogout} className="rounded-lg px-2.5 py-1.5 text-xs text-[#94a3b8] hover:text-[#64748b] hover:bg-[#f1f5f9] transition-all">{t.signout}</button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar: existing projects */}
          <div className="w-64 border-r border-[#e2e8f0] bg-white p-4 space-y-3 overflow-y-auto hidden md:block">
            <h3 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider">{t.buildYourProjects}</h3>
            {savedProjects.length === 0 ? (
              <p className="text-xs text-[#cbd5e1]">{t.buildNoProjects}</p>
            ) : (
              savedProjects.map((p) => (
                <button key={p.appId} onClick={() => openProject(p)}
                  className="w-full text-left rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5 hover:border-[#7c3aed]/30 hover:bg-[#7c3aed]/[0.02] transition-all">
                  <p className="text-sm font-medium text-[#18181b] truncate">{p.appName}</p>
                  <p className="text-[10px] text-[#a1a1aa] mt-0.5">{p.msgs.filter((m) => m.role === "user").length} {t.buildMsgs}</p>
                </button>
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
              <p className="text-sm text-[#94a3b8] mb-6">{t.buildNewAppDesc}</p>
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
      </div>
    );
  }

  // Main builder UI (with project loaded)
  return (
    <div className="flex h-screen flex-col bg-[#fcfcfd] overflow-hidden">
      <header className="flex items-center justify-between border-b border-[#e2e8f0] bg-white px-4 sm:px-6 py-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <a href="/" className="shrink-0 flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#7c3aed] to-[#a855f7] shadow-sm shadow-[#7c3aed]/20">
              <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
          </a>
          <button onClick={() => { setAppId(""); setAppName(""); setMsgs([]); setHtml(""); setUrl(""); setPhase("idle"); }}
            className="text-xs text-[#94a3b8] hover:text-[#7c3aed] transition-colors ml-2" title={t.otherProjects}>
            ← {t.otherProjects}
          </button>
          <span className="text-sm font-semibold text-[#18181b] truncate">{appName}</span>
        </div>
        <div className="flex items-center gap-2">
          <LangToggle />
          {html && !deploying && (
            <button onClick={() => deploy(html)}
              className="rounded-full border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs font-medium text-[#64748b] hover:text-[#7c3aed] hover:border-[#7c3aed]/30 transition-all">
              {t.deploy}
            </button>
          )}
          {url && !deploying && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-all">
              {t.openApp} &rarr;
            </a>
          )}
          <a href="/dashboard" className="text-xs text-[#94a3b8] hover:text-[#64748b] transition-colors">{t.myApps}</a>
          <button onClick={handleLogout} className="rounded-lg px-2.5 py-1.5 text-xs text-[#94a3b8] hover:text-[#64748b] hover:bg-[#f1f5f9] transition-all">{t.signout}</button>
        </div>
      </header>

      {/* Mobile tabs */}
      <div className="flex md:hidden border-b border-[#e2e8f0] bg-white shrink-0">
        {(["Chat", "Xem trước"] as const).map((tab) => (
          <button key={tab} onClick={() => setMobileTab(tab === "Chat" ? "chat" : "preview")}
            className={`flex-1 py-3 text-xs font-semibold text-center transition-all relative ${
              (tab === "Chat" && mobileTab === "chat") || (tab === "Xem trước" && mobileTab === "preview") ? "text-[#7c3aed]" : "text-[#94a3b8] hover:text-[#64748b]"
            }`}>
            {tab}
            {((tab === "Chat" && mobileTab === "chat") || (tab === "Xem trước" && mobileTab === "preview")) && <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full bg-[#7c3aed]" />}
            {tab === "Xem trước" && busy && <span className="absolute top-1.5 right-1/4 h-1.5 w-1.5 rounded-full bg-[#7c3aed] animate-pulse" />}
          </button>
        ))}
      </div>

      <div className="flex flex-1 min-h-0">
        <div className={`${mobileTab === "preview" ? "hidden" : "flex"} md:flex w-full flex-col md:w-[384px] lg:w-[440px] xl:w-[480px] bg-white border-r border-[#e2e8f0]`}>
          <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-5">
            {msgs.map((m) => (
              <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
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
                    {m.role === "user" ? m.text : m.html ? (
                      <div>
                        {phase === "streaming" && m.id === msgs[msgs.length - 1]?.id ? (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="flex h-2 w-2 rounded-full bg-[#7c3aed] animate-pulse" />
                            <span className="text-[#94a3b8] font-medium">{t.buildBuilding}</span>
                          </div>
                        ) : (
                          <p className="text-xs text-[#334155] leading-relaxed font-medium">{m.summary || t.buildDone}</p>
                        )}
                      </div>
                    ) : <span className="text-xs text-[#94a3b8] font-medium">{t.buildWait}</span>}
                  </div>
                </div>
              </div>
            ))}

            <div ref={bot} />
            {(phase === "thinking" || phase === "streaming") && (
              <div className="flex gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f1f5f9] text-[#7c3aed] ring-1 ring-[#e2e8f0] text-xs font-bold">AI</div>
                <div className="rounded-2xl rounded-tl-md bg-[#f8fafc] ring-1 ring-[#e2e8f0] px-4 py-3 min-w-[200px] space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-2">
                      <span className="flex h-2 w-2 rounded-full bg-[#7c3aed] animate-pulse" />
                      <span className="text-xs text-[#64748b] font-medium truncate">
                        {progress || (phase === "thinking" ? t.buildThinking : t.buildBuilding)}
                      </span>
                    </span>
                    <span className="text-[10px] text-[#a1a1aa] tabular-nums ml-auto">{secs}s{chars > 0 ? ` · ${chars.toLocaleString()}c` : ""}</span>
                  </div>
                  <div className="h-1 w-full bg-[#e2e8f0] rounded-full overflow-hidden">
                    <div className="h-full bg-[#7c3aed] transition-all duration-300 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            )}
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
                <button onClick={cancel} className="shrink-0 flex items-center justify-center rounded-xl border border-[#e2e8f0] bg-white w-9 h-9 text-[#94a3b8] hover:text-[#64748b] hover:bg-[#f1f5f9] transition-all">
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2" /></svg>
                </button>
              ) : (
                <button onClick={send} disabled={!input.trim()}
                  className="shrink-0 flex items-center justify-center rounded-xl bg-[#7c3aed] w-9 h-9 text-white hover:bg-[#6d28d9] disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm shadow-[#7c3aed]/20">
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8h12M10 4l4 4-4 4" /></svg>
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
              <span className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wider">{t.buildPreview}</span>
            </div>
          </div>
          <div className="relative flex-1 bg-white">
            <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-8">
              <div className="h-full w-full sm:max-w-[420px] sm:h-auto sm:aspect-[9/16] sm:max-h-[85vh] rounded-3xl sm:shadow-2xl sm:shadow-black/[0.06] sm:ring-1 sm:ring-black/[0.04] overflow-hidden">
                <iframe ref={frameA} title="A" className="absolute inset-0 w-full h-full border-0 transition-opacity duration-200"
                  style={{ opacity: active === 0 ? 1 : 0, pointerEvents: active === 0 ? "auto" : "none", zIndex: active === 0 ? 2 : 1 }}
                  sandbox="allow-scripts allow-same-origin allow-modals allow-forms" />
                <iframe ref={frameB} title="B" className="absolute inset-0 w-full h-full border-0 transition-opacity duration-200"
                  style={{ opacity: active === 1 ? 1 : 0, pointerEvents: active === 1 ? "auto" : "none", zIndex: active === 1 ? 2 : 1 }}
                  sandbox="allow-scripts allow-same-origin allow-modals allow-forms" />
              </div>
            </div>
            {!html && !busy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-[#cbd5e1] z-0">
                <p className="text-base font-semibold text-[#94a3b8]">{t.buildPreviewEmpty}</p>
                <p className="text-sm text-[#cbd5e1] mt-1">{t.buildPreviewHint}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
