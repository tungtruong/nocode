"use client";

import Link from "next/link";
import { useLang, LangToggle } from "@/components/LangProvider";

export default function LandingPage() {
  const { t } = useLang();

  return (
    <div className="min-h-screen bg-[#fcfcfd] text-[#18181b]">
      <nav className="flex items-center justify-between px-4 sm:px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#a855f7] shadow-sm shadow-[#7c3aed]/20">
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight">nocode</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <LangToggle />
          <Link href="/pricing" className="text-xs sm:text-sm text-[#71717a] hover:text-[#18181b] transition-colors">{t.pricing}</Link>
          <Link href="/login" className="text-xs sm:text-sm text-[#71717a] hover:text-[#18181b] transition-colors">{t.signin}</Link>
          <Link href="/builder" className="rounded-xl bg-[#7c3aed] px-3 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-medium text-white hover:bg-[#6d28d9] transition-all shadow-sm">
            {t.start}
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-4xl px-4 sm:px-6 pt-20 sm:pt-28 pb-16 sm:pb-20 text-center">
        <div className="mb-5 sm:mb-6 inline-flex items-center gap-2 rounded-full border border-[#e8e8ec] bg-white px-3 sm:px-4 py-1.5 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-[#7c3aed] animate-pulse" />
          <span className="text-[11px] sm:text-xs text-[#71717a]">{t.heroTag}</span>
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold leading-[1.1] tracking-tight">
          {t.heroTitle}<br />
          <span className="bg-gradient-to-r from-[#7c3aed] via-[#a855f7] to-[#6366f1] bg-clip-text text-transparent">{t.heroHighlight}</span>
        </h1>
        <p className="mx-auto mt-4 sm:mt-6 max-w-xl text-sm sm:text-base text-[#71717a] leading-relaxed">{t.heroDesc}</p>
        <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 px-4">
          <Link href="/builder" className="w-full sm:w-auto rounded-2xl bg-[#7c3aed] px-8 py-3.5 text-sm font-semibold text-white hover:bg-[#6d28d9] transition-all shadow-sm text-center">{t.heroCTA}</Link>
          <Link href="/pricing" className="w-full sm:w-auto rounded-2xl border border-[#e8e8ec] bg-white px-8 py-3.5 text-sm font-medium text-[#71717a] hover:text-[#18181b] hover:border-[#d4d4d8] transition-all shadow-sm text-center">{t.heroPricing}</Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 sm:px-6 pb-24 sm:pb-32">
        <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-3">
          {[
            { icon: "💬", title: t.feature1Title, desc: t.feature1Desc },
            { icon: "⚡", title: t.feature2Title, desc: t.feature2Desc },
            { icon: "🚀", title: t.feature3Title, desc: t.feature3Desc },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-[#e8e8ec] bg-white p-6 hover:border-[#d4d4d8] hover:shadow-sm transition-all">
              <div className="mb-3 text-2xl">{f.icon}</div>
              <h3 className="mb-1.5 text-sm font-semibold">{f.title}</h3>
              <p className="text-xs text-[#71717a] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-[#e8e8ec] px-6 py-8 text-center">
        <div className="flex items-center justify-center gap-4 text-xs text-[#a1a1aa]">
          <Link href="/rules" className="hover:text-[#71717a] transition-colors">{t.rules}</Link>
          <Link href="/pricing" className="hover:text-[#71717a] transition-colors">{t.pricing}</Link>
        </div>
        <p className="mt-2 text-xs text-[#d4d4d8]">{t.footerTag}</p>
      </footer>
    </div>
  );
}
