"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLang, LangToggle } from "@/components/LangProvider";
import { APP_MODES, type ModeId } from "@/lib/modes";

function chipHref(prompt: string) {
  return `/builder?prompt=${encodeURIComponent(prompt)}`;
}

// Per-mode accent color used on showcase cards. Keeps the page colorful
// without leaning on real product screenshots we don't have yet.
const MODE_COLORS: Record<ModeId, { from: string; to: string; ring: string }> = {
  qr_menu:    { from: "#fb923c", to: "#f97316", ring: "rgba(251,146,60,0.35)" },   // orange
  wedding:    { from: "#f472b6", to: "#ec4899", ring: "rgba(244,114,182,0.35)" },  // pink
  landing:    { from: "#22d3ee", to: "#06b6d4", ring: "rgba(34,211,238,0.35)" },   // cyan
  pitch_deck: { from: "#a78bfa", to: "#8b5cf6", ring: "rgba(167,139,250,0.35)" },  // violet
  cv_resume:  { from: "#34d399", to: "#10b981", ring: "rgba(52,211,153,0.35)" },   // emerald
  web_app:    { from: "#94a3b8", to: "#64748b", ring: "rgba(148,163,184,0.35)" },  // slate
  zalo_mini_app: { from: "#42aaff", to: "#0068ff", ring: "rgba(0,104,255,0.35)" }, // Zalo blue
};

export default function LandingPage() {
  const { t } = useLang();
  const router = useRouter();
  const [prompt, setPrompt] = useState("");

  const submit = () => {
    const v = prompt.trim();
    if (!v) return;
    router.push(chipHref(v));
  };

  const CHIPS = [t.heroChip1, t.heroChip2, t.heroChip3, t.heroChip4];

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
    <div className="min-h-screen bg-[#fafafa] text-[#18181b] overflow-x-hidden">
      {/* NAV — translucent over the hero gradient */}
      <nav className="relative z-10 flex items-center justify-between px-4 sm:px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#a855f7] shadow-md shadow-[#7c3aed]/30">
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight">JustVibe</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <LangToggle />
          <Link href="/pricing" className="text-xs sm:text-sm text-[#52525b] hover:text-[#18181b] transition-colors">{t.pricing}</Link>
          <Link href="/login" className="text-xs sm:text-sm text-[#52525b] hover:text-[#18181b] transition-colors">{t.signin}</Link>
          <Link href="/builder" className="rounded-xl bg-[#18181b] px-4 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-medium text-white hover:bg-[#27272a] transition-all shadow-sm">
            {t.start}
          </Link>
        </div>
      </nav>

      {/* HERO with gradient mesh background + floating orbs */}
      <section className="relative">
        {/* Background mesh — gradient blobs blurred behind the hero. Pointer-
            events:none so it never blocks clicks. */}
        <div className="absolute inset-0 -z-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-32 -left-20 h-[400px] w-[400px] rounded-full bg-gradient-to-br from-[#a855f7] to-[#7c3aed] opacity-20 blur-3xl" />
          <div className="absolute top-40 right-0 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-[#22d3ee] to-[#3b82f6] opacity-20 blur-3xl" />
          <div className="absolute -bottom-40 left-1/3 h-[400px] w-[400px] rounded-full bg-gradient-to-br from-[#fb923c] to-[#f43f5e] opacity-15 blur-3xl" />
          {/* Faint dot grid for texture */}
          <div
            className="absolute inset-0 opacity-[0.15]"
            style={{ backgroundImage: "radial-gradient(#52525b 1px, transparent 1px)", backgroundSize: "24px 24px" }}
          />
        </div>

        <div className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 pt-10 sm:pt-16 pb-14 sm:pb-20 text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#e8e8ec] bg-white/80 backdrop-blur px-3 sm:px-4 py-1.5 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-[#7c3aed] animate-pulse" />
            <span className="text-[11px] sm:text-xs text-[#52525b] font-medium">{t.heroTag}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-[1.1] tracking-tight">
            {t.heroTitle}{" "}
            <span className="bg-gradient-to-r from-[#7c3aed] via-[#a855f7] to-[#3b82f6] bg-clip-text text-transparent">{t.heroHighlight}</span>
          </h1>

          {/* Lovable-style: the input IS the hero CTA. Type → submit →
              builder opens with prompt prefilled. Below: chips fill the
              input on click so "type and go" stays one-click for beginners. */}
          <div className="mt-8 sm:mt-10 mx-auto max-w-2xl">
            <div className="rounded-2xl bg-white shadow-xl shadow-black/5 ring-1 ring-[#e8e8ec] p-2 flex items-center gap-2">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={t.heroInputPlaceholder}
                rows={2}
                className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-[#18181b] placeholder:text-[#94a3b8] focus:outline-none"
                maxLength={500}
              />
              <button
                onClick={submit}
                disabled={!prompt.trim()}
                className="rounded-xl bg-[#18181b] text-white px-5 py-3 text-sm font-semibold hover:bg-[#27272a] disabled:opacity-40 disabled:cursor-not-allowed transition shrink-0"
                aria-label="Submit"
              >
                ↑
              </button>
            </div>

            {/* Chip row directly under input — click fills the input. */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {CHIPS.map((label) => (
                <button
                  key={label}
                  onClick={() => setPrompt(label.replace(/^[^\s]+\s/, ""))}
                  className="rounded-full border border-[#e8e8ec] bg-white/80 backdrop-blur px-3.5 py-1.5 text-xs font-medium text-[#52525b] hover:border-[#7c3aed]/40 hover:bg-[#7c3aed]/[0.06] hover:text-[#7c3aed] transition-all"
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-[#94a3b8]">
              {t.heroDesc}
            </p>
          </div>

          {/* Secondary CTAs sit below — they don't compete with the input. */}
          <div className="mt-8 flex items-center justify-center gap-4 text-xs">
            <Link href="/pricing" className="text-[#71717a] hover:text-[#18181b] transition-colors">
              {t.heroPricing} →
            </Link>
            <span className="text-[#cbd5e1]">·</span>
            <Link href="/login" className="text-[#71717a] hover:text-[#18181b] transition-colors">
              {t.signin}
            </Link>
          </div>
        </div>
      </section>

      {/* MODE SHOWCASE — colorful cards on slate background for contrast */}
      <section className="relative bg-[#0f0f12] text-white">
        <div className="absolute inset-0 opacity-[0.06] pointer-events-none" style={{ backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t.showcaseTitle}</h2>
            <p className="mt-3 text-sm text-white/65 leading-relaxed">{t.showcaseSub}</p>
          </div>
          <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {SHOWCASE.map((s) => {
              const mode = APP_MODES[s.id];
              const color = MODE_COLORS[s.id];
              return (
                <Link
                  key={s.id}
                  href={chipHref(s.samplePrompt)}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur p-5 hover:bg-white/[0.07] hover:border-white/20 transition-all"
                  style={{ "--accent-from": color.from, "--accent-to": color.to } as React.CSSProperties}
                >
                  {/* Accent stripe */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1 transition-all group-hover:h-1.5"
                    style={{ background: `linear-gradient(to right, ${color.from}, ${color.to})` }}
                  />
                  {/* Soft glow on hover */}
                  <div
                    className="absolute -top-12 -right-12 h-32 w-32 rounded-full opacity-0 group-hover:opacity-30 blur-2xl transition-opacity"
                    style={{ background: color.from }}
                  />
                  <div className="relative flex items-center gap-3 mb-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-xl shadow-lg"
                      style={{ background: `linear-gradient(135deg, ${color.from}, ${color.to})`, boxShadow: `0 4px 12px ${color.ring}` }}
                    >
                      {mode.emoji}
                    </div>
                    <h3 className="text-base font-semibold text-white">
                      {t[mode.labelKey]}
                    </h3>
                  </div>
                  <p className="relative text-sm text-white/65 leading-relaxed mb-4">{s.tagline}</p>
                  <div className="relative rounded-lg bg-black/30 border border-white/5 px-3 py-2 text-[11px] text-white/70 font-mono leading-relaxed">
                    &ldquo;{s.samplePrompt}&rdquo;
                  </div>
                  <div className="relative mt-3 text-[11px] font-medium text-white/0 group-hover:text-white/80 transition-colors">
                    → Thử ngay với prompt này
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — light background with numbered cards */}
      <section className="mx-auto max-w-5xl px-4 sm:px-6 py-20 sm:py-28">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t.howTitle}</h2>
          <p className="mt-3 text-sm text-[#52525b]">{t.howSub}</p>
        </div>
        <div className="grid gap-6 sm:gap-8 sm:grid-cols-3 relative">
          {/* Connecting line between cards on desktop */}
          <div className="hidden sm:block absolute top-12 left-[16%] right-[16%] h-px bg-gradient-to-r from-transparent via-[#cbd5e1] to-transparent -z-10" />
          {[
            { idx: 1, title: t.how1Title, desc: t.how1Desc, color: "#7c3aed" },
            { idx: 2, title: t.how2Title, desc: t.how2Desc, color: "#3b82f6" },
            { idx: 3, title: t.how3Title, desc: t.how3Desc, color: "#10b981" },
          ].map((step) => (
            <div key={step.title} className="relative rounded-2xl border border-[#e8e8ec] bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div
                className="absolute -top-4 left-6 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white shadow-md"
                style={{ background: step.color, boxShadow: `0 4px 12px ${step.color}40` }}
              >
                {step.idx}
              </div>
              <h3 className="text-base font-semibold text-[#18181b] mt-2 mb-2">{step.title.replace(/^\d+\.\s*/, "")}</h3>
              <p className="text-sm text-[#52525b] leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING TEASER — subtle gradient strip */}
      <section className="relative mx-4 sm:mx-6 mb-20 sm:mb-28">
        <div className="mx-auto max-w-3xl rounded-3xl border border-[#e8e8ec] bg-gradient-to-br from-white via-[#fafafa] to-[#f4f4f5] px-8 py-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.pricingTeaserTitle}</h2>
          <p className="mt-3 text-sm text-[#52525b]">{t.pricingTeaserSub}</p>
          <div className="mt-6">
            <Link
              href="/pricing"
              className="inline-block rounded-2xl bg-[#18181b] text-white px-6 py-3 text-sm font-medium hover:bg-[#27272a] transition shadow-md"
            >
              {t.pricingTeaserCTA} →
            </Link>
          </div>
        </div>
      </section>

      {/* FINAL CTA — bold gradient banner */}
      <section className="mx-auto max-w-4xl px-4 sm:px-6 pb-24 sm:pb-32">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#7c3aed] via-[#8b5cf6] to-[#6366f1] p-10 sm:p-14 text-center shadow-2xl shadow-[#7c3aed]/30">
          {/* Decorative dots */}
          <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
          <div className="relative">
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white">{t.finalCTATitle}</h2>
            <p className="mt-4 text-sm sm:text-base text-white/90 max-w-md mx-auto">{t.finalCTASub}</p>
            <Link
              href="/builder"
              className="mt-8 inline-block rounded-2xl bg-white px-10 py-4 text-base font-bold text-[#7c3aed] hover:bg-[#fafafa] transition-all shadow-2xl shadow-black/20 hover:scale-105"
            >
              {t.finalCTABtn}
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#e8e8ec] px-6 py-8 text-center">
        <div className="flex items-center justify-center gap-4 text-xs text-[#71717a]">
          <Link href="/rules" className="hover:text-[#18181b] transition-colors">{t.rules}</Link>
          <Link href="/pricing" className="hover:text-[#18181b] transition-colors">{t.pricing}</Link>
        </div>
        <p className="mt-2 text-xs text-[#a1a1aa]">{t.footerTag}</p>
      </footer>
    </div>
  );
}
