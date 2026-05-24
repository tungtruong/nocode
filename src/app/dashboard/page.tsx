"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLang, LangToggle } from "@/components/LangProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface AppItem {
  id: string;
  meta: { user_email: string; title: string; url: string; created_at: string };
}

interface ProjectItem {
  id: string;
  data: {
    user_email: string;
    appName: string;
    msgs: Array<{ role: string }>;
    html: string;
    url: string;
    updated_at: string;
  };
}

export default function DashboardPage() {
  const { t } = useLang();
  const router = useRouter();
  const [apps, setApps] = useState<AppItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/apps").then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
    ])
      .then(([appsRes, projectsRes]) => {
        if (appsRes.apps) setApps(appsRes.apps);
        if (projectsRes.projects) setProjects(projectsRes.projects);
        if (appsRes.error || projectsRes.error) {
          setError(appsRes.error || projectsRes.error || t.dashFetchError);
        }
      })
      .catch(() => setError(t.dashConnError))
      .finally(() => setLoading(false));
  }, [t]);

  const requestDelete = (id: string) => setDeletingId(id);
  const confirmDelete = async () => {
    const id = deletingId;
    setDeletingId(null);
    if (!id) return;
    const r = await fetch(`/api/apps/${id}`, { method: "DELETE" });
    if (r.ok) setApps((p) => p.filter((a) => a.id !== id));
  };

  const copyLink = (url: string) => { navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(null), 2000); };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  // A project is a "draft" if it has not been deployed yet, i.e. its `url` is
  // empty or doesn't match any of the user's currently deployed apps.
  const deployedUrls = new Set(apps.map((a) => a.meta.url));
  const drafts = projects.filter((p) => !p.data.url || !deployedUrls.has(p.data.url));

  return (
    <div className="min-h-screen bg-[#fcfcfd]">
      <nav className="flex items-center justify-between px-4 sm:px-6 py-4 max-w-4xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#a855f7] shadow-sm shadow-[#7c3aed]/20">
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
          </div>
          <span className="text-lg font-bold tracking-tight text-[#18181b]">nocode</span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-4">
          <LangToggle />
          <Link href="/builder" className="text-xs sm:text-sm text-[#7c3aed] hover:text-[#6d28d9] font-medium transition-colors">{t.newApp}</Link>
        </div>
      </nav>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-32">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">{t.dashTitle}</h1>
            <p className="text-sm text-[#71717a]">{t.dashDesc}</p>
          </div>
          <button onClick={handleLogout} className="text-xs text-[#64748b] hover:text-[#64748b] transition-colors">{t.signout}</button>
        </div>

        {loading && (
          <div className="space-y-3" aria-label={t.dashLoading} aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl border border-[#e8e8ec] bg-white p-5 flex items-center gap-3 animate-pulse">
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-[#f1f5f9] rounded w-2/3" />
                  <div className="h-2 bg-[#f1f5f9] rounded w-1/3" />
                </div>
                <div className="h-8 w-20 bg-[#f1f5f9] rounded-xl" />
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-3">
            <span>{error}</span>
            <button onClick={() => { setError(""); setLoading(true); window.location.reload(); }} className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-50">{t.dashRetry}</button>
          </div>
        )}

        {!loading && apps.length === 0 && drafts.length === 0 && !error && (
          <div className="text-center py-20">
            <p className="text-[#a1a1aa] mb-2">{t.dashEmpty}</p>
            <Link href="/builder" className="text-sm text-[#7c3aed] hover:underline">{t.dashFirst}</Link>
          </div>
        )}

        {!loading && drafts.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">{t.dashDrafts}</h2>
            <div className="space-y-3">
              {drafts.map((p) => {
                const userMsgCount = p.data.msgs.filter((m) => m.role === "user").length;
                return (
                  <div key={p.id} className="rounded-2xl border border-[#e8e8ec] bg-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 hover:border-[#d4d4d8] transition-all">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm truncate">{p.data.appName}</h3>
                      <p className="text-xs text-[#a1a1aa] mt-0.5">{new Date(p.data.updated_at).toLocaleDateString("vi-VN")} · {userMsgCount} {t.buildMsgs}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link href={`/builder?project=${p.id}`} className="rounded-xl bg-[#7c3aed] px-4 py-2 text-xs font-medium text-white hover:bg-[#6d28d9] transition-all">{t.dashContinue}</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && apps.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-3">{t.dashDeployed}</h2>
            <div className="space-y-3">
              {apps.map((app) => (
                <div key={app.id} className="rounded-2xl border border-[#e8e8ec] bg-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 hover:border-[#d4d4d8] transition-all">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate">{app.meta.title}</h3>
                    <p className="text-xs text-[#a1a1aa] mt-0.5">{new Date(app.meta.created_at).toLocaleDateString("vi-VN")} · {app.id}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a href={app.meta.url} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-[#7c3aed] px-4 py-2 text-xs font-medium text-white hover:bg-[#6d28d9] transition-all">{t.dashOpen}</a>
                    <button onClick={() => copyLink(app.meta.url)} className="rounded-xl border border-[#e8e8ec] bg-white px-3 py-2 text-xs text-[#71717a] hover:text-[#18181b] hover:border-[#d4d4d8] transition-all">{copied === app.meta.url ? t.dashCopied : t.dashCopy}</button>
                    <button onClick={() => requestDelete(app.id)} className="rounded-xl border border-red-100 bg-white px-3 py-2 text-xs text-red-500 hover:bg-red-50 hover:border-red-200 transition-all">{t.dashDelete}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      <ConfirmDialog
        open={deletingId !== null}
        title={t.dashDelete}
        message={t.dashDeleteConfirm}
        confirmLabel={t.dashDelete}
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeletingId(null)}
      />
    </div>
  );
}
