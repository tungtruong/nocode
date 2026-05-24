"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLang, LangToggle } from "@/components/LangProvider";

interface AppItem {
  id: string;
  meta: { user_email: string; title: string; url: string; created_at: string };
}

export default function DashboardPage() {
  const { t } = useLang();
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/apps")
      .then((r) => r.json())
      .then((d) => { if (d.apps) setApps(d.apps); else setError(d.error || "Lỗi tải dữ liệu"); })
      .catch(() => setError("Lỗi kết nối"))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Xóa app này?")) return;
    const r = await fetch(`/api/apps/${id}`, { method: "DELETE" });
    if (r.ok) setApps((p) => p.filter((a) => a.id !== id));
  };

  const copyLink = (url: string) => { navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(null), 2000); };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

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
          <button onClick={handleLogout} className="text-xs text-[#94a3b8] hover:text-[#64748b] transition-colors">{t.signout}</button>
        </div>

        {loading && <p className="text-sm text-[#a1a1aa]">{t.dashLoading}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {!loading && apps.length === 0 && !error && (
          <div className="text-center py-20">
            <p className="text-[#a1a1aa] mb-2">{t.dashEmpty}</p>
            <Link href="/builder" className="text-sm text-[#7c3aed] hover:underline">{t.dashFirst}</Link>
          </div>
        )}

        {apps.length > 0 && (
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
                  <button onClick={() => handleDelete(app.id)} className="rounded-xl border border-red-100 bg-white px-3 py-2 text-xs text-red-500 hover:bg-red-50 hover:border-red-200 transition-all">{t.dashDelete}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
