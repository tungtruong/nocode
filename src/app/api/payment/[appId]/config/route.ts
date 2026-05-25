// GET  /api/payment/<appId>/config → { vietqr: VietQrConfig | null }
//   Owner-only: full bank info for dashboard editing.
//
// POST /api/payment/<appId>/config { vietqr: VietQrConfig | null }
//   Owner-only: save (null = remove).

import { NextRequest, NextResponse } from "next/server";
import { requireSession, authError } from "@/lib/auth";
import { userOwnsApp } from "@/lib/app-owner";
import { getVietQrConfig, setVietQrConfig, clearVietQrConfig } from "@/lib/app-settings";
import { findBank } from "@/lib/vietqr";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ appId: string }> }) {
  let session; try { session = await requireSession(); } catch { return authError(); }
  const { appId } = await ctx.params;
  if (!(await userOwnsApp(appId, session.email))) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }
  return NextResponse.json({ vietqr: getVietQrConfig(appId) });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ appId: string }> }) {
  let session; try { session = await requireSession(); } catch { return authError(); }
  const { appId } = await ctx.params;
  if (!(await userOwnsApp(appId, session.email))) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  let body: { vietqr?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "JSON không hợp lệ" }, { status: 400 });
  }

  if (body.vietqr === null) {
    clearVietQrConfig(appId);
    return NextResponse.json({ ok: true });
  }

  if (typeof body.vietqr !== "object" || !body.vietqr) {
    return NextResponse.json({ error: "Thiếu vietqr config" }, { status: 400 });
  }

  const v = body.vietqr as { bankBin?: string; bankCode?: string; accountNo?: string; accountName?: string };
  // Allow either bankBin or bankCode for owner convenience.
  let bin = v.bankBin || "";
  if (!bin && v.bankCode) {
    const b = findBank(v.bankCode);
    if (!b) return NextResponse.json({ error: "Không nhận diện được ngân hàng" }, { status: 400 });
    bin = b.bin;
  }
  if (!bin || !v.accountNo || !v.accountName) {
    return NextResponse.json({ error: "Thiếu bank / STK / tên chủ TK" }, { status: 400 });
  }
  try {
    setVietQrConfig(appId, {
      bankBin: bin,
      accountNo: String(v.accountNo),
      accountName: String(v.accountName),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lưu thất bại" }, { status: 400 });
  }
}
