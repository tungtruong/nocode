"use client";

import Link from "next/link";
import { useLang, LangToggle } from "@/components/LangProvider";
import { APP_MODES, type ModeId } from "@/lib/modes";

function chipHref(prompt: string) {
  return `/builder?prompt=${encodeURIComponent(prompt)}`;
}

export default function LandingPage() {
  const { t } = useLang();

  const CHIPS = [t.heroChip1, t.heroChip2, t.heroChip3, t.heroChip4];

  // Mode showcase — one card per supported mode. Tagline + sample prompt
  // that opens /builder pre-filled (the chip + URL flow).
  type ShowcaseItem = { id: ModeId; tagline: string; samplePrompt: string };
  const SHOWCASE: ShowcaseItem[] = [
    { id: "qr_menu",    tagline: "Menu cho cafe/nhà hàng — kèm Zalo order",          samplePrompt: "Tạo menu QR cho quán cafe Highland với 3 nhóm: cà phê, trà sữa, bánh ngọt" },
    { id: "wedding",    tagline: "Thiệp mời cưới — countdown + RSVP + gallery",       samplePrompt: "Thiệp cưới cho Tùng & Lan, đám cưới 15/12/2026, ở Hà Nội" },
    { id: "landing",    tagline: "Landing trang chủ — hero + CTA + form lead",       samplePrompt: "Landing page cho khóa học SEO 6 tuần, giá 2tr, có form đăng ký" },
    { id: "pitch_deck", tagline: "Slide pitch deck — điều hướng bằng phím mũi tên",  samplePrompt: "Pitch deck cho startup AI gọi vốn seed $500K, 8 slide" },
    { id: "cv_resume",  tagline: "CV / Resume — in PDF, theme sáng/tối",             samplePrompt: "CV cho lập trình viên frontend 5 năm React, vị trí Senior" },
    { id: "web_app",    tagline: "App tự do — todo, calculator, game, bất kỳ thứ gì", samplePrompt: "App quản lý chi tiêu cá nhân theo ngày, có biểu đồ" },
  ];

  return (
    <div className="min-h-screen bg-[#fcfcfd] text-[#18181b]">
      <nav className="flex items-center justify-between px-4 sm:px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#a855f7] shadow-sm shadow-[#7c3aed]/20">
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight">JustVibe</span>
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

      {/* HERO */}
      <section className="mx-auto max-w-4xl px-4 sm:px-6 pt-16 sm:pt-24 pb-12 sm:pb-16 text-center">
        <div className="mb-5 sm:mb-6 inline-flex items-center gap-2 rounded-full border border-[#e8e8ec] bg-white px-3 sm:px-4 py-1.5 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-[#7c3aed] animate-pulse" />
          <span className="text-[11px] sm:text-xs text-[#71717a]">{t.heroTag}</span>
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight">
          {t.heroTitle}<br />
          <span className="bg-gradient-to-r from-[#7c3aed] via-[#a855f7] to-[#6366f1] bg-clip-text text-transparent">{t.heroHighlight}</span>
        </h1>
        <p className="mx-auto mt-4 sm:mt-6 max-w-2xl text-sm sm:text-base text-[#52525b] leading-relaxed">{t.heroDesc}</p>
        <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 px-4">
          <Link href="/builder" className="w-full sm:w-auto rounded-2xl bg-[#7c3aed] px-8 py-3.5 text-sm font-semibold text-white hover:bg-[#6d28d9] transition-all shadow-md shadow-[#7c3aed]/20 text-center">{t.heroCTA}</Link>
          <Link href="/pricing" className="w-full sm:w-auto rounded-2xl border border-[#e8e8ec] bg-white px-8 py-3.5 text-sm font-medium text-[#71717a] hover:text-[#18181b] hover:border-[#d4d4d8] transition-all shadow-sm text-center">{t.heroPricing}</Link>
        </div>

        {/* Sample prompt chips — click drops user into the builder with that
            prompt prefilled (see `?prompt=` handler in builder/page.tsx). */}
        <div className="mt-10 flex flex-col items-center gap-3">
          <p className="text-[11px] uppercase tracking-wider text-[#94a3b8] font-medium">{t.heroChipsLabel}</p>
          <div className="flex flex-wrap items-center justify-center gap-2 max-w-3xl">
            {CHIPS.map((label) => (
              <Link
                key={label}
                href={chipHref(label.replace(/^[^\s]+\s/, ""))}
                className="rounded-full border border-[#e8e8ec] bg-white px-3.5 py-2 text-xs font-medium text-[#52525b] hover:border-[#7c3aed]/40 hover:bg-[#7c3aed]/[0.04] hover:text-[#7c3aed] transition"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* MODE SHOWCASE */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.showcaseTitle}</h2>
          <p className="mt-3 text-sm text-[#71717a]">{t.showcaseSub}</p>
        </div>
        <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {SHOWCASE.map((s) => {
            const mode = APP_MODES[s.id];
            return (
              <Link
                key={s.id}
                href={chipHref(s.samplePrompt)}
                className="group rounded-2xl border border-[#e8e8ec] bg-white p-5 hover:border-[#7c3aed]/30 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-3xl">{mode.emoji}</div>
                  <h3 className="text-sm font-semibold text-[#18181b] group-hover:text-[#7c3aed] transition-colors">
                    {t[mode.labelKey]}
                  </h3>
                </div>
                <p className="text-xs text-[#71717a] leading-relaxed mb-3">{s.tagline}</p>
                <div className="rounded-lg bg-[#fafafa] border border-[#f1f5f9] px-3 py-2 text-[11px] text-[#52525b] font-mono leading-relaxed">
                  &ldquo;{s.samplePrompt}&rdquo;
                </div>
                <div className="mt-3 text-[11px] font-medium text-[#7c3aed] opacity-0 group-hover:opacity-100 transition-opacity">
                  → Thử ngay
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-5xl px-4 sm:px-6 py-16 sm:py-20 border-t border-[#e8e8ec]">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.howTitle}</h2>
          <p className="mt-3 text-sm text-[#71717a]">{t.howSub}</p>
        </div>
        <div className="grid gap-6 sm:gap-8 sm:grid-cols-3">
          {[
            { title: t.how1Title, desc: t.how1Desc },
            { title: t.how2Title, desc: t.how2Desc },
            { title: t.how3Title, desc: t.how3Desc },
          ].map((step) => (
            <div key={step.title} className="relative">
              <h3 className="text-base font-semibold text-[#18181b] mb-2">{step.title}</h3>
              <p className="text-sm text-[#52525b] leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING TEASER */}
      <section className="mx-auto max-w-3xl px-4 sm:px-6 py-16 sm:py-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.pricingTeaserTitle}</h2>
        <p className="mt-3 text-sm text-[#71717a]">{t.pricingTeaserSub}</p>
        <div className="mt-6">
          <Link
            href="/pricing"
            className="inline-block rounded-2xl border border-[#e8e8ec] bg-white px-6 py-3 text-sm font-medium text-[#7c3aed] hover:border-[#7c3aed]/30 hover:bg-[#7c3aed]/[0.02] transition"
          >
            {t.pricingTeaserCTA} →
          </Link>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-3xl px-4 sm:px-6 pb-24 sm:pb-32">
        <div className="rounded-3xl bg-gradient-to-br from-[#7c3aed] to-[#6366f1] p-8 sm:p-12 text-center shadow-xl shadow-[#7c3aed]/20">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">{t.finalCTATitle}</h2>
          <p className="mt-3 text-sm text-white/85">{t.finalCTASub}</p>
          <Link
            href="/builder"
            className="mt-6 inline-block rounded-2xl bg-white px-8 py-3.5 text-sm font-semibold text-[#7c3aed] hover:bg-[#fafafa] transition-all shadow-md"
          >
            {t.finalCTABtn}
          </Link>
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
