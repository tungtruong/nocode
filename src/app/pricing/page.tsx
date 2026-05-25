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
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const submitRedeem = async () => {
    const code = redeemCode.trim();
    if (!code) return;
    setRedeemBusy(true);
    setRedeemMsg(null);
    try {
      const r = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (r.status === 401) {
        router.push(`/login?redirect=/pricing`);
        return;
      }
      const d = await r.json();
      if (!r.ok) {
        setRedeemMsg({ kind: "err", text: d.error || t.pricingRedeemError });
      } else {
        setRedeemMsg({
          kind: "ok",
          text: t.pricingRedeemSuccess
            .replace("{tier}", d.tier)
            .replace("{days}", String(d.daysGranted)),
        });
        setRedeemCode("");
        // Close + bounce to dashboard so the user sees their new tier badge.
        setTimeout(() => {
          setRedeemOpen(false);
          router.push("/dashboard");
        }, 1800);
      }
    } catch {
      setRedeemMsg({ kind: "err", text: t.pricingRedeemError });
    } finally {
      setRedeemBusy(false);
    }
  };

  const PLANS: Array<{
    tier: PlanTier;
    name: string;
    price: string;
    desc: string;
    features: readonly string[];
    cta: string;
    highlight: boolean;
    badge?: string;
  }> = [
    {
      tier: "free",
      name: t.planFree,
      price: "0",
      desc: t.planFreeDesc,
      features: features.planFreeFeatures as readonly string[],
      cta: t.planFreeCTA,
      highlight: false,
    },
    {
      tier: "pro",
      name: t.planPro,
      price: "14.99",
      desc: t.planProDesc,
      features: features.planProFeatures as readonly string[],
      cta: t.planProCTA,
      highlight: false,
    },
    {
      tier: "team",
      name: t.planTeam,
      price: "39.99",
      desc: t.planTeamDesc,
      features: features.planTeamFeatures as readonly string[],
      cta: t.planTeamCTA,
      highlight: true,
      // Anchor the value-ladder story: Max is what we want users to upgrade
      // INTO from Pro, not just an enterprise upsell from Free.
      badge: lang === "vi" ? "Giá trị tốt nhất" : "Best value",
    },
  ];

  const FAQ = [
    [t.pricingFAQ1Q, t.pricingFAQ1A],
    [t.pricingFAQ2Q, t.pricingFAQ2A],
    [t.pricingFAQ3Q, t.pricingFAQ3A],
    [t.pricingFAQ4Q, t.pricingFAQ4A],
    [t.pricingFAQ5Q, t.pricingFAQ5A],
  ];

  const handleUpgrade = async (tier: PlanTier) => {
    setErr("");
    if (tier === "free") {
      router.push("/builder");
      return;
    }
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
      // PayPal approval page — redirect the whole window so the user lands
      // back on /api/webhooks/paypal after approval.
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
          <span className="text-lg font-semibold tracking-tight">JustVibe</span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-4">
          <LangToggle />
          <Link href="/login" className="text-xs sm:text-sm text-[#71717a] hover:text-[#18181b] transition-colors">{t.signin}</Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 pt-16 pb-12 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t.pricingTitle}</h2>
        <p className="mt-3 text-sm text-[#71717a]">{t.pricingSub}</p>

        {err && (
          <div className="mt-6 mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">{err}</div>
        )}

        <div className="mt-6 mx-auto max-w-xl rounded-full bg-gradient-to-r from-[#7c3aed]/10 to-[#a855f7]/10 px-5 py-2 text-xs font-medium text-[#7c3aed]">
          🎁 {t.pricingValueHighlight}
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-3 text-left">
          {PLANS.map((plan) => {
            const busy = busyTier === plan.tier;
            return (
              <div
                key={plan.name}
                className={`relative rounded-2xl border p-6 transition-all ${
                  plan.highlight
                    ? "border-[#7c3aed]/40 bg-white shadow-md ring-1 ring-[#7c3aed]/15"
                    : "border-[#e8e8ec] bg-white hover:border-[#d4d4d8] hover:shadow-sm"
                }`}
              >
                {plan.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#7c3aed] px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                    {plan.badge}
                  </span>
                )}
                <h3 className="text-sm font-semibold">{plan.name}</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-3xl font-bold tracking-tight">${plan.price}</span>
                  <span className="text-sm text-[#71717a]">/mo</span>
                </div>
                <p className="mt-1 text-xs text-[#a1a1aa]">{plan.desc}</p>
                <ul className="mt-5 space-y-2 min-h-[280px]">
                  {plan.features.map((f: string) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-[#52525b] leading-relaxed">
                      <span className="mt-0.5 text-[#7c3aed] shrink-0">&#10003;</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => handleUpgrade(plan.tier)}
                  disabled={busy}
                  className={`mt-6 block w-full rounded-xl py-2.5 text-center text-sm font-medium transition-all disabled:opacity-60 disabled:cursor-wait ${
                    plan.highlight
                      ? "bg-[#7c3aed] text-white hover:bg-[#6d28d9]"
                      : "border border-[#e8e8ec] bg-white text-[#52525b] hover:text-[#18181b] hover:border-[#d4d4d8]"
                  }`}
                >
                  {busy ? t.checkoutRedirecting : plan.cta}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => { setRedeemMsg(null); setRedeemOpen(true); }}
            className="text-xs text-[#7c3aed] hover:text-[#6d28d9] hover:underline font-medium"
          >
            {t.pricingRedeemLink}
          </button>
        </div>

        <div className="mt-8 mx-auto max-w-3xl space-y-3 text-left">
          <div className="rounded-xl border border-[#7c3aed]/20 bg-[#7c3aed]/[0.03] px-4 py-3 text-xs text-[#52525b] leading-relaxed">
            💡 {t.pricingCacheNote}
          </div>
          <div className="rounded-xl border border-[#e8e8ec] bg-white px-4 py-3 text-xs text-[#71717a] leading-relaxed">
            💳 {t.pricingPaymentNote}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-24">
        <h3 className="text-lg font-semibold mb-5 text-center">{t.pricingFAQTitle}</h3>
        <div className="space-y-3">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group rounded-xl border border-[#e8e8ec] bg-white px-4 py-3 open:bg-[#fafafa] transition-colors">
              <summary className="cursor-pointer text-sm font-medium text-[#18181b] list-none flex items-start justify-between gap-3">
                <span>{q}</span>
                <span className="text-[#7c3aed] transition-transform group-open:rotate-180 shrink-0">▾</span>
              </summary>
              <p className="mt-3 text-xs text-[#52525b] leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="border-t border-[#e8e8ec] px-6 py-6 text-center">
        <div className="flex items-center justify-center gap-4 text-xs text-[#a1a1aa]">
          <Link href="/rules" className="hover:text-[#71717a] transition-colors">{t.rules}</Link>
          <Link href="/" className="hover:text-[#71717a] transition-colors">{t.home}</Link>
        </div>
      </footer>

      {redeemOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setRedeemOpen(false)}
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-[#0f172a] mb-1">{t.pricingRedeemTitle}</h2>
            <p className="text-xs text-[#52525b] mb-4">{t.pricingRedeemDesc}</p>
            <input
              type="text"
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
              placeholder={t.pricingRedeemPlaceholder}
              className="w-full rounded-xl border border-[#e8e8ec] px-4 py-2.5 text-sm font-mono tracking-wider uppercase focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/10"
              autoFocus
              maxLength={32}
              onKeyDown={(e) => { if (e.key === "Enter" && !redeemBusy) submitRedeem(); }}
            />
            {redeemMsg && (
              <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                redeemMsg.kind === "ok"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-red-200 bg-red-50 text-red-600"
              }`}>
                {redeemMsg.text}
              </div>
            )}
            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={() => setRedeemOpen(false)}
                className="rounded-lg px-4 py-2 text-sm text-[#64748b] hover:bg-[#fafafa]"
              >
                {t.pricingRedeemCancel}
              </button>
              <button
                onClick={submitRedeem}
                disabled={redeemBusy || !redeemCode.trim()}
                className="rounded-lg bg-[#7c3aed] text-white px-4 py-2 text-sm font-medium hover:bg-[#6d28d9] disabled:opacity-50"
              >
                {redeemBusy ? "..." : t.pricingRedeemSubmit}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
