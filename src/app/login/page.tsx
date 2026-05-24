"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLang, LangToggle } from "@/components/LangProvider";

export default function LoginPage() {
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || t.loginError); setLoading(false); return; }
      const params = new URLSearchParams(window.location.search);
      router.push(params.get("redirect") || "/builder");
    } catch { setError(t.loginError); setLoading(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fcfcfd] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#a855f7] shadow-sm shadow-[#7c3aed]/20">
              <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
            </div>
            <span className="text-lg font-bold tracking-tight text-[#18181b]">nocode</span>
          </Link>
        </div>
        <div className="rounded-2xl border border-[#e8e8ec] bg-white p-7 shadow-sm">
          <h2 className="mb-1 text-xl font-semibold text-[#18181b]">{t.loginTitle}</h2>
          <p className="mb-7 text-sm text-[#a1a1aa]">{t.loginSub}</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#71717a]">{t.loginEmail}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="demo@nocode.dev" required autoComplete="email" className="w-full rounded-xl border border-[#e8e8ec] bg-white px-4 py-2.5 text-sm text-[#18181b] placeholder:text-[#d4d4d8] focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/10 transition-all" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#71717a]">{t.loginPassword}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="demo123" required autoComplete="current-password" className="w-full rounded-xl border border-[#e8e8ec] bg-white px-4 py-2.5 text-sm text-[#18181b] placeholder:text-[#d4d4d8] focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/10 transition-all" />
            </div>
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-600">{error}</div>}
            <button type="submit" disabled={loading} className="w-full rounded-xl bg-[#7c3aed] py-2.5 text-sm font-semibold text-white hover:bg-[#6d28d9] disabled:opacity-50 transition-all shadow-sm shadow-[#7c3aed]/20">{loading ? t.loginLoading : t.loginBtn}</button>
          </form>
          <p className="mt-5 text-center text-xs text-[#d4d4d8]">{t.loginDemo} <span className="text-[#a1a1aa] font-medium">demo@nocode.dev</span> / <span className="text-[#a1a1aa] font-medium">demo123</span></p>
        </div>
        <div className="mt-4 text-center"><LangToggle /></div>
      </div>
    </div>
  );
}
