// GET /api/payment/<appId>/vietqr?amount=&description=&format=svg|json
//
// PUBLIC endpoint — generated apps fetch the QR for the owner's saved bank
// every time the user opens the payment screen. No external API call; the
// QR is built locally from the EMV/Napas spec in src/lib/vietqr.ts and
// rendered into an SVG using the `qrcode` npm package.
//
// Caching: response varies on (amount, description, account). Same inputs =
// same QR forever, so we set a long cache-control. The owner can rotate
// their bank info from the dashboard; the URL stays the same but the
// content changes — to defeat stale caches, we also vary the cache by
// updating `_v` query param when the owner saves (handled client-side
// via the runtime helper).

import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { ownerOfApp } from "@/lib/app-owner";
import { getVietQrConfig } from "@/lib/app-settings";
import { buildVietQr, findBank } from "@/lib/vietqr";
import { checkRateLimit } from "@/lib/security";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Cache-Control": "public, max-age=300", // 5 min — short enough to react to bank rotation
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ appId: string }> },
) {
  const { appId } = await ctx.params;
  const owner = await ownerOfApp(appId);
  if (!owner) {
    return NextResponse.json({ error: "App không tồn tại" }, { status: 404, headers: CORS });
  }

  // Allow per-call override of bank info via query (advanced apps with
  // multiple recipients) but default to the owner's saved config.
  const url = new URL(req.url);
  const cfg = getVietQrConfig(appId);
  const overrideBank = url.searchParams.get("bank") || "";
  const overrideAcc = url.searchParams.get("account") || "";
  const overrideName = url.searchParams.get("name") || "";

  let bankBin = cfg?.bankBin;
  let accountNo = cfg?.accountNo;
  let accountName = cfg?.accountName ?? "";

  if (overrideBank && overrideAcc) {
    const b = findBank(overrideBank);
    if (!b) return NextResponse.json({ error: "Bank không hợp lệ" }, { status: 400, headers: CORS });
    bankBin = b.bin;
    accountNo = overrideAcc;
    accountName = overrideName || accountName;
  }

  if (!bankBin || !accountNo) {
    return NextResponse.json(
      { error: "Chủ app chưa cấu hình bank — vào Dashboard → Thanh toán." },
      { status: 409, headers: CORS },
    );
  }

  // Cheap rate-limit so an attacker can't burn CPU spamming QR generation
  // (qrcode lib is fast but not free).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const rl = checkRateLimit(`vqr:${ip}:${appId}`, 60, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Quá nhiều yêu cầu" }, { status: 429, headers: CORS });
  }

  const amountRaw = url.searchParams.get("amount");
  const amount = amountRaw ? Math.max(0, Math.floor(Number(amountRaw))) : undefined;
  const description = url.searchParams.get("description") || undefined;
  const format = (url.searchParams.get("format") || "svg").toLowerCase();

  let payload;
  try {
    payload = buildVietQr({
      bankBin,
      accountNo,
      accountName,
      amount: amount && amount > 0 ? amount : undefined,
      description,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Build QR thất bại" },
      { status: 400, headers: CORS },
    );
  }

  if (format === "json") {
    return NextResponse.json(
      { qr: payload.qr, display: payload.display },
      { headers: CORS },
    );
  }

  try {
    // 'M' error correction = ~15% damage tolerance, good for screens + prints.
    const svg = await QRCode.toString(payload.qr, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
    });
    return new NextResponse(svg, {
      headers: {
        ...CORS,
        "content-type": "image/svg+xml; charset=utf-8",
      },
    });
  } catch (e) {
    console.error("[vietqr] render failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Render QR thất bại" }, { status: 500, headers: CORS });
  }
}
