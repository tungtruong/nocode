"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLang, LangToggle } from "@/components/LangProvider";

export default function SignupPage() {
  const { t } = useLang();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  // Derived directly from the URL — no need for useState/useEffect
  // round-trip just to read a query param.
  const ref = useMemo(() => (searchParams.get("ref") || "").toUpperCase(), [searchParams]);
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
        body: JSON.stringify({ email: trimmedEmail, password, name: name.trim(), ref: ref || undefined }),
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
            <span className="text-lg font-bold tracking-tight text-[#18181b]">JustVibe</span>
          </Link>
        </div>
        <div className="rounded-2xl border border-[#e8e8ec] bg-white p-7 shadow-sm">
          <h2 className="mb-1 text-xl font-semibold text-[#18181b]">{t.signupTitle}</h2>
          <p className="mb-6 text-sm text-[#64748b]">{t.signupSub}</p>
          {ref && (
            <div className="mb-4 rounded-xl border border-[#7c3aed]/20 bg-[#7c3aed]/[0.04] px-3 py-2 text-xs text-[#7c3aed]">
              {t.signupReferralBadge} <span className="font-mono font-semibold">{ref}</span>
            </div>
          )}

          {/* OAuth providers — first sign-in creates the account. */}
          <div className="space-y-2 mb-5">
            <a
              href={`/api/auth/google?redirect=/builder${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-[#e8e8ec] bg-white py-2.5 text-sm font-medium text-[#334155] hover:bg-[#f8fafc] hover:border-[#cbd5e1] transition-all shadow-sm"
            >
              <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C41 35.5 44 30.2 44 24c0-1.3-.1-2.3-.4-3.5z"/>
              </svg>
              {t.loginGoogle}
            </a>
            <a
              href={`/api/auth/facebook?redirect=/builder${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#1877F2] py-2.5 text-sm font-medium text-white hover:bg-[#166fe0] transition-all shadow-sm"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073"/>
              </svg>
              {t.loginFacebook}
            </a>
            {/* Zalo OAuth tạm tắt theo chính sách — route + lib (zalo-oauth.ts,
                /api/auth/zalo/*) vẫn còn để re-enable nhanh khi cần. */}
          </div>

          <details className="text-xs text-[#94a3b8]">
            <summary className="cursor-pointer text-center select-none hover:text-[#64748b] py-1">{t.signupEmailFallback}</summary>
          <form onSubmit={handleSubmit} className="space-y-4 mt-4 pt-4 border-t border-[#f1f5f9]">
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
          </details>
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
