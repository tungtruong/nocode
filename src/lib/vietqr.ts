// VietQR payload generator — produces the EMV-compatible QR string used by
// Napas QR (the unified QR standard every VN banking app recognises).
// Pure JavaScript, NO external API call. User scans the QR with any VN
// banking app → recipient + amount + description auto-fill in the transfer
// screen → user confirms → bank transfer happens instantly with 0 merchant fee.
//
// Spec reference: NAPAS QR standard v1.1 (EMV-compatible TLV with custom
// merchant-account sub-fields under tag 38, GUID A000000727).
//
// Tradeoff vs API-based providers (VNPay/MoMo): no automatic webhook —
// the app can't know server-side whether the user actually transferred.
// Owner reconciles against bank statement. Good enough for: bookings,
// event tickets, small e-commerce, donations, tips, wedding gift.

// === Bank registry (BIN codes per NAPAS) ===
// Curated list of ~50 VN banks that support VietQR receive. BIN is the
// 6-digit code Napas issues each bank. Codes are stable — Napas adds new
// banks rarely. Source: vietqr.io public docs + napas.com.vn.
export interface Bank {
  bin: string;
  code: string;   // short ticker used in UIs (VCB, TCB, BIDV, ...)
  name: string;   // full Vietnamese name
}
export const VN_BANKS: Bank[] = [
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
  { bin: "970454", code: "VietCapital",name: "Viet Capital Bank" },
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
  { bin: "970455", code: "IVB",        name: "Indovina Bank" },
  { bin: "970408", code: "GPBank",     name: "GP Bank" },
  { bin: "970430", code: "PGBank",     name: "PG Bank" },
  { bin: "970406", code: "DongABank",  name: "DongA Bank" },
  { bin: "970429", code: "SCB",        name: "SCB (Saigon)" },
  { bin: "970438", code: "BVB",        name: "Bao Viet Bank" },
  { bin: "970444", code: "CBBank",     name: "CB Bank" },
  { bin: "970434", code: "IndovinaBk", name: "Indovina (alt BIN)" },
  { bin: "970462", code: "Kookmin",    name: "Kookmin Bank" },
  { bin: "970421", code: "VRB",        name: "VRB" },
  { bin: "970458", code: "UOB",        name: "United Overseas Bank" },
  { bin: "970442", code: "HongLeong",  name: "Hong Leong Bank" },
  { bin: "970446", code: "COOPBank",   name: "Co-op Bank" },
  { bin: "970457", code: "Woori",      name: "Woori Bank" },
  { bin: "970463", code: "MAFC",       name: "Misubishi UFJ" },
  { bin: "970410", code: "SCV",        name: "Standard Chartered VN" },
  { bin: "971005", code: "ViettelMoney", name: "Viettel Money" },
  { bin: "971011", code: "MoMo",       name: "MoMo Wallet (test)" },
];

export function findBank(query: string): Bank | null {
  const q = query.trim().toUpperCase();
  return (
    VN_BANKS.find((b) => b.bin === q) ||
    VN_BANKS.find((b) => b.code.toUpperCase() === q) ||
    VN_BANKS.find((b) => b.name.toUpperCase().includes(q)) ||
    null
  );
}

// === EMV TLV helpers ===
// Each field is encoded as: 2-digit tag + 2-digit length (in characters) + value.
// All lengths are character counts, not bytes — but since we constrain values
// to printable ASCII this is the same number for us.
function tlv(tag: string, value: string): string {
  if (tag.length !== 2) throw new Error("tag must be 2 digits");
  if (value.length > 99) throw new Error(`field ${tag} value too long`);
  return tag + value.length.toString().padStart(2, "0") + value;
}

/**
 * Compute the CRC-16/CCITT-FALSE checksum used at the end of a Napas QR.
 * Polynomial 0x1021, initial 0xFFFF, no XOR-out, no reflection.
 */
function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// === Sanitisation ===
// The VN banking apps generally tolerate Vietnamese characters, BUT some still
// glitch on diacritics in the description field. To be safe + maximise
// compatibility we strip diacritics from `description` and `accountName`.
// We never strip from input the user typed in their bank — STK is digits only,
// bank app handles the rest.
const DIACRITIC = /\p{Diacritic}/gu;
function stripVN(s: string): string {
  return s.normalize("NFD").replace(DIACRITIC, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

// Description field rules (per Napas): no diacritics, no special chars
// beyond [A-Za-z0-9 .,/]+, max 25 chars (some banks 50; we cap at 25 for
// universal compatibility).
function sanitiseDescription(s: string): string {
  return stripVN(s).replace(/[^A-Za-z0-9 .,/-]/g, "").trim().slice(0, 25);
}

export interface VietQrInput {
  bankBin: string;        // BIN (e.g. "970436" for VCB)
  accountNo: string;      // recipient account number, digits only
  amount?: number;        // VND, integer; omit for static QR (user enters amount)
  description?: string;   // memo, max 25 chars
  accountName?: string;   // optional display name (used by UI not by QR)
}

export interface VietQrPayload {
  qr: string;          // the EMV string to encode into the QR image
  display: {
    bank: Bank | null;
    accountNo: string;
    accountName: string | null;
    amount: number | null;
    description: string | null;
  };
}

/**
 * Build the VietQR EMV string. Encode this into a QR image client-side or
 * server-side — every VN banking app recognises it.
 */
export function buildVietQr(input: VietQrInput): VietQrPayload {
  const bank = VN_BANKS.find((b) => b.bin === input.bankBin) || null;
  const accountNo = String(input.accountNo).replace(/\D/g, "");
  if (!accountNo) throw new Error("accountNo required");
  if (!input.bankBin || !/^\d{6}$/.test(input.bankBin)) {
    throw new Error("bankBin must be 6 digits");
  }

  // Merchant Account Information (tag 38) — Napas-specific structure:
  //   00 = GUID, always "A000000727" for Napas
  //   01 = beneficiary org sub-template:
  //        00 = acquirer ID = bank BIN
  //        01 = consumer ID = account number
  //   02 = service code: "QRIBFTTA" (account transfer) — universally supported
  const merchantInner =
    tlv("00", "A000000727") +
    tlv("01", tlv("00", input.bankBin) + tlv("01", accountNo)) +
    tlv("02", "QRIBFTTA");

  // Point of initiation: 12 (dynamic, has amount) when amount given, else 11 (static).
  const poi = typeof input.amount === "number" && input.amount > 0 ? "12" : "11";

  let payload =
    tlv("00", "01") +                  // Payload Format Indicator
    tlv("01", poi) +                   // Point of Initiation Method
    tlv("38", merchantInner) +         // Merchant Account Information
    tlv("53", "704");                  // Transaction Currency (704 = VND)

  if (typeof input.amount === "number" && input.amount > 0) {
    payload += tlv("54", String(Math.floor(input.amount)));
  }
  payload += tlv("58", "VN");          // Country Code

  if (input.description && input.description.trim()) {
    const desc = sanitiseDescription(input.description);
    if (desc) {
      // Additional Data Field Template (tag 62), sub-field 08 = purpose.
      payload += tlv("62", tlv("08", desc));
    }
  }

  // CRC: tag + length placeholder ("6304") MUST be included in the input
  // string fed to crc16, but the value itself is filled in afterward.
  const toCrc = payload + "6304";
  const crc = crc16(toCrc);
  payload += "63" + "04" + crc;

  return {
    qr: payload,
    display: {
      bank,
      accountNo,
      accountName: input.accountName ? stripVN(input.accountName).toUpperCase() : null,
      amount: typeof input.amount === "number" && input.amount > 0 ? Math.floor(input.amount) : null,
      description: input.description ? sanitiseDescription(input.description) : null,
    },
  };
}
