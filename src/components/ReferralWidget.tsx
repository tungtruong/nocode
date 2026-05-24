"use client";

import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/components/LangProvider";

interface Stats {
  code: string;
  totalReferred: number;
  paidReferred: number;
  pendingCents: number;
  paidCents: number;
  currency: string;
  recent: Array<{ referredEmail: string; amountCents: number; currency: string; status: string; createdAt: string }>;
}

function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100);
}

// Mask the referred user's email so the referrer sees who signed up without
// exposing the full address (privacy + anti-scraping).
function maskEmail(e: string): string {
  const [u, d] = e.split("@");
  if (!u || !d) return e;
  const head = u.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
}

export function ReferralWidget() {
  const { t } = useLang();
  const [stats, setStats] = useState<Stats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/referrals/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.code) setStats(d); })
      .catch(() => {});
  }, []);

  // Derive the share link from the stats — no need for an effect just to
  // string-concat. window.location is only available client-side, hence the
  // typeof check (SSR pass returns empty).
  const shareUrl = useMemo(
    () => (stats?.code && typeof window !== "undefined"
      ? `${window.location.origin}/signup?ref=${stats.code}`
      : ""),
    [stats?.code]
  );

  const copyLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (!stats) return null;

  return (
    <div className="rounded-2xl border border-[#e8e8ec] bg-white p-5 sm:p-6 mb-8">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-[#18181b]">{t.refTitle}</h2>
          <p className="text-xs text-[#64748b] mt-0.5">{t.refDesc}</p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-medium">
          {t.refCommissionLabel}: 30%
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label={t.refStatTotal} value={stats.totalReferred.toString()} />
        <Stat label={t.refStatPaying} value={stats.paidReferred.toString()} />
        <Stat label={t.refStatEarned} value={formatMoney(stats.pendingCents + stats.paidCents, stats.currency)} />
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2">
        <input
          readOnly
          value={shareUrl}
          onClick={(e) => (e.target as HTMLInputElement).select()}
          className="flex-1 bg-transparent text-xs text-[#334155] truncate focus:outline-none"
        />
        <button
          onClick={copyLink}
          className="shrink-0 rounded-lg bg-[#7c3aed] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#6d28d9] transition-colors"
        >
          {copied ? t.dashCopied : t.refCopyLink}
        </button>
      </div>

      <p className="mt-2 text-[10px] text-[#94a3b8]">
        {t.refCodePrefix}: <span className="font-mono font-medium text-[#64748b]">{stats.code}</span>
      </p>

      {stats.recent.length > 0 && (
        <div className="mt-4 border-t border-[#f1f5f9] pt-3">
          <p className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-medium mb-2">{t.refRecentLabel}</p>
          <div className="space-y-1.5">
            {stats.recent.slice(0, 5).map((r) => (
              <div key={r.createdAt + r.referredEmail} className="flex items-center justify-between text-xs">
                <span className="text-[#475569]">{maskEmail(r.referredEmail)}</span>
                <span className="flex items-center gap-2">
                  <span className="font-medium text-[#18181b]">{formatMoney(r.amountCents, r.currency)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {r.status === "paid" ? t.refStatusPaid : t.refStatusPending}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-medium">{label}</div>
      <div className="text-lg font-semibold text-[#0f172a] tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
