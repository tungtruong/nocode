"use client";

import { useEffect, useMemo, useState } from "react";

interface AppRow {
  id: string;
  slug: string | null;
  title: string;
  user_email: string;
  created_at: string;
  mode: string | null;
  edit_count: number | null;
}
interface UserRow {
  user_email: string;
  deploys: number;
  projects: number;
}
interface Totals { apps: number; projects: number; users: number }

export default function AdminDomainsPage() {
  const [data, setData] = useState<{ apps: AppRow[]; perUser: UserRow[]; totals: Totals } | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/admin/domains")
      .then((r) => r.json().then((d) => ({ status: r.status, d })))
      .then(({ status, d }) => {
        if (status === 403) setErr("Forbidden — chỉ owner xem được.");
        else if (status >= 400) setErr(d.error || "Lỗi tải dữ liệu");
        else setData(d);
      })
      .catch(() => setErr("Lỗi mạng"));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data.apps;
    return data.apps.filter(
      (a) =>
        (a.slug ?? "").toLowerCase().includes(needle) ||
        a.title.toLowerCase().includes(needle) ||
        a.user_email.toLowerCase().includes(needle) ||
        (a.mode ?? "").toLowerCase().includes(needle)
    );
  }, [data, q]);

  if (err) return <div className="p-8 text-red-600">{err}</div>;
  if (!data) return <div className="p-8 text-gray-500">Đang tải...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Subdomains</h1>
      <p className="text-gray-500 text-sm mb-6">
        Tổng: <strong>{data.totals.apps}</strong> app deploy &nbsp;|&nbsp;
        <strong>{data.totals.projects}</strong> project (incl. drafts) &nbsp;|&nbsp;
        <strong>{data.totals.users}</strong> user.
      </p>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search slug / title / email / mode..."
        className="w-full max-w-md mb-4 px-3 py-2 border border-gray-300 rounded text-sm"
      />

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-gray-300 text-left">
            <th className="p-2">Slug</th>
            <th className="p-2">Title</th>
            <th className="p-2">Owner</th>
            <th className="p-2">Mode</th>
            <th className="p-2 text-right">Edits</th>
            <th className="p-2">Created</th>
            <th className="p-2">URL</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <tr key={a.id} className="border-b border-gray-100">
              <td className="p-2 font-mono text-xs">{a.slug ?? "—"}</td>
              <td className="p-2">{a.title}</td>
              <td className="p-2 text-gray-600 text-xs">{a.user_email}</td>
              <td className="p-2 font-mono text-xs">{a.mode ?? "—"}</td>
              <td className="p-2 text-right">{a.edit_count ?? 0}</td>
              <td className="p-2 text-xs text-gray-500">{new Date(a.created_at).toLocaleString("vi-VN")}</td>
              <td className="p-2">
                {a.slug ? (
                  <a className="text-blue-600 text-xs underline" href={`https://${a.slug}.justvibe.me`} target="_blank" rel="noopener noreferrer">
                    {a.slug}.justvibe.me
                  </a>
                ) : (
                  <a className="text-blue-600 text-xs underline" href={`/apps/${a.id}`} target="_blank" rel="noopener noreferrer">
                    /apps/{a.id.slice(0, 8)}…
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="text-xl font-bold mt-10 mb-3">Per-user totals</h2>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-gray-300 text-left">
            <th className="p-2">User</th>
            <th className="p-2 text-right">Projects (drafts)</th>
            <th className="p-2 text-right">Deploys</th>
          </tr>
        </thead>
        <tbody>
          {data.perUser.map((u) => (
            <tr key={u.user_email} className="border-b border-gray-100">
              <td className="p-2 text-xs">{u.user_email}</td>
              <td className="p-2 text-right">{u.projects}</td>
              <td className="p-2 text-right font-semibold">{u.deploys}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
