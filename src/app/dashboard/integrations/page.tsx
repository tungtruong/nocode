"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLang, LangToggle } from "@/components/LangProvider";

interface Integration {
  provider: string;
  account_email: string | null;
  scope: string;
  updated_at: string;
}

interface Binding {
  app_id: string;
  kind: string;
  provider: string;
  config: { spreadsheetId?: string; sheetName?: string };
  updated_at: string;
}

interface SheetSummary {
  spreadsheetId: string;
  title: string;
  url: string;
}

export default function IntegrationsPage() {
  const { t } = useLang();
  const searchParams = useSearchParams();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/integrations");
      if (!r.ok) throw new Error("load failed");
      const d = await r.json();
      setIntegrations(d.integrations || []);
      setBindings(d.bindings || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const err = searchParams.get("error");
    const connected = searchParams.get("connected");
    if (err) queueMicrotask(() => setBanner({ kind: "err", text: `Lỗi: ${err}` }));
    if (connected) queueMicrotask(() => setBanner({ kind: "ok", text: "Đã kết nối Google ✓" }));
  }, [searchParams]);

  const googleIntegration = integrations.find((i) => i.provider === "google_sheets");

  const disconnect = async () => {
    if (!confirm("Ngắt kết nối Google? Các app đang bind sheet sẽ ngừng đọc/ghi.")) return;
    await fetch("/api/integrations?provider=google_sheets", { method: "DELETE" });
    await reload();
    setBanner({ kind: "info", text: "Đã ngắt kết nối" });
  };

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <nav className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto">
        <Link href="/dashboard" className="text-sm text-[#52525b] hover:text-[#18181b]">← Dashboard</Link>
        <LangToggle />
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-6">
        <h1 className="text-2xl font-bold">{t.integrationsTitle}</h1>
        <p className="mt-2 text-sm text-[#52525b]">{t.integrationsSub}</p>

        {/* Data sovereignty explainer — addresses the #1 question new users
            ask: "is this MY sheet or JustVibe's?" Short, scannable, with
            specific concrete points. */}
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-900">
          <div className="flex items-start gap-3">
            <span className="text-base shrink-0">🔒</span>
            <div className="space-y-1.5">
              <p className="font-semibold text-emerald-900">Data của bạn nằm trong Drive của bạn — không phải JustVibe</p>
              <ul className="list-disc pl-4 space-y-0.5 text-emerald-800">
                <li>Sheet bạn chọn nằm trong Google Drive cá nhân — JustVibe không tạo bản copy</li>
                <li>JustVibe chỉ giữ <em>refresh token</em> (mã hoá AES-256) để gọi Sheets API thay bạn khi cần</li>
                <li>Bạn revoke quyền bất cứ lúc nào tại <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="underline hover:text-emerald-700">Google Account → Quyền truy cập</a></li>
                <li>Bỏ JustVibe? Sheet + data vẫn còn nguyên trong Drive của bạn — không có lock-in</li>
                <li>Scope <code className="px-1 bg-emerald-100 rounded">drive.file</code> = JV chỉ thấy file bạn explicitly chọn, KHÔNG thấy toàn bộ Drive</li>
              </ul>
            </div>
          </div>
        </div>

        {banner && (
          <div className={`mt-4 rounded-xl px-4 py-2.5 text-xs ${
            banner.kind === "ok"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
              : banner.kind === "err"
                ? "border border-red-200 bg-red-50 text-red-600"
                : "border border-[#e8e8ec] bg-[#fafafa] text-[#52525b]"
          }`}>
            {banner.text}
          </div>
        )}

        {loading ? (
          <div className="mt-8 text-sm text-[#94a3b8]">Đang tải...</div>
        ) : (
          <section className="mt-6 rounded-2xl border border-[#e8e8ec] bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <svg className="h-8 w-8" viewBox="0 0 48 48" aria-hidden>
                  <path fill="#0F9D58" d="M28.6 12H7.4C6.6 12 6 12.6 6 13.4v21.2c0 .8.6 1.4 1.4 1.4h33.2c.8 0 1.4-.6 1.4-1.4V19l-13.4-7z"/>
                  <path fill="#fff" d="M14 22h20v2H14zm0 4h20v2H14zm0 4h20v2H14zm0 4h13v2H14z"/>
                </svg>
                <div>
                  <h2 className="font-semibold text-[#18181b]">Google Sheets</h2>
                  {googleIntegration ? (
                    <p className="text-xs text-[#52525b]">
                      ✓ {t.integrationsGoogleConnected}
                      {googleIntegration.account_email && (
                        <> · <span className="font-mono">{googleIntegration.account_email}</span></>
                      )}
                    </p>
                  ) : (
                    <p className="text-xs text-[#94a3b8]">{t.integrationsGoogleNotConnected}</p>
                  )}
                </div>
              </div>
              {googleIntegration ? (
                <button onClick={disconnect} className="text-xs text-red-600 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50">
                  {t.integrationsDisconnect}
                </button>
              ) : (
                <a
                  href="/api/integrations/google/connect?returnTo=/dashboard/integrations"
                  title="JustVibe sẽ xin quyền: đọc/ghi sheet bạn chỉ định + tạo file mới (drive.file scope — không thấy toàn bộ Drive)"
                  className="rounded-xl bg-[#18181b] text-white px-4 py-2 text-xs font-medium hover:bg-[#27272a]"
                >
                  {t.integrationsConnectGoogle}
                </a>
              )}
            </div>

            {googleIntegration && (
              <SheetPicker bindings={bindings} reload={reload} />
            )}
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-[#e8e8ec] bg-white p-5">
          <h2 className="font-semibold text-[#18181b]">{t.integrationsAppBindingsTitle}</h2>
          <p className="mt-1 text-xs text-[#52525b]">{t.integrationsAppBindingsSub}</p>
          {bindings.length === 0 ? (
            <p className="mt-4 text-sm text-[#94a3b8]">{t.integrationsNoBindings}</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {bindings.map((b) => (
                <li key={b.app_id} className="flex items-center justify-between rounded-lg border border-[#e8e8ec] bg-[#fafafa] px-3 py-2 text-xs">
                  <span className="font-mono text-[#52525b]">{b.app_id.slice(0, 12)}…</span>
                  <span className="text-[#71717a]">
                    {b.kind === "sheet" ? `📄 ${b.config.sheetName || "Sheet"}` : b.kind}
                  </span>
                  {b.config.spreadsheetId && (
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${b.config.spreadsheetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#7c3aed] hover:underline"
                    >
                      Mở Sheet ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function SheetPicker({ bindings, reload }: { bindings: Binding[]; reload: () => Promise<void> }) {
  const { t } = useLang();
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newHeaders, setNewHeaders] = useState("name, email");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/sheet/list")
      .then((r) => r.json())
      .then((d) => setSheets(d.sheets || []))
      .catch(() => setErr("Không tải được danh sách"))
      .finally(() => setLoadingSheets(false));
  }, []);

  const createNew = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    setErr("");
    try {
      const headers = newHeaders.split(",").map((h) => h.trim()).filter(Boolean);
      const r = await fetch("/api/sheet/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), headers }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Tạo thất bại");
      setSheets((p) => [{ spreadsheetId: d.spreadsheetId, title: newTitle.trim(), url: d.url }, ...p]);
      setNewTitle("");
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mt-5 border-t border-[#f1f5f9] pt-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold text-[#18181b]">
          Sheets trong Drive của bạn ({sheets.length})
        </h3>
        <span className="text-[10px] text-[#94a3b8]" title="Chỉ hiển thị sheet đã được mở/tạo qua JustVibe (drive.file scope)">
          ⓘ chỉ thấy file đã chia sẻ với JV
        </span>
      </div>
      {loadingSheets ? (
        <p className="text-xs text-[#94a3b8]">Đang tải...</p>
      ) : (
        <ul className="space-y-1 max-h-48 overflow-y-auto">
          {sheets.map((s) => (
            <li key={s.spreadsheetId} className="flex items-center justify-between text-xs py-1">
              <span className="text-[#52525b] truncate flex-1 mr-2">📄 {s.title}</span>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[#7c3aed] hover:underline shrink-0">Mở ↗</a>
            </li>
          ))}
          {sheets.length === 0 && (
            <li className="text-xs text-[#94a3b8]">Chưa có sheet nào trong scope — tạo mới bên dưới (sẽ tự động cấp quyền).</li>
          )}
        </ul>
      )}

      <div className="mt-4 rounded-xl border border-[#e8e8ec] bg-[#fafafa] p-3 space-y-2">
        <h4 className="text-xs font-semibold text-[#18181b]">{t.integrationsCreateNew}</h4>
        <p className="text-[11px] text-[#71717a] -mt-1">Sheet sẽ được tạo trong Drive của bạn — JustVibe không giữ bản copy.</p>
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder={t.integrationsNewSheetTitle}
          className="w-full rounded-lg border border-[#e8e8ec] bg-white px-3 py-2 text-xs"
        />
        <input
          type="text"
          value={newHeaders}
          onChange={(e) => setNewHeaders(e.target.value)}
          placeholder={t.integrationsNewSheetHeaders}
          className="w-full rounded-lg border border-[#e8e8ec] bg-white px-3 py-2 text-xs font-mono"
        />
        <button
          onClick={createNew}
          disabled={creating || !newTitle.trim()}
          className="w-full rounded-lg bg-[#18181b] text-white py-2 text-xs font-medium hover:bg-[#27272a] disabled:opacity-50"
        >
          {creating ? "Đang tạo..." : t.integrationsCreateNew}
        </button>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>

      {bindings.length === 0 && (
        <p className="mt-4 text-xs text-[#94a3b8]">
          💡 Để bind sheet với 1 app cụ thể, mở app trong builder rồi bind từ đó (chức năng đang ship tuần 2).
        </p>
      )}
    </div>
  );
}
