"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { LangToggle } from "@/components/LangProvider";

interface Row {
  rowNumber: number;
  fields: Record<string, string>;
}

interface ApiResponse {
  source: "sheet" | "fallback" | "sheet_unreachable";
  sheet?: { spreadsheetId: string; sheetName: string; url: string };
  fallbackCount?: number;
  rows: Row[];
}

interface SheetSummary {
  spreadsheetId: string;
  title: string;
}

export default function FormsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: appId } = use(params);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showBind, setShowBind] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetch(`/api/forms/${appId}`);
      if (!r.ok) throw new Error((await r.json()).error || "Load failed");
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => { queueMicrotask(() => { reload(); }); }, [reload]);

  const exportCsv = () => {
    if (!data?.rows.length) return;
    const headers = Array.from(new Set(data.rows.flatMap((r) => Object.keys(r.fields))));
    const csvLines = [
      headers.join(","),
      ...data.rows.map((r) =>
        headers.map((h) => {
          const v = r.fields[h] || "";
          // Escape CSV: double-up quotes, wrap if contains , " \n.
          if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
          return v;
        }).join(","),
      ),
    ];
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `submissions-${appId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const allHeaders = data?.rows.length
    ? Array.from(new Set(data.rows.flatMap((r) => Object.keys(r.fields))))
    : [];

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <Link href="/dashboard" className="text-sm text-[#52525b] hover:text-[#18181b]">← Dashboard</Link>
        <LangToggle />
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold">Form submissions</h1>
            <p className="text-sm text-[#52525b] mt-1">
              App: <span className="font-mono">{appId.slice(0, 12)}…</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data?.rows.length ? (
              <button onClick={exportCsv} className="text-xs rounded-lg border border-[#e8e8ec] bg-white px-3 py-1.5 hover:bg-[#fafafa]">
                ⬇ Export CSV
              </button>
            ) : null}
            {data?.sheet?.url && (
              <a
                href={data.sheet.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs rounded-lg bg-emerald-600 text-white px-3 py-1.5 hover:bg-emerald-700"
              >
                Mở Google Sheet ↗
              </a>
            )}
            <button
              onClick={() => setShowBind((p) => !p)}
              className="text-xs rounded-lg border border-[#e8e8ec] bg-white px-3 py-1.5 hover:bg-[#fafafa]"
            >
              {data?.source === "sheet" ? "Đổi sheet" : "Bind sheet"}
            </button>
          </div>
        </div>

        {showBind && <BindSheetPanel appId={appId} onDone={() => { setShowBind(false); reload(); }} />}

        {/* Status banner — make data location crystal clear so user knows
            where their leads actually live. Different colors per state. */}
        {data?.source === "fallback" && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <div className="font-semibold mb-1">⚠️ Data đang lưu tạm trong JustVibe — không khuyến khích lâu dài</div>
            <p>Bạn chưa bind Google Sheet cho app này. {data.fallbackCount} submission đang lưu trong DB của JustVibe (giữ tối đa 30 ngày). Bind sheet để chuyển toàn bộ về Drive của bạn.</p>
          </div>
        )}
        {data?.source === "sheet_unreachable" && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            <div className="font-semibold mb-1">❌ Không truy cập được Sheet của bạn</div>
            <p>Có thể do: revoke OAuth tại Google, sheet bị xoá/đổi quyền, hoặc đổi tên tab. Submission mới đang tạm lưu trong JustVibe — kiểm tra Sheet hoặc bind lại.</p>
          </div>
        )}
        {data?.source === "sheet" && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
            <div className="font-semibold mb-1">✓ Data lưu trong Drive của bạn</div>
            <p>
              Mỗi submission được append trực tiếp vào sheet <span className="font-mono">{data.sheet?.sheetName}</span> trong Google Drive của bạn.
              JustVibe không giữ bản copy — bạn xoá sheet là data biến mất hoàn toàn khỏi hệ thống.
            </p>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-[#94a3b8]">Đang tải...</div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        ) : data?.rows.length === 0 ? (
          <div className="rounded-2xl border border-[#e8e8ec] bg-white p-8 text-center text-sm text-[#94a3b8]">
            Chưa có submission nào. Khi user submit form trên app, sẽ hiện ở đây.
          </div>
        ) : (
          <div className="rounded-2xl border border-[#e8e8ec] bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#fafafa] border-b border-[#e8e8ec]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#52525b]">#</th>
                  {allHeaders.map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-[#52525b]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((r) => (
                  <tr key={r.rowNumber} className="border-b border-[#f1f5f9] hover:bg-[#fafafa]">
                    <td className="px-3 py-2 text-xs font-mono text-[#94a3b8]">{r.rowNumber}</td>
                    {allHeaders.map((h) => (
                      <td key={h} className="px-3 py-2 text-xs text-[#18181b] max-w-xs truncate">
                        {r.fields[h] || ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function BindSheetPanel({ appId, onDone }: { appId: string; onDone: () => void }) {
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState("");
  const [sheetName, setSheetName] = useState("Sheet1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [needsConnect, setNeedsConnect] = useState(false);

  useEffect(() => {
    fetch("/api/sheet/list")
      .then((r) => r.json().then((d) => ({ status: r.status, d })))
      .then(({ status, d }) => {
        if (status === 400 && d.code === "NOT_CONNECTED") {
          setNeedsConnect(true);
        } else if (status >= 400) {
          setErr(d.error || "Lỗi");
        } else {
          setSheets(d.sheets || []);
        }
      })
      .catch(() => setErr("Lỗi mạng"))
      .finally(() => setLoading(false));
  }, []);

  const bind = async () => {
    if (!picked) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/sheet/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, spreadsheetId: picked, sheetName }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Bind thất bại");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-[#e8e8ec] bg-white p-4">
      <h3 className="font-semibold text-sm mb-1">Bind sheet cho app này</h3>
      <p className="text-[11px] text-[#71717a] mb-3">
        🔒 Sheet bạn chọn nằm trong Drive cá nhân — JustVibe chỉ append row qua Sheets API. Không copy data sang JV.
      </p>
      {loading ? (
        <p className="text-xs text-[#94a3b8]">Đang tải...</p>
      ) : needsConnect ? (
        <div>
          <p className="text-xs text-[#52525b] mb-3">Cần kết nối Google trước. Sheet bạn chọn sẽ thành nơi lưu submission.</p>
          <a
            href={`/api/integrations/google/connect?returnTo=/dashboard/forms/${appId}`}
            className="inline-block rounded-lg bg-[#18181b] text-white text-xs px-4 py-2 hover:bg-[#27272a]"
          >
            Kết nối Google →
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          <select
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="w-full rounded-lg border border-[#e8e8ec] bg-white px-3 py-2 text-xs"
          >
            <option value="">— chọn sheet (từ Drive của bạn) —</option>
            {sheets.map((s) => (
              <option key={s.spreadsheetId} value={s.spreadsheetId}>{s.title}</option>
            ))}
          </select>
          <input
            type="text"
            value={sheetName}
            onChange={(e) => setSheetName(e.target.value)}
            placeholder="Tên tab (mặc định Sheet1)"
            className="w-full rounded-lg border border-[#e8e8ec] bg-white px-3 py-2 text-xs"
          />
          <p className="text-[11px] text-[#94a3b8]">
            💡 Sheet cần có header ở dòng 1 (tên cột) để form auto-map theo <code>name=</code> của input.
          </p>
          <div className="flex gap-2">
            <button
              onClick={bind}
              disabled={busy || !picked}
              className="rounded-lg bg-[#18181b] text-white text-xs px-4 py-2 disabled:opacity-50 hover:bg-[#27272a]"
            >
              {busy ? "Đang bind..." : "Bind"}
            </button>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
}
