"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLang, LangToggle } from "@/components/LangProvider";
import { t as translations } from "@/lib/i18n";

type PlanTier = "free" | "pro" | "team";

export default function PricingPage() {
  const { t, lang } = useLang();
  const features = translations[lang];
  const router = useRouter();
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const [err, setErr] = useState("");

  const PLANS: Array<{ tier: PlanTier; name: string; price: string; desc: string; features: readonly string[]; cta: string; highlight: boolean }> = [
    { tier: "free", name: t.planFree, price: "0", desc: t.planFreeDesc, features: features.planFreeFeatures as readonly string[], cta: t.planFreeCTA, highlight: false },
    { tier: "pro", name: t.planPro, price: "12", desc: t.planProDesc, features: features.planProFeatures as readonly string[], cta: t.planProCTA, highlight: true },
    { tier: "team", name: t.planTeam, price: "39", desc: t.planTeamDesc, features: features.planTeamFeatures as readonly string[], cta: t.planTeamCTA, highlight: false },
  ];

  const handleUpgrade = async (tier: PlanTier) => {
    setErr("");
    // Free plan is just "open the builder" — no checkout.
    if (tier === "free") { router.push("/builder"); return; }
    setBusyTier(tier);
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const d = await r.json();
      if (r.status === 401) { router.push(`/login?redirect=/pricing`); return; }
      if (!r.ok || !d.url) throw new Error(d.error || "Lỗi tạo thanh toán");
      // Stripe Checkout: redirect the whole page so card form replaces ours.
      window.location.assign(d.url as string);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lỗi không xác định");
      setBusyTier(null);
    }
  };

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
        {err && (
          <div className="mt-6 mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">{err}</div>
        )}
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {PLANS.map((plan) => {
            const busy = busyTier === plan.tier;
            return (
              <div key={plan.name} className={`rounded-2xl border p-6 text-left transition-all ${plan.highlight ? "border-[#7c3aed]/30 bg-[#7c3aed]/[0.02] shadow-sm ring-1 ring-[#7c3aed]/10" : "border-[#e8e8ec] bg-white hover:border-[#d4d4d8] hover:shadow-sm"}`}>
                <h3 className="text-sm font-semibold">{plan.name}</h3>
                <div className="mt-3 flex items-baseline gap-1"><span className="text-3xl font-bold tracking-tight">${plan.price}</span><span className="text-sm text-[#71717a]">/mo</span></div>
                <p className="mt-1 text-xs text-[#a1a1aa]">{plan.desc}</p>
                <ul className="mt-5 space-y-2">{plan.features.map((f: string) => (<li key={f} className="flex items-start gap-2 text-xs text-[#71717a]"><span className="mt-0.5 text-[#7c3aed]">&#10003;</span> {f}</li>))}</ul>
                <button
                  type="button"
                  onClick={() => handleUpgrade(plan.tier)}
                  disabled={busy}
                  className={`mt-6 block w-full rounded-xl py-2.5 text-center text-sm font-medium transition-all disabled:opacity-60 disabled:cursor-wait ${plan.highlight ? "bg-[#7c3aed] text-white hover:bg-[#6d28d9]" : "border border-[#e8e8ec] bg-white text-[#71717a] hover:text-[#18181b] hover:border-[#d4d4d8]"}`}
                >
                  {busy ? t.checkoutRedirecting : plan.cta}
                </button>
              </div>
            );
          })}
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
