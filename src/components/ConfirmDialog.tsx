"use client";

import { useEffect, useRef } from "react";
import { useLang } from "@/components/LangProvider";

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useLang();
  const confirmBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/40 backdrop-blur-sm px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-2xl shadow-black/10">
        {title && (
          <h2 id="confirm-title" className="text-base font-semibold text-[#0f172a] mb-1.5">
            {title}
          </h2>
        )}
        <p id="confirm-message" className="text-sm text-[#475569] leading-relaxed">
          {message}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-2 text-sm font-medium text-[#475569] hover:bg-[#f8fafc] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/30 transition-colors"
          >
            {cancelLabel ?? t.dialogCancel ?? "Hủy"}
          </button>
          <button
            ref={confirmBtn}
            type="button"
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors ${
              destructive
                ? "bg-red-600 hover:bg-red-700 shadow-red-600/20 focus-visible:ring-red-600/40"
                : "bg-[#7c3aed] hover:bg-[#6d28d9] shadow-[#7c3aed]/20 focus-visible:ring-[#7c3aed]/40"
            }`}
          >
            {confirmLabel ?? t.dialogConfirm ?? "Đồng ý"}
          </button>
        </div>
      </div>
    </div>
  );
}
