"use client";

// Owner-only data manager. Lets the app's owner add/edit/delete rows in the
// tables their generated app reads through `window.jv.db`. Submissions
// (form-submitted PII) stay on the existing /dashboard/forms/<id> page —
// this one is for editable owner-managed content (products, menu, listings).

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { LangToggle } from "@/components/LangProvider";

interface TableInfo { name: string; count: number }
interface AppRow {
  id: string;
  app_id: string;
  table_name: string;
  row_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface FileItem {
  key: string;
  url: string;
  size_bytes: number;
  mime: string;
  original_name: string | null;
  uploader_uid: string | null;
  created_at: string;
}

export default function DataPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = use(params);
  const [tab, setTab] = useState<"tables" | "files" | "payment" | "domain">("tables");
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [newTableInput, setNewTableInput] = useState("");
  const [rows, setRows] = useState<AppRow[]>([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addJson, setAddJson] = useState('{\n  "name": "",\n  "price": 0\n}');
  const [editing, setEditing] = useState<{ id: string; json: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [quota, setQuota] = useState<{ used: number; cap: number } | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [vietqr, setVietqr] = useState<{ bankBin: string; accountNo: string; accountName: string } | null>(null);
  const [vietqrDraft, setVietqrDraft] = useState({ bankBin: "970436", accountNo: "", accountName: "" });
  const [vietqrSaving, setVietqrSaving] = useState(false);
  const [vietqrSaved, setVietqrSaved] = useState(false);
  const [vietqrVersion, setVietqrVersion] = useState(0);
  const [domains, setDomains] = useState<Array<{ domain: string; verified_at: string | null; created_at: string }>>([]);
  const [domainQuota, setDomainQuota] = useState<{ used: number; cap: number } | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainMsg, setDomainMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadTables = useCallback(async () => {
    setLoadingTables(true);
    setError("");
    try {
      const r = await fetch(`/api/db/${appId}/tables`);
      if (!r.ok) throw new Error((await r.json()).error || "Load failed");
      const d = await r.json();
      setTables(d.tables || []);
      if (d.tables?.length && !selected) {
        const first = d.tables.find((t: TableInfo) => t.name !== "submissions") || d.tables[0];
        setSelected(first.name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setLoadingTables(false);
    }
  }, [appId, selected]);

  const loadRows = useCallback(async (table: string) => {
    if (!table) return;
    setLoadingRows(true);
    setError("");
    try {
      const r = await fetch(`/api/db/${appId}/${encodeURIComponent(table)}/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 200 }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Load failed");
      const d = await r.json();
      setRows(d.rows || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setLoadingRows(false);
    }
  }, [appId]);

  useEffect(() => { queueMicrotask(() => { loadTables(); }); }, [loadTables]);
  useEffect(() => { queueMicrotask(() => { if (selected) loadRows(selected); }); }, [selected, loadRows]);

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    setError("");
    try {
      const r = await fetch(`/api/files/list?app=${encodeURIComponent(appId)}`);
      if (!r.ok) throw new Error((await r.json()).error || "Load failed");
      const d = await r.json();
      setFiles(d.files || []);
      setQuota(d.quota || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setLoadingFiles(false);
    }
  }, [appId]);

  useEffect(() => {
    if (tab === "files") queueMicrotask(() => { loadFiles(); });
  }, [tab, loadFiles]);

  const uploadFiles = async (fileList: FileList | File[]) => {
    setUploading(true);
    setError("");
    const items = Array.from(fileList);
    try {
      for (const file of items) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("appId", appId);
        const r = await fetch("/api/files/upload", { method: "POST", body: fd });
        if (!r.ok) throw new Error((await r.json()).error || `Upload failed: ${file.name}`);
      }
      await loadFiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi upload");
    } finally {
      setUploading(false);
    }
  };

  const deleteFile = async (key: string) => {
    if (!confirm("Xoá file này? Hành động không thể hoàn tác.")) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/files/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Delete failed");
      await loadFiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  };

  const loadVietQr = useCallback(async () => {
    setError("");
    try {
      const r = await fetch(`/api/payment/${appId}/config`);
      if (!r.ok) throw new Error((await r.json()).error || "Load failed");
      const d = await r.json();
      setVietqr(d.vietqr);
      if (d.vietqr) setVietqrDraft(d.vietqr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    }
  }, [appId]);

  useEffect(() => {
    if (tab === "payment") queueMicrotask(() => { loadVietQr(); });
  }, [tab, loadVietQr]);

  const saveVietQr = async () => {
    setVietqrSaving(true);
    setError("");
    setVietqrSaved(false);
    try {
      const accountNo = vietqrDraft.accountNo.replace(/\s/g, "");
      if (!/^\d{6,30}$/.test(accountNo)) throw new Error("STK phải là 6-30 chữ số");
      if (!vietqrDraft.accountName.trim()) throw new Error("Cần tên chủ tài khoản");
      const r = await fetch(`/api/payment/${appId}/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vietqr: { ...vietqrDraft, accountNo } }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Lưu thất bại");
      setVietqr({ ...vietqrDraft, accountNo });
      setVietqrSaved(true);
      setVietqrVersion((v) => v + 1);
      setTimeout(() => setVietqrSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setVietqrSaving(false);
    }
  };

  const removeVietQr = async () => {
    if (!confirm("Xoá cấu hình bank? Sau đó app không tạo được QR.")) return;
    setVietqrSaving(true);
    setError("");
    try {
      const r = await fetch(`/api/payment/${appId}/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vietqr: null }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Xoá thất bại");
      setVietqr(null);
      setVietqrVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setVietqrSaving(false);
    }
  };

  const loadDomains = useCallback(async () => {
    setError("");
    try {
      const r = await fetch(`/api/domains/list?app=${appId}`);
      if (!r.ok) throw new Error((await r.json()).error || "Load failed");
      const d = await r.json();
      setDomains(d.domains || []);
      setDomainQuota(d.quota || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    }
  }, [appId]);

  useEffect(() => {
    if (tab === "domain") queueMicrotask(() => { loadDomains(); });
  }, [tab, loadDomains]);

  const addDomain = async () => {
    const domain = domainInput.trim().toLowerCase();
    if (!domain) return;
    setDomainBusy(true);
    setDomainMsg(null);
    try {
      const r = await fetch("/api/domains/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app: appId, domain }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Add failed");
      setDomainInput("");
      setDomainMsg({ kind: "ok", text: `Đã thêm ${domain}. Tạo CNAME rồi bấm "Verify".` });
      await loadDomains();
    } catch (e) {
      setDomainMsg({ kind: "err", text: e instanceof Error ? e.message : "Lỗi" });
    } finally {
      setDomainBusy(false);
    }
  };

  const verifyDomain = async (domain: string) => {
    setDomainBusy(true);
    setDomainMsg(null);
    try {
      const r = await fetch("/api/domains/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Verify failed");
      setDomainMsg({ kind: "ok", text: `${domain} đã verified ✓ — app đang chạy ở https://${domain}` });
      await loadDomains();
    } catch (e) {
      setDomainMsg({ kind: "err", text: e instanceof Error ? e.message : "Lỗi" });
    } finally {
      setDomainBusy(false);
    }
  };

  const removeDomainAction = async (domain: string) => {
    if (!confirm(`Xoá domain ${domain}?`)) return;
    setDomainBusy(true);
    try {
      const r = await fetch("/api/domains/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Remove failed");
      await loadDomains();
    } catch (e) {
      setDomainMsg({ kind: "err", text: e instanceof Error ? e.message : "Lỗi" });
    } finally {
      setDomainBusy(false);
    }
  };

  const addRow = async () => {
    setBusy(true);
    setError("");
    try {
      const row = JSON.parse(addJson);
      if (typeof row !== "object" || Array.isArray(row) || row === null) {
        throw new Error("JSON phải là object { ... }");
      }
      const table = selected || newTableInput.trim();
      if (!table) throw new Error("Chọn hoặc nhập tên bảng");
      const r = await fetch(`/api/db/${appId}/${encodeURIComponent(table)}/insert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ row }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Insert failed");
      setAddOpen(false);
      setAddJson('{\n  "name": "",\n  "price": 0\n}');
      if (newTableInput && !selected) {
        setSelected(newTableInput.trim());
        setNewTableInput("");
      }
      await loadRows(selected || newTableInput.trim());
      await loadTables();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing || !selected) return;
    setBusy(true);
    setError("");
    try {
      const fields = JSON.parse(editing.json);
      const r = await fetch(`/api/db/${appId}/${encodeURIComponent(selected)}/update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rowId: editing.id, fields }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Update failed");
      setEditing(null);
      await loadRows(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setBusy(false);
    }
  };

  const deleteRow = async (id: string) => {
    if (!selected) return;
    if (!confirm("Xoá row này? Hành động không thể hoàn tác.")) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/db/${appId}/${encodeURIComponent(selected)}/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rowId: id }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Delete failed");
      await loadRows(selected);
      await loadTables();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi");
    } finally {
      setBusy(false);
    }
  };

  const columns = rows.length
    ? Array.from(new Set(rows.flatMap((r) => Object.keys(r.row_data || {})))).slice(0, 8)
    : [];

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <Link href="/dashboard" className="text-sm text-[#52525b] hover:text-[#18181b]">← Dashboard</Link>
        <LangToggle />
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Quản lý dữ liệu</h1>
          <p className="text-sm text-[#52525b] mt-1">
            App: <span className="font-mono">{appId.slice(0, 12)}…</span>
          </p>
        </div>

        <div className="mb-5 flex gap-2 border-b border-[#e8e8ec]">
          <button
            onClick={() => setTab("tables")}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
              tab === "tables" ? "border-[#7c3aed] text-[#7c3aed]" : "border-transparent text-[#71717a] hover:text-[#18181b]"
            }`}
          >
            🗂 Bảng dữ liệu <span className="text-[10px] text-[#94a3b8]">jv.db</span>
          </button>
          <button
            onClick={() => setTab("files")}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
              tab === "files" ? "border-[#7c3aed] text-[#7c3aed]" : "border-transparent text-[#71717a] hover:text-[#18181b]"
            }`}
          >
            📁 File upload <span className="text-[10px] text-[#94a3b8]">jv.files</span>
          </button>
          <button
            onClick={() => setTab("payment")}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
              tab === "payment" ? "border-[#7c3aed] text-[#7c3aed]" : "border-transparent text-[#71717a] hover:text-[#18181b]"
            }`}
          >
            💳 Thanh toán <span className="text-[10px] text-[#94a3b8]">jv.payment</span>
          </button>
          <button
            onClick={() => setTab("domain")}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
              tab === "domain" ? "border-[#7c3aed] text-[#7c3aed]" : "border-transparent text-[#71717a] hover:text-[#18181b]"
            }`}
          >
            🌐 Domain riêng
          </button>
        </div>

        {tab === "tables" && (<>
        <div className="mb-4 rounded-2xl border border-[#e8e8ec] bg-white p-4 flex flex-wrap gap-3 items-center">
          <div className="text-xs font-semibold text-[#52525b]">Bảng:</div>
          {loadingTables ? (
            <div className="text-xs text-[#94a3b8]">Đang tải...</div>
          ) : tables.length === 0 ? (
            <div className="text-xs text-[#94a3b8]">Chưa có bảng nào.</div>
          ) : (
            tables.map((t) => (
              <button
                key={t.name}
                onClick={() => setSelected(t.name)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                  selected === t.name
                    ? "border-[#7c3aed] bg-[#f5f3ff] text-[#7c3aed] font-semibold"
                    : "border-[#e8e8ec] bg-white text-[#52525b] hover:border-[#d4d4d8]"
                }`}
              >
                {t.name} <span className="text-[#94a3b8]">({t.count})</span>
              </button>
            ))
          )}
          <div className="flex items-center gap-2 ml-auto">
            <input
              value={newTableInput}
              onChange={(e) => setNewTableInput(e.target.value.replace(/[^a-z0-9_]/gi, "").toLowerCase())}
              placeholder="bảng mới"
              className="text-xs px-2 py-1.5 rounded-lg border border-[#e8e8ec] w-32"
            />
            <button
              onClick={() => {
                if (!newTableInput.trim()) return;
                setSelected("");
                setAddOpen(true);
              }}
              disabled={!newTableInput.trim()}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-40"
            >
              + Tạo bảng + thêm row
            </button>
            {selected && (
              <button
                onClick={() => setAddOpen(true)}
                className="text-xs px-3 py-1.5 rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9]"
              >
                + Thêm row vào <span className="font-mono">{selected}</span>
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        {selected === "submissions" && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <b>Lưu ý:</b> Bảng <code>submissions</code> là PII (form data người dùng). Không được hiển thị công khai qua <code>jv.db</code>.
            Xem nguyên gốc ở <Link href={`/dashboard/forms/${appId}`} className="underline">/dashboard/forms/{appId.slice(0, 8)}…</Link>.
          </div>
        )}

        {selected && (
          loadingRows ? (
            <div className="text-sm text-[#94a3b8]">Đang tải...</div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-[#e8e8ec] bg-white p-8 text-center text-sm text-[#94a3b8]">
              Bảng <span className="font-mono">{selected}</span> chưa có row nào.
            </div>
          ) : (
            <div className="rounded-2xl border border-[#e8e8ec] bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#fafafa] border-b border-[#e8e8ec]">
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className="px-3 py-2 text-left text-xs font-semibold text-[#52525b]">{c}</th>
                    ))}
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#52525b]">Khi</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-[#52525b]"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-[#f1f5f9] hover:bg-[#fafafa]">
                      {columns.map((c) => (
                        <td key={c} className="px-3 py-2 text-xs text-[#18181b] max-w-xs truncate">
                          {formatValue(r.row_data?.[c])}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-xs text-[#94a3b8] whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString("vi-VN", { hour12: false, dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => setEditing({ id: r.id, json: JSON.stringify(r.row_data, null, 2) })}
                          className="text-xs px-2 py-1 rounded hover:bg-[#f5f3ff] text-[#7c3aed]"
                        >Sửa</button>
                        <button
                          onClick={() => deleteRow(r.id)}
                          className="text-xs px-2 py-1 rounded hover:bg-red-50 text-red-600"
                        >Xoá</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        </>)}

        {tab === "files" && (
        <div>
          {quota && (
            <div className="mb-4 rounded-xl border border-[#e8e8ec] bg-white p-4">
              <div className="flex justify-between text-xs text-[#52525b] mb-2">
                <span>Đã dùng <b>{fmtBytes(quota.used)}</b> / {fmtBytes(quota.cap)}</span>
                <span>{Math.round((quota.used / Math.max(1, quota.cap)) * 100)}%</span>
              </div>
              <div className="h-2 bg-[#f1f5f9] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#7c3aed] transition-all"
                  style={{ width: `${Math.min(100, (quota.used / Math.max(1, quota.cap)) * 100)}%` }}
                />
              </div>
              {quota.used >= quota.cap * 0.9 && (
                <p className="text-xs text-amber-700 mt-2">
                  ⚠ Sắp hết quota — nâng cấp gói hoặc xoá bớt file.
                </p>
              )}
            </div>
          )}

          <label
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
            }}
            className={`block mb-4 rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition ${
              dragActive ? "border-[#7c3aed] bg-[#f5f3ff]" : "border-[#e8e8ec] bg-white hover:border-[#d4d4d8]"
            }`}
          >
            <input
              type="file"
              multiple
              className="hidden"
              accept="image/*,application/pdf,audio/*,video/*,.csv,.txt"
              onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); }}
              disabled={uploading}
            />
            <div className="text-3xl mb-2">📤</div>
            <div className="text-sm font-medium text-[#18181b]">
              {uploading ? "Đang upload..." : "Kéo thả hoặc bấm để chọn file"}
            </div>
            <div className="text-xs text-[#94a3b8] mt-1">
              Ảnh (≤10MB) · PDF (≤20MB) · Audio (≤20MB) · Video (≤50MB)
            </div>
          </label>

          {loadingFiles ? (
            <div className="text-sm text-[#94a3b8]">Đang tải...</div>
          ) : files.length === 0 ? (
            <div className="rounded-2xl border border-[#e8e8ec] bg-white p-8 text-center text-sm text-[#94a3b8]">
              Chưa có file nào.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {files.map((f) => (
                <div key={f.key} className="rounded-xl border border-[#e8e8ec] bg-white overflow-hidden flex flex-col">
                  <div className="aspect-square bg-[#fafafa] flex items-center justify-center overflow-hidden">
                    {f.mime.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-4xl">
                        {f.mime.startsWith("video/") ? "🎬" : f.mime.startsWith("audio/") ? "🎵" : f.mime === "application/pdf" ? "📄" : "📦"}
                      </div>
                    )}
                  </div>
                  <div className="p-2 flex flex-col gap-1 flex-1">
                    <div className="text-[11px] truncate" title={f.original_name || f.key}>
                      {f.original_name || f.key.split("/").pop()}
                    </div>
                    <div className="text-[10px] text-[#94a3b8]">{fmtBytes(f.size_bytes)}</div>
                    <div className="flex gap-1 mt-auto">
                      <button
                        onClick={() => copyUrl(f.url)}
                        className="flex-1 text-[11px] px-2 py-1 rounded hover:bg-[#f5f3ff] text-[#7c3aed]"
                      >{copied === f.url ? "Đã copy ✓" : "Copy URL"}</button>
                      <button
                        onClick={() => deleteFile(f.key)}
                        disabled={busy}
                        className="text-[11px] px-2 py-1 rounded hover:bg-red-50 text-red-600 disabled:opacity-40"
                      >Xoá</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {tab === "payment" && (
        <div className="grid md:grid-cols-2 gap-5">
          <div className="rounded-2xl border border-[#e8e8ec] bg-white p-5">
            <h3 className="text-base font-semibold mb-1">Cấu hình VietQR</h3>
            <p className="text-xs text-[#52525b] mb-4">
              App của bạn sẽ tạo QR chuyển khoản về tài khoản này. Người dùng mở app banking → quét → chuyển khoản trực tiếp, không tốn phí.
            </p>

            <label className="block text-xs font-semibold text-[#52525b] mb-1">Ngân hàng</label>
            <select
              value={vietqrDraft.bankBin}
              onChange={(e) => setVietqrDraft({ ...vietqrDraft, bankBin: e.target.value })}
              className="w-full text-sm px-3 py-2 mb-3 rounded-lg border border-[#e8e8ec] bg-white"
            >
              {VN_BANKS_OPTIONS.map((b) => (
                <option key={b.bin} value={b.bin}>{b.name} ({b.code})</option>
              ))}
            </select>

            <label className="block text-xs font-semibold text-[#52525b] mb-1">Số tài khoản</label>
            <input
              type="text"
              inputMode="numeric"
              value={vietqrDraft.accountNo}
              onChange={(e) => setVietqrDraft({ ...vietqrDraft, accountNo: e.target.value.replace(/\D/g, "") })}
              placeholder="1031234567"
              className="w-full text-sm px-3 py-2 mb-3 rounded-lg border border-[#e8e8ec]"
            />

            <label className="block text-xs font-semibold text-[#52525b] mb-1">Tên chủ TK (không dấu)</label>
            <input
              type="text"
              value={vietqrDraft.accountName}
              onChange={(e) => setVietqrDraft({ ...vietqrDraft, accountName: e.target.value })}
              placeholder="NGUYEN VAN A"
              className="w-full text-sm px-3 py-2 mb-4 rounded-lg border border-[#e8e8ec]"
            />

            <div className="flex gap-2">
              <button
                onClick={saveVietQr}
                disabled={vietqrSaving}
                className="text-xs px-3 py-1.5 rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-40"
              >
                {vietqrSaving ? "Đang lưu..." : vietqrSaved ? "Đã lưu ✓" : "Lưu cấu hình"}
              </button>
              {vietqr && (
                <button
                  onClick={removeVietQr}
                  disabled={vietqrSaving}
                  className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40"
                >
                  Xoá cấu hình
                </button>
              )}
            </div>

            <p className="text-[11px] text-[#94a3b8] mt-4">
              ⚠ STK + tên hiển thị công khai trên QR — tự thân app banking xem được. Đừng dùng STK lương / tiết kiệm chính.
            </p>
          </div>

          <div className="rounded-2xl border border-[#e8e8ec] bg-white p-5">
            <h3 className="text-base font-semibold mb-1">Preview QR</h3>
            <p className="text-xs text-[#52525b] mb-4">
              {vietqr ? "Quét bằng app banking để test." : "Lưu cấu hình bên trái để xem preview."}
            </p>
            {vietqr ? (
              <div className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/payment/${appId}/vietqr?amount=10000&description=Test%20JV&_v=${vietqrVersion}`}
                  alt="VietQR preview"
                  className="mx-auto w-64 h-64 bg-white border border-[#e8e8ec] rounded-xl"
                />
                <p className="text-xs text-[#52525b] mt-3">
                  Test 10.000₫ · &quot;Test JV&quot;
                </p>
                <code className="block text-[10px] text-[#94a3b8] mt-4 break-all bg-[#fafafa] p-2 rounded">
                  jv.payment.vietqr({"{"} amount: 250000, description: &apos;Dat ban&apos; {"}"})
                </code>
              </div>
            ) : (
              <div className="text-center py-12 text-sm text-[#94a3b8]">Chưa có cấu hình.</div>
            )}
          </div>
        </div>
        )}

        {tab === "domain" && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-[#e8e8ec] bg-white p-5">
            <h3 className="text-base font-semibold mb-1">Domain riêng cho app</h3>
            <p className="text-xs text-[#52525b] mb-4">
              Trỏ domain của bạn (vd <code>shop.example.com</code>) về app này — khách thấy URL riêng thay vì <code>{appId.slice(0, 8)}…justvibe.me</code>.
            </p>

            {domainQuota && (
              <div className="mb-4 text-xs text-[#52525b] flex items-center gap-2">
                <span>Đã dùng <b>{domainQuota.used}/{domainQuota.cap}</b> domain</span>
                {domainQuota.used >= domainQuota.cap && (
                  <span className="text-amber-700">— hết quota, nâng cấp gói để thêm.</span>
                )}
              </div>
            )}

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))}
                placeholder="shop.example.com"
                className="flex-1 text-sm px-3 py-2 rounded-lg border border-[#e8e8ec]"
                onKeyDown={(e) => { if (e.key === "Enter" && !domainBusy) addDomain(); }}
              />
              <button
                onClick={addDomain}
                disabled={domainBusy || !domainInput.trim() || (domainQuota ? domainQuota.used >= domainQuota.cap : false)}
                className="text-sm px-4 py-2 rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-40"
              >
                Thêm
              </button>
            </div>

            {domainMsg && (
              <div className={`text-xs px-3 py-2 rounded-lg mb-3 ${
                domainMsg.kind === "ok" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"
              }`}>{domainMsg.text}</div>
            )}

            <div className="space-y-3">
              {domains.length === 0 ? (
                <div className="text-xs text-[#94a3b8] text-center py-6">Chưa có domain nào.</div>
              ) : domains.map((d) => (
                <div key={d.domain} className="rounded-xl border border-[#e8e8ec] bg-[#fafafa] p-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="font-mono text-sm font-medium">{d.domain}</div>
                      <div className="text-xs mt-0.5">
                        {d.verified_at ? (
                          <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">
                            ✓ Verified · Mở https://{d.domain}
                          </a>
                        ) : (
                          <span className="text-amber-700">⏳ Đợi verify DNS</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {!d.verified_at && (
                        <button
                          onClick={() => verifyDomain(d.domain)}
                          disabled={domainBusy}
                          className="text-xs px-2.5 py-1 rounded border border-[#7c3aed] text-[#7c3aed] hover:bg-[#f5f3ff] disabled:opacity-40"
                        >Verify</button>
                      )}
                      <button
                        onClick={() => removeDomainAction(d.domain)}
                        disabled={domainBusy}
                        className="text-xs px-2.5 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40"
                      >Xoá</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#e8e8ec] bg-[#fafafa] p-5 text-xs text-[#52525b] space-y-2">
            <h4 className="text-sm font-semibold text-[#18181b]">Hướng dẫn DNS</h4>
            <p>
              <b>1.</b> Login vào nhà cung cấp DNS (Cloudflare / domain registrar). Thêm CNAME record:
            </p>
            <pre className="bg-white border border-[#e8e8ec] rounded p-2 font-mono text-[11px] overflow-x-auto">
{`Type:   CNAME
Name:   shop  (hoặc subdomain bạn muốn)
Target: ${appId.slice(0, 8)}.justvibe.me  (slug app của bạn)
Proxy:  ON (orange cloud — bắt buộc cho HTTPS miễn phí)`}
            </pre>
            <p>
              <b>2.</b> Đợi 1-5 phút để DNS propagate. Bấm <b>Verify</b> ở trên — JV check CNAME và bật routing.
            </p>
            <p>
              <b>3.</b> <b>Quan trọng</b>: phải bật proxy Cloudflare (orange cloud) để có SSL/HTTPS tự động.
              Không có CF? Thử <a href="https://www.cloudflare.com/" className="underline text-[#7c3aed]" target="_blank" rel="noopener noreferrer">cloudflare.com</a> miễn phí.
            </p>
            <p className="text-amber-700">
              ⚠ Apex domain (vd <code>example.com</code> không có subdomain) hiện chưa support — dùng subdomain.
            </p>
          </div>
        </div>
        )}

        {addOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setAddOpen(false)}>
            <div className="bg-white rounded-2xl p-5 w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-semibold mb-1">
                Thêm row vào <span className="font-mono">{selected || newTableInput}</span>
              </h3>
              <p className="text-xs text-[#94a3b8] mb-3">JSON object — key/value tự do.</p>
              <textarea
                value={addJson}
                onChange={(e) => setAddJson(e.target.value)}
                rows={10}
                className="w-full text-xs font-mono p-3 rounded-lg border border-[#e8e8ec] focus:border-[#7c3aed] outline-none"
              />
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => setAddOpen(false)} className="text-xs px-3 py-1.5 rounded-lg border border-[#e8e8ec] hover:bg-[#fafafa]">Huỷ</button>
                <button onClick={addRow} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-40">
                  {busy ? "Đang lưu..." : "Lưu"}
                </button>
              </div>
            </div>
          </div>
        )}

        {editing && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
            <div className="bg-white rounded-2xl p-5 w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-semibold mb-3">Sửa row</h3>
              <textarea
                value={editing.json}
                onChange={(e) => setEditing({ ...editing, json: e.target.value })}
                rows={12}
                className="w-full text-xs font-mono p-3 rounded-lg border border-[#e8e8ec] focus:border-[#7c3aed] outline-none"
              />
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => setEditing(null)} className="text-xs px-3 py-1.5 rounded-lg border border-[#e8e8ec] hover:bg-[#fafafa]">Huỷ</button>
                <button onClick={saveEdit} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-40">
                  {busy ? "Đang lưu..." : "Lưu"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Bank options for the payment-config dropdown. Mirrors the top of
// VN_BANKS in src/lib/vietqr.ts; kept local so this client component
// doesn't pull a server-only module. Add a new bank in BOTH places.
const VN_BANKS_OPTIONS = [
  { bin: "970436", code: "VCB",        name: "Vietcombank" },
  { bin: "970418", code: "BIDV",       name: "BIDV" },
  { bin: "970415", code: "VietinBank", name: "VietinBank" },
  { bin: "970405", code: "Agribank",   name: "Agribank" },
  { bin: "970422", code: "MB",         name: "MB Bank" },
  { bin: "970407", code: "Techcombank",name: "Techcombank" },
  { bin: "970432", code: "VPBank",     name: "VPBank" },
  { bin: "970423", code: "TPBank",     name: "TPBank" },
  { bin: "970437", code: "HDBank",     name: "HDBank" },
  { bin: "970448", code: "OCB",        name: "OCB" },
  { bin: "970426", code: "MSB",        name: "MSB (Maritime)" },
  { bin: "970441", code: "VIB",        name: "VIB" },
  { bin: "970428", code: "NamABank",   name: "Nam A Bank" },
  { bin: "970424", code: "ShinhanBank",name: "Shinhan Bank" },
  { bin: "970452", code: "KienlongBank", name: "Kien Long Bank" },
  { bin: "970440", code: "SeABank",    name: "SeABank" },
  { bin: "970409", code: "BacABank",   name: "Bac A Bank" },
  { bin: "970412", code: "PVcomBank",  name: "PVcomBank" },
  { bin: "970433", code: "VietBank",   name: "VietBank" },
  { bin: "970431", code: "Eximbank",   name: "Eximbank" },
  { bin: "970449", code: "LPB",        name: "LPBank" },
  { bin: "970406", code: "DongABank",  name: "DongA Bank" },
  { bin: "970429", code: "SCB",        name: "SCB (Saigon)" },
];
