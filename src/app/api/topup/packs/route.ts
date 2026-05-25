// GET /api/topup/packs → static list of available topup packs.
// Public (no auth needed) — pricing is the same for everyone, and the page
// that uses it is gated by login at the UI level.

import { NextResponse } from "next/server";
import { TOPUP_PACKS } from "@/lib/quota";

export function GET() {
  return NextResponse.json({
    packs: Object.values(TOPUP_PACKS).map((p) => ({
      id: p.id,
      tokens: p.tokens,
      priceUsd: p.priceUsd,
      label: p.label,
    })),
  });
}
