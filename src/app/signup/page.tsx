"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLang, LangToggle } from "@/components/LangProvider";

export default function SignupPage() {
  const { t } = useLang();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(t.signupBadEmail);
      return;
    }
    if (password.length < 8) {
      setError(t.signupBadPassword);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password, name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t.signupError);
        setLoading(false);
        return;
      }
      router.push("/builder");
    } catch {
      setError(t.signupError);
      setLoading(false);
    }
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
          <h2 className="mb-1 text-xl font-semibold text-[#18181b]">{t.signupTitle}</h2>
          <p className="mb-7 text-sm text-[#64748b]">{t.signupSub}</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#71717a]">{t.signupName}</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.signupNamePh} required autoComplete="name" className="w-full rounded-xl border border-[#e8e8ec] bg-white px-4 py-2.5 text-sm text-[#18181b] placeholder:text-[#cbd5e1] focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/10 transition-all" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#71717a]">{t.loginEmail}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" className="w-full rounded-xl border border-[#e8e8ec] bg-white px-4 py-2.5 text-sm text-[#18181b] placeholder:text-[#cbd5e1] focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/10 transition-all" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#71717a]">{t.loginPassword}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={8} autoComplete="new-password" className="w-full rounded-xl border border-[#e8e8ec] bg-white px-4 py-2.5 text-sm text-[#18181b] placeholder:text-[#cbd5e1] focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/10 transition-all" />
              <p className="mt-1 text-[10px] text-[#94a3b8]">{t.signupPasswordHint}</p>
            </div>
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-600">{error}</div>}
            <button type="submit" disabled={loading} className="w-full rounded-xl bg-[#7c3aed] py-2.5 text-sm font-semibold text-white hover:bg-[#6d28d9] disabled:opacity-50 transition-all shadow-sm shadow-[#7c3aed]/20">{loading ? t.signupLoading : t.signupBtn}</button>
          </form>
          <p className="mt-5 text-center text-xs text-[#94a3b8]">
            {t.signupHaveAccount}{" "}
            <Link href="/login" className="text-[#7c3aed] hover:text-[#6d28d9] font-medium">{t.signin}</Link>
          </p>
        </div>
        <div className="mt-4 text-center"><LangToggle /></div>
      </div>
    </div>
  );
}
