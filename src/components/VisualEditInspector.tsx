"use client";

// Side panel shown while Visual Edit mode is active. Receives the currently-
// selected element's metadata (text + computed styles) and exposes a small
// set of inline controls. Each change fires onApply, which postMessages back
// into the preview iframe — no LLM, no server round-trip.

import { useEffect, useState } from "react";

export interface SelectedElement {
  path: number[];
  info: {
    tag: string;
    className: string;
    text: string;
    color: string;
    backgroundColor: string;
    fontSize: string;
    padding: string;
  };
}

export type EditProp = "text" | "color" | "backgroundColor" | "fontSize" | "padding";

export function VisualEditInspector(props: {
  selected: SelectedElement | null;
  onApply: (prop: EditProp, value: string) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [text, setText] = useState("");
  const [color, setColor] = useState("");
  const [bg, setBg] = useState("");
  const [fontSize, setFontSize] = useState("");

  // Sync local state when a new element is selected. queueMicrotask
  // defers the setState batch out of the effect body to satisfy
  // react-hooks/set-state-in-effect — render is unaffected.
  useEffect(() => {
    if (!props.selected) return;
    const info = props.selected.info;
    queueMicrotask(() => {
      setText(info.text || "");
      setColor(normalizeHex(info.color) || "#000000");
      setBg(normalizeHex(info.backgroundColor) || "#ffffff");
      setFontSize(parsePx(info.fontSize));
    });
  }, [props.selected]);

  return (
    <div className="absolute top-0 right-0 bottom-0 w-72 bg-white border-l border-[#e2e8f0] shadow-xl z-30 flex flex-col">
      <div className="border-b border-[#e2e8f0] px-4 py-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[#0f172a]">🎨 Visual edit</h3>
          {props.selected && (
            <p className="text-[10px] text-[#94a3b8] font-mono mt-0.5 truncate max-w-[200px]" title={props.selected.info.className}>
              &lt;{props.selected.info.tag}{props.selected.info.className ? `.${props.selected.info.className.split(" ")[0]}` : ""}&gt;
            </p>
          )}
        </div>
        <button onClick={props.onClose} className="text-[#94a3b8] hover:text-[#0f172a] text-lg leading-none">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!props.selected ? (
          <p className="text-xs text-[#94a3b8] leading-relaxed">
            Hover lên element trong preview — click để chọn. Bạn sẽ sửa được text, màu, font size ngay tại đây mà không tốn quota.
          </p>
        ) : (
          <>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#71717a] font-semibold mb-1.5">Text</label>
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  props.onApply("text", e.target.value);
                }}
                rows={2}
                className="w-full rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5 text-xs resize-none"
                placeholder="(empty)"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#71717a] font-semibold mb-1.5">Màu chữ</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => {
                    setColor(e.target.value);
                    props.onApply("color", e.target.value);
                  }}
                  className="h-9 w-12 rounded-lg border border-[#e2e8f0] cursor-pointer"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => {
                    setColor(e.target.value);
                    if (/^#[0-9a-f]{3,8}$/i.test(e.target.value)) props.onApply("color", e.target.value);
                  }}
                  className="flex-1 rounded-lg border border-[#e2e8f0] bg-white px-2 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#71717a] font-semibold mb-1.5">Màu nền</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={bg}
                  onChange={(e) => {
                    setBg(e.target.value);
                    props.onApply("backgroundColor", e.target.value);
                  }}
                  className="h-9 w-12 rounded-lg border border-[#e2e8f0] cursor-pointer"
                />
                <input
                  type="text"
                  value={bg}
                  onChange={(e) => {
                    setBg(e.target.value);
                    if (/^#[0-9a-f]{3,8}$/i.test(e.target.value)) props.onApply("backgroundColor", e.target.value);
                  }}
                  className="flex-1 rounded-lg border border-[#e2e8f0] bg-white px-2 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#71717a] font-semibold mb-1.5">
                Font size: {fontSize}px
              </label>
              <input
                type="range"
                min="10" max="80" step="1"
                value={fontSize || "16"}
                onChange={(e) => {
                  setFontSize(e.target.value);
                  props.onApply("fontSize", `${e.target.value}px`);
                }}
                className="w-full"
              />
            </div>
          </>
        )}
      </div>

      <div className="border-t border-[#e2e8f0] px-4 py-3 flex gap-2">
        <button
          onClick={props.onClose}
          className="flex-1 rounded-lg border border-[#e2e8f0] bg-white py-2 text-xs font-medium text-[#52525b] hover:bg-[#fafafa]"
        >
          Huỷ
        </button>
        <button
          onClick={props.onSave}
          disabled={props.saving}
          className="flex-1 rounded-lg bg-[#7c3aed] py-2 text-xs font-semibold text-white hover:bg-[#6d28d9] disabled:opacity-50"
        >
          {props.saving ? "Đang lưu..." : "Lưu thay đổi"}
        </button>
      </div>
    </div>
  );
}

function normalizeHex(v: string): string {
  if (!v) return "";
  if (v.startsWith("#")) return v;
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "";
  return "#" + [1, 2, 3].map((i) => parseInt(m[i], 10).toString(16).padStart(2, "0")).join("");
}

function parsePx(v: string): string {
  if (!v) return "16";
  const m = v.match(/([\d.]+)/);
  return m ? String(Math.round(parseFloat(m[1]))) : "16";
}
