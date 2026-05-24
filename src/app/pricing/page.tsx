"use client";

import Link from "next/link";
import { useLang, LangToggle } from "@/components/LangProvider";
import { t as translations } from "@/lib/i18n";

export default function PricingPage() {
  const { t, lang } = useLang();
  const features = translations[lang];

  const PLANS = [
    { name: t.planFree, price: "0", desc: t.planFreeDesc, features: features.planFreeFeatures as readonly string[], cta: t.planFreeCTA, href: "/builder", highlight: false },
    { name: t.planPro, price: "12", desc: t.planProDesc, features: features.planProFeatures as readonly string[], cta: t.planProCTA, href: "/login", highlight: true },
    { name: t.planTeam, price: "39", desc: t.planTeamDesc, features: features.planTeamFeatures as readonly string[], cta: t.planTeamCTA, href: "/login", highlight: false },
  ];

  return (
    <div className="min-h-screen bg-[#fcfcfd] text-[#18181b]">
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#a855f7] shadow-sm shadow-[#7c3aed]/20">
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
          </div>
          <span className="text-lg font-semibold tracking-tight">nocode</span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-4">
          <LangToggle />
          <Link href="/login" className="text-xs sm:text-sm text-[#71717a] hover:text-[#18181b] transition-colors">{t.signin}</Link>
        </div>
      </nav>

      <section className="mx-auto max-w-4xl px-6 pt-20 pb-32 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t.pricingTitle}</h2>
        <p className="mt-3 text-sm text-[#71717a]">{t.pricingSub}</p>
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {PLANS.map((plan) => (
            <div key={plan.name} className={`rounded-2xl border p-6 text-left transition-all ${plan.highlight ? "border-[#7c3aed]/30 bg-[#7c3aed]/[0.02] shadow-sm ring-1 ring-[#7c3aed]/10" : "border-[#e8e8ec] bg-white hover:border-[#d4d4d8] hover:shadow-sm"}`}>
              <h3 className="text-sm font-semibold">{plan.name}</h3>
              <div className="mt-3 flex items-baseline gap-1"><span className="text-3xl font-bold tracking-tight">${plan.price}</span><span className="text-sm text-[#71717a]">/mo</span></div>
              <p className="mt-1 text-xs text-[#a1a1aa]">{plan.desc}</p>
              <ul className="mt-5 space-y-2">{plan.features.map((f: string) => (<li key={f} className="flex items-start gap-2 text-xs text-[#71717a]"><span className="mt-0.5 text-[#7c3aed]">&#10003;</span> {f}</li>))}</ul>
              <Link href={plan.href} className={`mt-6 block w-full rounded-xl py-2.5 text-center text-sm font-medium transition-all ${plan.highlight ? "bg-[#7c3aed] text-white hover:bg-[#6d28d9]" : "border border-[#e8e8ec] bg-white text-[#71717a] hover:text-[#18181b] hover:border-[#d4d4d8]"}`}>{plan.cta}</Link>
            </div>
          ))}
        </div>
      </section>
      <footer className="border-t border-[#e8e8ec] px-6 py-6 text-center">
        <div className="flex items-center justify-center gap-4 text-xs text-[#a1a1aa]">
          <Link href="/rules" className="hover:text-[#71717a] transition-colors">{t.rules}</Link>
          <Link href="/" className="hover:text-[#71717a] transition-colors">{t.home}</Link>
        </div>
      </footer>
    </div>
  );
}
