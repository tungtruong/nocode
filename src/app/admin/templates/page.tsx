"use client";

import { useEffect, useState } from "react";

interface ModeRow {
  mode: string;
  generates: number; edits: number; deploys: number; placeholder_leaks: number;
  total_flags: number; f_missing: number; f_wrong: number; f_ugly: number; f_other: number;
  projects: number; deployed_projects: number; avg_edits: number;
}
interface FeedbackRow {
  id: number; mode: string; reason: string; note: string | null; created_at: string;
}

export default function AdminTemplatesPage() {
  const [data, setData] = useState<{ modes: ModeRow[]; recentFeedback: FeedbackRow[] } | null>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    fetch("/api/admin/templates")
      .then((r) => r.json().then((d) => ({ status: r.status, d })))
      .then(({ status, d }) => {
        if (status === 403) setErr("Forbidden — chỉ owner xem được trang này.");
        else if (status >= 400) setErr(d.error || "Lỗi tải dữ liệu");
        else setData(d);
      })
      .catch(() => setErr("Lỗi mạng"));
  }, []);

  if (err) return <div className="p-8 text-red-600">{err}</div>;
  if (!data) return <div className="p-8 text-gray-500">Đang tải...</div>;

  const sorted = [...data.modes].sort((a, b) => {
    // Worst-first: highest flags + lowest deploy_rate.
    const aDeploy = a.projects > 0 ? a.deployed_projects / a.projects : 0;
    const bDeploy = b.projects > 0 ? b.deployed_projects / b.projects : 0;
    if (a.total_flags !== b.total_flags) return b.total_flags - a.total_flags;
    return aDeploy - bDeploy;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Template metrics</h1>
      <p className="text-gray-500 text-sm mb-6">Sort: highest flag count, then lowest deploy rate. Click any mode to revise the template / hints in src/lib/modes.ts.</p>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-gray-300 text-left">
            <th className="p-2">Mode</th>
            <th className="p-2 text-right">Projects</th>
            <th className="p-2 text-right">Generates</th>
            <th className="p-2 text-right">Edits</th>
            <th className="p-2 text-right">Deploys</th>
            <th className="p-2 text-right">Deploy %</th>
            <th className="p-2 text-right">Avg edits</th>
            <th className="p-2 text-right">Placeholder leak</th>
            <th className="p-2 text-right">Flags</th>
            <th className="p-2 text-left">Flag breakdown</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const deployPct = r.projects > 0 ? (r.deployed_projects / r.projects * 100).toFixed(0) : "—";
            const leakPct = r.generates > 0 ? (r.placeholder_leaks / r.generates * 100).toFixed(0) + "%" : "—";
            const danger = r.total_flags > 5 || (r.projects > 3 && r.deployed_projects / r.projects < 0.3);
            return (
              <tr key={r.mode} className={`border-b border-gray-100 ${danger ? "bg-red-50" : ""}`}>
                <td className="p-2 font-mono">{r.mode}</td>
                <td className="p-2 text-right">{r.projects}</td>
                <td className="p-2 text-right">{r.generates}</td>
                <td className="p-2 text-right">{r.edits}</td>
                <td className="p-2 text-right">{r.deploys}</td>
                <td className="p-2 text-right">{deployPct === "—" ? "—" : `${deployPct}%`}</td>
                <td className="p-2 text-right">{r.avg_edits.toFixed(1)}</td>
                <td className="p-2 text-right">{r.placeholder_leaks} ({leakPct})</td>
                <td className="p-2 text-right font-semibold">{r.total_flags}</td>
                <td className="p-2 text-xs text-gray-600">
                  {r.total_flags === 0 ? "—" : (
                    <>missing:{r.f_missing} wrong:{r.f_wrong} ugly:{r.f_ugly} other:{r.f_other}</>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 className="text-xl font-bold mt-10 mb-3">Recent feedback ({data.recentFeedback.length})</h2>
      {data.recentFeedback.length === 0 ? (
        <p className="text-gray-500">Chưa có phản hồi nào.</p>
      ) : (
        <ul className="space-y-2">
          {data.recentFeedback.map((f) => (
            <li key={f.id} className="border border-gray-200 rounded p-3 text-sm">
              <div className="flex justify-between text-gray-500 mb-1">
                <span className="font-mono">{f.mode} — {f.reason}</span>
                <span>{new Date(f.created_at).toLocaleString("vi-VN")}</span>
              </div>
              {f.note && <div className="text-gray-800">{f.note}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
