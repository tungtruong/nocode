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
    margin?: string;
    borderRadius?: string;
    textAlign?: string;
    fontWeight?: string;
    src?: string;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
  };
}

export type EditProp =
  | "text"
  | "color"
  | "backgroundColor"
  | "fontSize"
  | "padding"
  | "margin"
  | "borderRadius"
  | "textAlign"
  | "fontWeight"
  | "src";

export type EditAction = "moveUp" | "moveDown" | "delete" | "duplicate" | "theme";

export function VisualEditInspector(props: {
  selected: SelectedElement | null;
  onApply: (prop: EditProp, value: string) => void;
  onAction: (action: EditAction, value?: string) => void;
  onUploadImage?: (file: File) => Promise<string | null>;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [text, setText] = useState("");
  const [color, setColor] = useState("");
  const [bg, setBg] = useState("");
  const [fontSize, setFontSize] = useState("");
  const [padding, setPadding] = useState("");
  const [borderRadius, setBorderRadius] = useState("");
  const [textAlign, setTextAlign] = useState("");
  const [themeColor, setThemeColor] = useState("#7c3aed");
  const [imgUploading, setImgUploading] = useState(false);

  // Sync local state when a new element is selected.
  useEffect(() => {
    if (!props.selected) return;
    const info = props.selected.info;
    queueMicrotask(() => {
      setText(info.text || "");
      setColor(normalizeHex(info.color) || "#000000");
      setBg(normalizeHex(info.backgroundColor) || "#ffffff");
      setFontSize(parsePx(info.fontSize));
      setPadding(parsePx(info.padding || "0"));
      setBorderRadius(parsePx(info.borderRadius || "0"));
      setTextAlign(info.textAlign || "left");
    });
  }, [props.selected]);

  const isImg = props.selected?.info.tag === "img";

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
        {/* Theme color always available — applies to all primary-color
            elements globally without picking any single one. */}
        <div className="rounded-xl bg-gradient-to-br from-[#faf5ff] to-white border border-[#e9d5ff] p-3">
          <label className="block text-[11px] uppercase tracking-wider text-[#5b21b6] font-semibold mb-1.5">
            🎨 Màu chủ đạo (toàn site)
          </label>
          <div className="flex gap-2">
            <input
              type="color"
              value={themeColor}
              onChange={(e) => {
                setThemeColor(e.target.value);
                props.onAction("theme", e.target.value);
              }}
              className="h-9 w-12 rounded-lg border border-[#e2e8f0] cursor-pointer"
            />
            <input
              type="text"
              value={themeColor}
              onChange={(e) => setThemeColor(e.target.value)}
              onBlur={(e) => /^#[0-9a-f]{3,8}$/i.test(e.target.value) && props.onAction("theme", e.target.value)}
              className="flex-1 rounded-lg border border-[#e2e8f0] bg-white px-2 text-xs font-mono"
            />
          </div>
        </div>

        {!props.selected ? (
          <p className="text-xs text-[#94a3b8] leading-relaxed">
            Hover lên element trong preview — click để chọn. Bạn sẽ sửa text, màu, kích thước, di chuyển + xoá element ngay tại đây — không tốn quota.
          </p>
        ) : (
          <>
            {/* Action bar — most-used: move/duplicate/delete */}
            <div className="flex gap-1 rounded-lg border border-[#e2e8f0] bg-[#fafafa] p-1">
              <button
                onClick={() => props.onAction("moveUp")}
                disabled={!props.selected.info.canMoveUp}
                title="Di chuyển lên"
                className="flex-1 rounded px-2 py-1.5 text-xs hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
              >↑ Lên</button>
              <button
                onClick={() => props.onAction("moveDown")}
                disabled={!props.selected.info.canMoveDown}
                title="Di chuyển xuống"
                className="flex-1 rounded px-2 py-1.5 text-xs hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
              >↓ Xuống</button>
              <button
                onClick={() => props.onAction("duplicate")}
                title="Nhân đôi"
                className="flex-1 rounded px-2 py-1.5 text-xs hover:bg-white"
              >⎘ Sao</button>
              <button
                onClick={() => { if (confirm("Xoá element này?")) props.onAction("delete"); }}
                title="Xoá"
                className="flex-1 rounded px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
              >🗑 Xoá</button>
            </div>

            {/* Image swap — only for <img> */}
            {isImg && (
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#71717a] font-semibold mb-1.5">Ảnh</label>
                {props.selected.info.src && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={props.selected.info.src} alt="" className="w-full h-24 object-cover rounded-lg border border-[#e2e8f0] mb-2" />
                )}
                <label className="block">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={imgUploading || !props.onUploadImage}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f || !props.onUploadImage) return;
                      setImgUploading(true);
                      try {
                        const url = await props.onUploadImage(f);
                        if (url) props.onApply("src", url);
                      } finally {
                        setImgUploading(false);
                      }
                    }}
                  />
                  <span className="block w-full text-center rounded-lg border border-dashed border-[#7c3aed]/40 bg-white px-3 py-2 text-xs text-[#7c3aed] hover:bg-[#f5f3ff] cursor-pointer">
                    {imgUploading ? "Đang upload..." : "📤 Đổi ảnh khác"}
                  </span>
                </label>
              </div>
            )}

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

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#71717a] font-semibold mb-1.5">Màu chữ</label>
                <div className="flex gap-1">
                  <input type="color" value={color}
                    onChange={(e) => { setColor(e.target.value); props.onApply("color", e.target.value); }}
                    className="h-8 w-8 rounded border border-[#e2e8f0] cursor-pointer" />
                  <input type="text" value={color}
                    onChange={(e) => { setColor(e.target.value); if (/^#[0-9a-f]{3,8}$/i.test(e.target.value)) props.onApply("color", e.target.value); }}
                    className="flex-1 min-w-0 rounded border border-[#e2e8f0] bg-white px-1.5 text-[11px] font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#71717a] font-semibold mb-1.5">Màu nền</label>
                <div className="flex gap-1">
                  <input type="color" value={bg}
                    onChange={(e) => { setBg(e.target.value); props.onApply("backgroundColor", e.target.value); }}
                    className="h-8 w-8 rounded border border-[#e2e8f0] cursor-pointer" />
                  <input type="text" value={bg}
                    onChange={(e) => { setBg(e.target.value); if (/^#[0-9a-f]{3,8}$/i.test(e.target.value)) props.onApply("backgroundColor", e.target.value); }}
                    className="flex-1 min-w-0 rounded border border-[#e2e8f0] bg-white px-1.5 text-[11px] font-mono" />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#71717a] font-semibold mb-1.5">Căn lề</label>
              <div className="flex gap-1 rounded-lg border border-[#e2e8f0] bg-white p-1">
                {(["left", "center", "right"] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => { setTextAlign(a); props.onApply("textAlign", a); }}
                    className={`flex-1 rounded px-2 py-1.5 text-xs ${textAlign === a ? "bg-[#7c3aed] text-white" : "hover:bg-[#fafafa]"}`}
                  >
                    {a === "left" ? "⬅" : a === "center" ? "⬌" : "➡"} {a === "left" ? "Trái" : a === "center" ? "Giữa" : "Phải"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#71717a] font-semibold mb-1.5">
                Cỡ chữ: {fontSize}px
              </label>
              <input
                type="range" min="10" max="80" step="1"
                value={fontSize || "16"}
                onChange={(e) => { setFontSize(e.target.value); props.onApply("fontSize", `${e.target.value}px`); }}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#71717a] font-semibold mb-1.5">
                Padding: {padding}px
              </label>
              <input
                type="range" min="0" max="80" step="2"
                value={padding || "0"}
                onChange={(e) => { setPadding(e.target.value); props.onApply("padding", `${e.target.value}px`); }}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#71717a] font-semibold mb-1.5">
                Bo góc: {borderRadius}px
              </label>
              <input
                type="range" min="0" max="64" step="1"
                value={borderRadius || "0"}
                onChange={(e) => { setBorderRadius(e.target.value); props.onApply("borderRadius", `${e.target.value}px`); }}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#71717a] font-semibold mb-1.5">Độ đậm</label>
              <div className="flex gap-1 rounded-lg border border-[#e2e8f0] bg-white p-1">
                {(["400", "500", "600", "700"] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => props.onApply("fontWeight", w)}
                    className={`flex-1 rounded px-2 py-1.5 text-xs hover:bg-[#fafafa]`}
                    style={{ fontWeight: w }}
                  >
                    {w === "400" ? "Aa" : w === "500" ? "Aa" : w === "600" ? "Aa" : "Aa"}
                  </button>
                ))}
              </div>
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
