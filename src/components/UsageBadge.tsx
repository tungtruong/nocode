"use client";

import { useEffect, useState, useCallback } from "react";
import { useLang } from "@/components/LangProvider";

interface UsageInfo {
  used: number;
  quota: number;
  tier: string;
  period: string;
  remaining: number;
  pctUsed: number;
  unlimited?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "K";
  return String(n);
}

export function UsageBadge({ refreshKey }: { refreshKey?: number }) {
  const { t } = useLang();
  const [info, setInfo] = useState<UsageInfo | null>(null);

  const fetchUsage = useCallback(() => {
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.used === "number") setInfo(d); })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchUsage(); }, [fetchUsage, refreshKey]);
  // Refresh after any user-visible AI activity might have updated the count.
  useEffect(() => {
    const i = setInterval(fetchUsage, 30_000);
    return () => clearInterval(i);
  }, [fetchUsage]);

  if (!info) return null;

  const pct = info.pctUsed;
  // Tone: green <70%, amber 70-89%, red ≥90%. Unlimited dev mode → always green.
  const tone = info.unlimited
    ? { bar: "bg-emerald-500", text: "text-emerald-700", ring: "border-emerald-200 bg-emerald-50" }
    : pct >= 90 ? { bar: "bg-red-500", text: "text-red-700", ring: "border-red-200 bg-red-50" } :
      pct >= 70 ? { bar: "bg-amber-500", text: "text-amber-700", ring: "border-amber-200 bg-amber-50" } :
      { bar: "bg-[#7c3aed]", text: "text-[#64748b]", ring: "border-[#e2e8f0] bg-white" };

  const tierLabel = info.unlimited ? "DEV" : info.tier === "pro" ? "Pro" : info.tier === "team" ? "Team" : t.planFree as string;

  return (
    <div
      className={`flex items-center gap-1.5 sm:gap-2 rounded-full border ${tone.ring} pl-2 sm:pl-2.5 pr-2.5 sm:pr-3 py-1`}
      title={info.unlimited
        ? `DEV mode (UNLIMITED_QUOTA=true) · ${info.used.toLocaleString()} ${t.quotaTokens} ${t.quotaUsed}`
        : `${t.quotaTier}: ${tierLabel} · ${info.used.toLocaleString()} / ${info.quota.toLocaleString()} ${t.quotaTokens} · ${t.quotaResetMonthly}`}
    >
      <span className={`hidden sm:inline text-[10px] font-medium uppercase tracking-wider ${tone.text}`}>{tierLabel}</span>
      {info.unlimited ? (
        <span className={`text-[10px] sm:text-[11px] tabular-nums ${tone.text}`}>
          {formatTokens(info.used)} <span className="opacity-60">/ ∞</span>
        </span>
      ) : (
        <>
          <span className="relative h-1.5 w-12 sm:w-16 rounded-full bg-[#f1f5f9] overflow-hidden">
            <span className={`absolute inset-y-0 left-0 ${tone.bar} transition-all duration-300`} style={{ width: `${Math.max(2, pct)}%` }} />
          </span>
          <span className={`text-[10px] sm:text-[11px] tabular-nums ${tone.text}`}>
            {formatTokens(info.used)}<span className="opacity-50">/{formatTokens(info.quota)}</span>
          </span>
        </>
      )}
    </div>
  );
}
