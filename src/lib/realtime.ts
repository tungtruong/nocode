// Server-side fan-out hub for Supabase Postgres realtime → SSE clients.
//
// Why fan out through JV instead of letting the browser hit Supabase directly:
//   - The browser would need the Supabase anon key (OK to expose) AND RLS
//     policies properly scoped per (app_id, table_name) — but our schema runs
//     RLS-off because the JV server uses service_role.
//   - End-users authenticate via the per-app JWT cookie we already mint —
//     no need to mint a second Supabase-compatible JWT for the same identity.
//   - Lets us reuse the PRIVATE_TABLES / @me filter / rate-limit rules that
//     /api/db/.../list already enforces — one security model, not two.
//
// Architecture:
//   - One Supabase channel per (appId, table) — opened lazily on first
//     subscriber, closed when refcount drops to zero. So 1000 clients
//     watching the same menu open exactly 1 WS to Supabase.
//   - Each SSE client gets fan-out filtered by their own `@me` constraint
//     (per-user data only sends events touching that user's rows).
//   - Heartbeat every 25s to defeat Cloudflare's 100s idle timeout.

import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

export type DbEvent = {
  type: "INSERT" | "UPDATE" | "DELETE";
  row: Record<string, unknown> | null;
  oldRow: Record<string, unknown> | null;
  id: string | null;
};

export interface RealtimeClient {
  /** Optional uid filter — when set, only rows whose row_data.user_id matches
   *  are forwarded. Implements the `where: { user_id: '@me' }` subscribe filter. */
  uidFilter?: string | null;
  send: (event: DbEvent) => void;
  /** Called when the underlying Supabase channel errors / closes so the SSE
   *  endpoint can tear down the response cleanly. */
  onError?: (reason: string) => void;
}

interface ChannelEntry {
  channel: RealtimeChannel;
  clients: Set<RealtimeClient>;
  closing: NodeJS.Timeout | null;
}

const CHANNELS = new Map<string, ChannelEntry>();
// Grace period before tearing down a channel after the last client leaves —
// avoids thrashing reconnects when a user navigates between two pages that
// both subscribe to the same table.
const CHANNEL_LINGER_MS = 5_000;

function key(appId: string, table: string): string {
  return `${appId}::${table}`;
}

function openChannel(appId: string, table: string): ChannelEntry {
  const k = key(appId, table);
  const sb = getSupabase();
  const channel = sb
    .channel(`jvrt:${k}`)
    .on(
      // The supabase-js postgres_changes typings rely on a per-event-type
      // discriminator; passing it inline trips strict literal narrowing.
      // The cast keeps the rest of this file type-safe without dragging in
      // a long generic chain.
      "postgres_changes" as never,
      {
        event: "*",
        schema: "public",
        table: "app_rows",
        filter: `app_id=eq.${appId}`,
      },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        const entry = CHANNELS.get(k);
        if (!entry) return;
        const newRow = (payload.new ?? null) as Record<string, unknown> | null;
        const oldRow = (payload.old ?? null) as Record<string, unknown> | null;
        // app_id filter is server-side, but we still match table_name client-side
        // — supabase's PG filter syntax doesn't support multi-column AND well
        // for jsonb-adjacent fields and adding a second filter doubles WS count.
        const evtTable = ((newRow?.table_name as string) || (oldRow?.table_name as string) || "");
        if (evtTable !== table) return;

        const rowData = (newRow?.row_data ?? null) as Record<string, unknown> | null;
        const oldRowData = (oldRow?.row_data ?? null) as Record<string, unknown> | null;
        const id = ((newRow?.id ?? oldRow?.id) as string) || null;
        const evt: DbEvent = {
          type: payload.eventType as DbEvent["type"],
          row: rowData,
          oldRow: oldRowData,
          id,
        };

        for (const client of entry.clients) {
          if (client.uidFilter) {
            // For @me-scoped subscriptions, only forward events the user
            // actually owns. Server-side filter prevents leaking foreign rows.
            const ownerNew = (rowData?.user_id as string) || null;
            const ownerOld = (oldRowData?.user_id as string) || null;
            if (ownerNew !== client.uidFilter && ownerOld !== client.uidFilter) continue;
          }
          try { client.send(evt); } catch {
            // Client send failed — drop it. Endpoint cleanup will handle
            // the SSE socket teardown via its own abort listener.
          }
        }
      },
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "CLOSED" || status === "TIMED_OUT") {
        const entry = CHANNELS.get(k);
        if (!entry) return;
        for (const c of entry.clients) c.onError?.(status);
      }
    });

  return { channel, clients: new Set(), closing: null };
}

export function addRealtimeClient(
  appId: string,
  table: string,
  client: RealtimeClient,
): () => void {
  const k = key(appId, table);
  let entry = CHANNELS.get(k);
  if (!entry) {
    entry = openChannel(appId, table);
    CHANNELS.set(k, entry);
  }
  if (entry.closing) {
    clearTimeout(entry.closing);
    entry.closing = null;
  }
  entry.clients.add(client);

  return () => {
    const e = CHANNELS.get(k);
    if (!e) return;
    e.clients.delete(client);
    if (e.clients.size === 0 && !e.closing) {
      // Linger briefly so quick remount (e.g. SPA route swap) reuses the WS.
      e.closing = setTimeout(() => {
        const still = CHANNELS.get(k);
        if (!still || still.clients.size > 0) return;
        try { still.channel.unsubscribe(); } catch { /* ignore */ }
        CHANNELS.delete(k);
      }, CHANNEL_LINGER_MS);
    }
  };
}

/** For health metrics — count of open Supabase channels + total clients. */
export function realtimeStats(): { channels: number; clients: number } {
  let clients = 0;
  for (const e of CHANNELS.values()) clients += e.clients.size;
  return { channels: CHANNELS.size, clients };
}
