// Thin wrapper around Google Sheets API v4 + a few Drive endpoints, scoped
// to ONE user's stored OAuth credentials. Callers pass the user's email;
// we look up the integration, refresh the access_token if expired, and call
// Google on their behalf.
//
// What's intentionally NOT here:
//   - Per-call quota tracking (handled by the route guard in /api/sheet/*).
//   - Row-level caching (handled by the route too — keeps this stateless).
//   - Auth/permission (the route checks ownership; this just executes).

import { getIntegration, updateAccessToken } from "@/lib/integrations";
import { refreshAccessToken } from "@/lib/google-oauth";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

// Refresh window: 60-second safety margin so we don't hand back a token
// that expires mid-flight.
const REFRESH_WINDOW_MS = 60 * 1000;

export interface SheetSummary {
  spreadsheetId: string;
  title: string;
  url: string;
}

export interface Row {
  rowNumber: number;          // 1-based, matches Sheets UI
  fields: Record<string, string>;
}

/**
 * Get a valid access_token for this user — refreshes via refresh_token if the
 * cached one is missing or near expiry. Returns null if the user hasn't
 * connected Google.
 */
async function getAccessTokenFor(userEmail: string): Promise<string | null> {
  const integration = getIntegration(userEmail, "google_sheets");
  if (!integration) return null;

  const expiresAt = integration.expires_at ? Date.parse(integration.expires_at) : 0;
  if (integration.access_token && expiresAt > Date.now() + REFRESH_WINDOW_MS) {
    return integration.access_token;
  }

  // Refresh.
  const refreshed = await refreshAccessToken(integration.refresh_token);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  updateAccessToken(userEmail, "google_sheets", refreshed.access_token, newExpiresAt);
  return refreshed.access_token;
}

async function googleFetch<T>(
  userEmail: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getAccessTokenFor(userEmail);
  if (!token) throw new Error("google_not_connected");
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`google ${r.status} ${url}: ${body.slice(0, 200)}`);
  }
  if (r.status === 204) return undefined as unknown as T;
  return (await r.json()) as T;
}

/**
 * List spreadsheets the user has granted us access to (drive.file scope means
 * we only see ones they explicitly opened/created via our app).
 */
export async function listSpreadsheets(userEmail: string): Promise<SheetSummary[]> {
  const r = await googleFetch<{ files?: Array<{ id: string; name: string; webViewLink?: string }> }>(
    userEmail,
    `${DRIVE_BASE}/files?q=${encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")}&fields=files(id,name,webViewLink)&pageSize=100`,
  );
  return (r.files || []).map((f) => ({
    spreadsheetId: f.id,
    title: f.name,
    url: f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}`,
  }));
}

/**
 * Create a new spreadsheet with given title + initial header row.
 * Returns the new spreadsheetId + sheet name (defaults to "Sheet1").
 */
export async function createSpreadsheet(
  userEmail: string,
  opts: { title: string; headers?: string[] },
): Promise<{ spreadsheetId: string; sheetName: string; url: string }> {
  const created = await googleFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    sheets?: Array<{ properties: { title: string } }>;
  }>(userEmail, SHEETS_BASE, {
    method: "POST",
    body: JSON.stringify({ properties: { title: opts.title } }),
  });
  const sheetName = created.sheets?.[0]?.properties.title || "Sheet1";

  if (opts.headers && opts.headers.length > 0) {
    await googleFetch(
      userEmail,
      `${SHEETS_BASE}/${created.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:append?valueInputOption=RAW`,
      {
        method: "POST",
        body: JSON.stringify({ values: [opts.headers] }),
      },
    );
  }

  return {
    spreadsheetId: created.spreadsheetId,
    sheetName,
    url: created.spreadsheetUrl,
  };
}

/**
 * Get the headers (first row) of a sheet — used to auto-detect schema.
 */
export async function getHeaders(
  userEmail: string,
  spreadsheetId: string,
  sheetName: string,
  headerRow: number = 1,
): Promise<string[]> {
  const range = `${encodeURIComponent(sheetName)}!${headerRow}:${headerRow}`;
  const r = await googleFetch<{ values?: string[][] }>(
    userEmail,
    `${SHEETS_BASE}/${spreadsheetId}/values/${range}`,
  );
  return r.values?.[0] || [];
}

/**
 * Read all rows from a sheet, mapping each row to an object keyed by header.
 * Filters out empty rows.
 */
export async function selectAll(
  userEmail: string,
  spreadsheetId: string,
  sheetName: string,
  opts: { headerRow?: number; limit?: number } = {},
): Promise<Row[]> {
  const headerRow = opts.headerRow ?? 1;
  const headers = await getHeaders(userEmail, spreadsheetId, sheetName, headerRow);
  if (headers.length === 0) return [];

  const startRow = headerRow + 1;
  const range = `${encodeURIComponent(sheetName)}!A${startRow}:${columnLetter(headers.length)}`;
  const r = await googleFetch<{ values?: string[][] }>(
    userEmail,
    `${SHEETS_BASE}/${spreadsheetId}/values/${range}`,
  );
  const rows = r.values || [];
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, rows.length) : rows.length;

  const out: Row[] = [];
  for (let i = 0; i < limit; i++) {
    const cells = rows[i] || [];
    const fields: Record<string, string> = {};
    let nonEmpty = false;
    headers.forEach((h, j) => {
      const v = cells[j] ?? "";
      if (v !== "") nonEmpty = true;
      fields[h] = v;
    });
    if (nonEmpty) {
      out.push({ rowNumber: startRow + i, fields });
    }
  }
  return out;
}

/**
 * Append a row at the end. Fields not in the header schema are silently
 * dropped (caller can pre-call getHeaders to validate).
 */
export async function appendRow(
  userEmail: string,
  spreadsheetId: string,
  sheetName: string,
  fields: Record<string, string | number | boolean | null>,
  headerRow: number = 1,
): Promise<{ rowNumber: number }> {
  const headers = await getHeaders(userEmail, spreadsheetId, sheetName, headerRow);
  if (headers.length === 0) {
    throw new Error("sheet_has_no_headers");
  }
  const row = headers.map((h) => {
    const v = fields[h];
    if (v === null || v === undefined) return "";
    return String(v);
  });
  const range = `${encodeURIComponent(sheetName)}!A${headerRow}:append`;
  const r = await googleFetch<{ updates?: { updatedRange?: string } }>(
    userEmail,
    `${SHEETS_BASE}/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: [row] }),
    },
  );
  // updatedRange looks like "Sheet1!A5:D5" — pluck the row number.
  const m = r.updates?.updatedRange?.match(/![A-Z]+(\d+):/);
  const rowNumber = m ? Number.parseInt(m[1], 10) : -1;
  return { rowNumber };
}

/**
 * Update specific fields in an existing row (by row number).
 */
export async function updateRow(
  userEmail: string,
  spreadsheetId: string,
  sheetName: string,
  rowNumber: number,
  fields: Record<string, string | number | boolean | null>,
  headerRow: number = 1,
): Promise<void> {
  const headers = await getHeaders(userEmail, spreadsheetId, sheetName, headerRow);
  if (headers.length === 0) throw new Error("sheet_has_no_headers");
  if (rowNumber <= headerRow) throw new Error("invalid_row_number");

  // Read existing row first so we only overwrite fields actually provided
  // (sparse updates).
  const rangeRow = `${encodeURIComponent(sheetName)}!A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`;
  const existing = await googleFetch<{ values?: string[][] }>(
    userEmail,
    `${SHEETS_BASE}/${spreadsheetId}/values/${rangeRow}`,
  );
  const current = existing.values?.[0] || [];
  const merged = headers.map((h, i) => {
    if (Object.prototype.hasOwnProperty.call(fields, h)) {
      const v = fields[h];
      if (v === null || v === undefined) return "";
      return String(v);
    }
    return current[i] ?? "";
  });

  await googleFetch(
    userEmail,
    `${SHEETS_BASE}/${spreadsheetId}/values/${rangeRow}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [merged] }),
    },
  );
}

/**
 * Delete a row by number (shifts subsequent rows up). Implemented via
 * batchUpdate with a deleteDimension request.
 */
export async function deleteRow(
  userEmail: string,
  spreadsheetId: string,
  sheetName: string,
  rowNumber: number,
): Promise<void> {
  // We need the sheetId (numeric) for batchUpdate, not the title.
  const meta = await googleFetch<{
    sheets?: Array<{ properties: { sheetId: number; title: string } }>;
  }>(userEmail, `${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties`);
  const target = meta.sheets?.find((s) => s.properties.title === sheetName);
  if (!target) throw new Error("sheet_not_found");

  await googleFetch(
    userEmail,
    `${SHEETS_BASE}/${spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: target.properties.sheetId,
                dimension: "ROWS",
                startIndex: rowNumber - 1, // 0-based
                endIndex: rowNumber,
              },
            },
          },
        ],
      }),
    },
  );
}

// A → "A", 27 → "AA", etc. Sufficient for sheets with ≤ 702 columns.
function columnLetter(n: number): string {
  if (n <= 0) return "A";
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
