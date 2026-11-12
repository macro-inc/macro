import {
  ClearNotificationInboxDocument,
  type ClearNotificationInboxInput,
  MarkNotificationInboxNotificationDoneDocument,
  MarkNotificationInboxRowsDoneDocument,
  MarkNotificationInboxRowsSeenDocument,
  NotificationInboxClearsDocument,
  type NotificationInboxPatchFieldsFragment,
  type NotificationInboxScopeInput,
  UndoNotificationInboxClearDocument,
  UndoNotificationInboxRowsDoneDocument,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import type { InboxClearState } from '../core/inbox-clear';
import { toInboxClear } from './decode';

/** A row and the revision the viewer saw, which done acknowledges. */
export type InboxRowTarget = { id: string; revision: string };

/** Mark rows done; resolves to the token that reverses exactly this done. */
export async function markInboxRowsDone(
  client: Client,
  rows: readonly InboxRowTarget[]
): Promise<{ undoToken: string }> {
  const result = await client
    .mutation(MarkNotificationInboxRowsDoneDocument, {
      input: { rows: rows.map(({ id, revision }) => ({ id, revision })) },
    })
    .toPromise();
  const payload = result.data?.markNotificationInboxRowsDone;
  if (result.error || !payload) {
    throw result.error ?? new Error('Marking inbox rows done failed');
  }
  return { undoToken: payload.undoToken };
}

/**
 * Mark one notification of a row done, with the hidden ones about the same
 * message; resolves to the row's group in `scope` and the token that reverses
 * exactly this done.
 */
export async function markInboxNotificationDone(
  client: Client,
  rowId: string,
  notificationId: string,
  scope: NotificationInboxScopeInput
): Promise<{
  patches: NotificationInboxPatchFieldsFragment[];
  undoToken: string;
}> {
  const result = await client
    .mutation(MarkNotificationInboxNotificationDoneDocument, {
      input: { rowId, notificationId, scope },
    })
    .toPromise();
  const payload = result.data?.markNotificationInboxNotificationDone;
  if (result.error || !payload) {
    throw (
      result.error ?? new Error('Marking an inbox notification done failed')
    );
  }
  return payload;
}

/**
 * Start clear `clearId` of the inbox; the server works through it on its
 * own. Resolves to the clear as it stood at the reply: finished, or still
 * applying. Sending the same id again starts nothing new.
 */
export async function clearInbox(
  client: Client,
  input: ClearNotificationInboxInput & { clearId: string }
): Promise<InboxClearState> {
  const result = await client
    .mutation(ClearNotificationInboxDocument, { input })
    .toPromise();
  const payload = result.data?.clearNotificationInbox;
  if (result.error || !payload) {
    throw result.error ?? new Error('Clearing the inbox failed');
  }
  return toInboxClear(payload.clear);
}

/**
 * Undo a clear, stopping it first if it is still at work. Resolves to the
 * clear as it stood at the reply (undone, or still undoing on the server),
 * or undefined when the server no longer has it.
 */
export async function undoInboxClear(
  client: Client,
  clearId: string
): Promise<InboxClearState | undefined> {
  const result = await client
    .mutation(UndoNotificationInboxClearDocument, { input: { clearId } })
    .toPromise();
  const payload = result.data?.undoNotificationInboxClear;
  if (result.error || !payload) {
    throw result.error ?? new Error('Undoing the inbox clear failed');
  }
  return payload.clear ? toInboxClear(payload.clear) : undefined;
}

/**
 * Read the viewer's clears from the server: the one named, or without an id
 * every clear and undo still at work.
 */
export async function readInboxClears(
  client: Client,
  clearId?: string
): Promise<InboxClearState[]> {
  const result = await client
    .query(
      NotificationInboxClearsDocument,
      { clearId: clearId ?? null },
      { requestPolicy: 'network-only' }
    )
    .toPromise();
  const clears = result.data?.user.notificationInboxClears;
  if (result.error || !clears) {
    throw result.error ?? new Error('Reading inbox clears failed');
  }
  return clears.map(toInboxClear);
}

/** Reverse one done; resolves to the restored entries' places in `scope`. */
export async function undoInboxRowsDone(
  client: Client,
  undoToken: string,
  scope: NotificationInboxScopeInput
): Promise<NotificationInboxPatchFieldsFragment[]> {
  const result = await client
    .mutation(UndoNotificationInboxRowsDoneDocument, {
      input: { undoToken, scope },
    })
    .toPromise();
  const payload = result.data?.undoNotificationInboxRowsDone;
  if (result.error || !payload) {
    throw result.error ?? new Error('Undoing inbox done failed');
  }
  return payload.patches;
}

/**
 * Mark rows seen, hidden notifications included; resolves to the changed
 * entries in `scope`.
 */
export async function markInboxRowsSeen(
  client: Client,
  rowIds: readonly string[],
  scope: NotificationInboxScopeInput
): Promise<NotificationInboxPatchFieldsFragment[]> {
  const result = await client
    .mutation(MarkNotificationInboxRowsSeenDocument, {
      input: { rowIds: [...rowIds], scope },
    })
    .toPromise();
  const payload = result.data?.markNotificationInboxRowsSeen;
  if (result.error || !payload) {
    throw result.error ?? new Error('Marking inbox rows seen failed');
  }
  return payload.patches;
}
