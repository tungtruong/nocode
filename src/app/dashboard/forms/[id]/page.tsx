"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { LangToggle } from "@/components/LangProvider";

interface Row {
  rowNumber: number | string;
  fields: Record<string, string>;
}

interface ApiResponse {
  source: "supabase" | "supabase_unreachable" | "fallback";
  fallbackCount?: number;
  rows: Row[];
}

export default function FormsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: appId } = use(params);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    // Filter out internal `_*` columns from CSV export (they're meta, not user-facing).
    const headers = Array.from(
      new Set(data.rows.flatMap((r) => Object.keys(r.fields).filter((k) => !k.startsWith("_")))),
    );
    headers.push("_created_at");
    const csvLines = [
      headers.join(","),
      ...data.rows.map((r) =>
        headers.map((h) => {
          const v = r.fields[h] || "";
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

  const visibleHeaders = data?.rows.length
    ? Array.from(
        new Set(data.rows.flatMap((r) => Object.keys(r.fields).filter((k) => !k.startsWith("_")))),
      )
    : [];

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <Link href="/dashboard" className="text-sm text-[#52525b] hover:text-[#18181b]">← Dashboard</Link>
        <LangToggle />
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Form submissions</h1>
            <p className="text-sm text-[#52525b] mt-1">
              App: <span className="font-mono">{appId.slice(0, 12)}…</span>
            </p>
          </div>
          {data?.rows.length ? (
            <button onClick={exportCsv} className="text-xs rounded-lg border border-[#e8e8ec] bg-white px-3 py-1.5 hover:bg-[#fafafa]">
              ⬇ Export CSV
            </button>
          ) : null}
        </div>

        {/* Status banner — make storage state visible. With Supabase always
            on, this mostly stays in the green path. */}
        {data?.source === "supabase_unreachable" && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            <div className="font-semibold mb-1">❌ Không kết nối được DB</div>
            <p>Submission mới đang lưu tạm trong JustVibe — sẽ tự đồng bộ khi DB phục hồi.</p>
          </div>
        )}
        {data?.source === "supabase" && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
            ✓ Submission được lưu trực tiếp vào database — sẵn sàng truy vấn, export bất cứ lúc nào.
          </div>
        )}
        {data?.source === "fallback" && data.fallbackCount && data.fallbackCount > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <div className="font-semibold mb-1">⚠️ DB chưa cấu hình — đang dùng storage tạm</div>
            <p>{data.fallbackCount} submission đang lưu trong fallback storage. Báo dev cấu hình SUPABASE_URL + SUPABASE_SERVICE_KEY.</p>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-[#94a3b8]">Đang tải...</div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        ) : data?.rows.length === 0 ? (
          <div className="rounded-2xl border border-[#e8e8ec] bg-white p-8 text-center text-sm text-[#94a3b8]">
            Chưa có submission nào. Khi user submit form trên app, sẽ hiện ở đây tự động.
          </div>
        ) : (
          <div className="rounded-2xl border border-[#e8e8ec] bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#fafafa] border-b border-[#e8e8ec]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#52525b]">Khi</th>
                  {visibleHeaders.map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-[#52525b]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((r) => (
                  <tr key={String(r.rowNumber)} className="border-b border-[#f1f5f9] hover:bg-[#fafafa]">
                    <td className="px-3 py-2 text-xs text-[#94a3b8] whitespace-nowrap">
                      {r.fields._created_at
                        ? new Date(r.fields._created_at).toLocaleString("vi-VN", {
                            hour12: false, dateStyle: "short", timeStyle: "short",
                          })
                        : "—"}
                    </td>
                    {visibleHeaders.map((h) => (
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
