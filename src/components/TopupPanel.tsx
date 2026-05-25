"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/LangProvider";

interface Pack {
  id: string;
  tokens: number;
  priceUsd: number;
  label: string;
}

// Panel that lists topup packs + handles the buy flow. Embedded in /dashboard
// and in the QuotaExceeded modal. `tierAllowed` is true for Pro/Max users —
// when false we show an upgrade nudge instead of the buy buttons.
export function TopupPanel({ tierAllowed }: { tierAllowed: boolean }) {
  const { t } = useLang();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/topup/packs")
      .then((r) => r.json())
      .then((d) => setPacks(d.packs || []))
      .catch(() => {});
  }, []);

  const buy = async (packId: string) => {
    setErr("");
    setBusy(packId);
    try {
      const r = await fetch("/api/topup/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const d = await r.json();
      if (!r.ok || !d.approvalUrl) throw new Error(d.error || t.topupErrorGeneric);
      window.location.assign(d.approvalUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.topupErrorGeneric);
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-[#e8e8ec] bg-white p-5">
      <h3 className="text-sm font-semibold text-[#18181b]">{t.topupTitle}</h3>
      <p className="mt-1 text-xs text-[#71717a]">{t.topupSubtitle}</p>

      {err && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{err}</div>
      )}

      {!tierAllowed ? (
        <div className="mt-4 rounded-lg border border-[#7c3aed]/20 bg-[#7c3aed]/[0.04] px-3 py-2.5 text-xs text-[#7c3aed]">
          {t.topupTierBlocked}
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {packs.map((p) => {
              const isBusy = busy === p.id;
              return (
                <div key={p.id} className="rounded-xl border border-[#e8e8ec] bg-[#fafafa] p-4">
                  <div className="text-xs uppercase tracking-wider text-[#94a3b8]">{p.label}</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-[#18181b]">${p.priceUsd}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-[#71717a]">
                    +{(p.tokens / 1_000_000).toLocaleString("en-US")}M token
                  </div>
                  <button
                    onClick={() => buy(p.id)}
                    disabled={isBusy || !!busy}
                    className="mt-3 w-full rounded-lg bg-[#7c3aed] py-2 text-sm font-medium text-white hover:bg-[#6d28d9] disabled:opacity-60 disabled:cursor-wait transition"
                  >
                    {isBusy ? t.topupProcessing : t.topupBtn}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] text-[#94a3b8]">{t.topupNote}</p>
        </>
      )}
    </div>
  );
}
