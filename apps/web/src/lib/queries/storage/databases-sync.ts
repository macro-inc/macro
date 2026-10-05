/** Gateway liveness for databases, apart from `./databases` to keep the websocket out of startup. */
import { useUserId } from '@core/context/user';
import { Telemetry } from '@macro-inc/observability';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import { storageServiceClient } from '@service-storage/client';
import type { Awareness } from '@service-storage/generated/schemas/awareness';
import type { AwarenessRelay } from '@service-storage/generated/schemas/awarenessRelay';
import type { TableChanged } from '@service-storage/generated/schemas/tableChanged';
import { ReactiveMap } from '@solid-primitives/map';
import { debounce } from '@solid-primitives/scheduled';
import { type Accessor, createEffect, on, onCleanup, untrack } from 'solid-js';
import { z } from 'zod';
import { invalidateDatabase } from './databases';

/** Gateway message type published by `crates/databases` on every write. */
const TABLE_CHANGED_MESSAGE_TYPE = 'database_table_changed';
const DATABASE_CHANGED_MESSAGE_TYPE = 'database_changed';
/** Gateway message type relaying one viewer's awareness to the others. */
const AWARENESS_MESSAGE_TYPE = 'database_awareness';

const AWARENESS_SEND_DEBOUNCE_MS = 150;
const AWARENESS_HEARTBEAT_MS = 20_000;
/** A viewer not heard from within this window is treated as gone. */
const AWARENESS_EXPIRY_MS = 45_000;
const AWARENESS_SWEEP_MS = 5_000;

const awarenessSchema: z.ZodType<Awareness> = z.object({
  peerId: z.string().uuid().optional(),
  tableId: z.string(),
  rowId: z.string().optional(),
  columnId: z.string().optional(),
  endRowId: z.string().optional(),
  endColumnId: z.string().optional(),
  editing: z.boolean().optional(),
  left: z.boolean().optional(),
});

const tableChangedSchema: z.ZodType<TableChanged> = z.object({
  databaseId: z.string(),
  tableId: z.string(),
  version: z.number(),
});

const databaseChangedSchema = z.object({ databaseId: z.string() });

const awarenessRelaySchema: z.ZodType<AwarenessRelay> = z.object({
  databaseId: z.string(),
  userId: z.string(),
  state: awarenessSchema,
  relayedAt: z.number(),
});

/** A gateway payload read against its schema; one that does not fit is reported and dropped. */
export function parseMessageData<Data>(
  message: { type: string; data: unknown },
  schema: z.ZodType<Data>
): Data | undefined {
  let raw: unknown;
  try {
    raw =
      typeof message.data === 'string'
        ? JSON.parse(message.data)
        : message.data;
  } catch {
    Telemetry.warn('unparsable gateway payload', { type: message.type });
    return undefined;
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  Telemetry.warn('gateway payload did not match its schema', {
    type: message.type,
    issues: JSON.stringify(parsed.error.issues),
  });
  return undefined;
}

/** Every table change the gateway reports; it carries only the new version, never rows. */
export function useDatabaseTableChanges(
  onChange: (change: TableChanged) => void
) {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== TABLE_CHANGED_MESSAGE_TYPE) return;
    const change = parseMessageData(message, tableChangedSchema);
    if (change) onChange(change);
  });
}

/** Database metadata changed; the ping contains no private metadata. */
export function useDatabaseMetadataChanges(
  onChange: (change: { databaseId: string }) => void
) {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== DATABASE_CHANGED_MESSAGE_TYPE) return;
    const change = parseMessageData(message, databaseChangedSchema);
    if (change) onChange(change);
  });
}

/** Re-read a database's schema whenever the gateway reports one of its tables changed. */
export function useDatabaseTableChangedSync(
  databaseId: () => string | undefined
) {
  const refresh = (change: { databaseId: string }) => {
    if (change.databaseId === databaseId())
      void invalidateDatabase(change.databaseId);
  };
  useDatabaseTableChanges(refresh);
  useDatabaseMetadataChanges(refresh);
}

/** Where this client is inside a database. */
export type LocalDatabaseAwareness = Omit<Awareness, 'left' | 'peerId'>;

/** Where another viewer is inside the database. */
type RemoteDatabaseAwareness = Omit<Awareness, 'left' | 'editing'> & {
  userId: string;
  editing: boolean;
};

type HeldAwareness = {
  userId: string;
  state: Awareness;
  /** Server relay time, orders messages from the same peer. */
  relayedAt: number;
  /** Local clock, decides expiry so clock skew cannot drop live viewers. */
  receivedAt: number;
};

/**
 * Share where this client is, debounced and on a heartbeat, and follow everyone else,
 * dropping stale relays, this client's own, and viewers silent past the expiry.
 */
export function useDatabaseAwareness(
  databaseId: () => string | undefined,
  local: () => LocalDatabaseAwareness | undefined
): { remote: Accessor<RemoteDatabaseAwareness[]> } {
  const userId = useUserId();
  const peerId = crypto.randomUUID();
  const held = new ReactiveMap<string, HeldAwareness>();

  let announced: { databaseId: string; state: Awareness } | undefined;
  const send = (id: string, state: Awareness) => {
    void storageServiceClient.databases
      .shareAwareness({ id, state: { ...state, peerId } })
      .mapErr((errors) =>
        Telemetry.warn('database awareness was not shared', {
          databaseId: id,
          errors: JSON.stringify(errors),
        })
      );
  };
  const leave = () => {
    if (!announced) return;
    send(announced.databaseId, {
      tableId: announced.state.tableId,
      left: true,
    });
    announced = undefined;
  };
  const share = () => {
    const id = untrack(databaseId);
    const state = untrack(local);
    if (!id || !state) {
      leave();
      return;
    }
    if (announced && announced.databaseId !== id) leave();
    const payload: Awareness = { tableId: state.tableId };
    if (state.rowId !== undefined) payload.rowId = state.rowId;
    if (state.columnId !== undefined) payload.columnId = state.columnId;
    if (state.endRowId !== undefined) payload.endRowId = state.endRowId;
    if (state.endColumnId !== undefined)
      payload.endColumnId = state.endColumnId;
    if (state.rowId !== undefined || state.columnId !== undefined)
      payload.editing = Boolean(state.editing);
    announced = { databaseId: id, state: payload };
    send(id, payload);
  };
  const shareSoon = debounce(share, AWARENESS_SEND_DEBOUNCE_MS);
  createEffect(
    on(
      () => {
        const state = local();
        return JSON.stringify([
          databaseId(),
          state?.tableId,
          state?.rowId,
          state?.columnId,
          state?.endRowId,
          state?.endColumnId,
          state?.editing,
        ]);
      },
      () => shareSoon()
    )
  );
  createEffect(on(databaseId, () => held.clear()));
  const heartbeat = setInterval(() => {
    if (announced) send(announced.databaseId, announced.state);
  }, AWARENESS_HEARTBEAT_MS);

  createConnectionWebsocketEffect((message) => {
    if (message.type !== AWARENESS_MESSAGE_TYPE) return;
    const relay = parseMessageData(message, awarenessRelaySchema);
    if (!relay || relay.databaseId !== databaseId()) return;
    if (
      relay.userId === userId() &&
      (!relay.state.peerId || relay.state.peerId === peerId)
    )
      return;
    const key = JSON.stringify([relay.userId, relay.state.peerId ?? null]);
    const current = held.get(key);
    if (current && current.relayedAt > relay.relayedAt) return;
    held.set(key, {
      userId: relay.userId,
      state: relay.state,
      relayedAt: relay.relayedAt,
      receivedAt: Date.now(),
    });
  });
  const sweep = setInterval(() => {
    const cutoff = Date.now() - AWARENESS_EXPIRY_MS;
    for (const [id, entry] of [...held.entries()]) {
      if (entry.receivedAt < cutoff) held.delete(id);
    }
  }, AWARENESS_SWEEP_MS);

  onCleanup(() => {
    shareSoon.clear();
    clearInterval(heartbeat);
    clearInterval(sweep);
    leave();
  });

  const remote = () =>
    [...held.values()]
      .filter(({ state }) => !state.left)
      .map(({ userId, state }) => ({
        userId,
        peerId: state.peerId,
        tableId: state.tableId,
        rowId: state.rowId,
        columnId: state.columnId,
        endRowId: state.endRowId,
        endColumnId: state.endColumnId,
        editing: Boolean(state.editing),
      }));
  return { remote };
}
