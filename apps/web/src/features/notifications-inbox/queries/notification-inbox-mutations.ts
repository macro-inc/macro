import {
  ClearNotificationInboxDocument,
  type ClearNotificationInboxInput,
  MarkNotificationInboxNotificationDoneDocument,
  MarkNotificationInboxRowsDoneDocument,
  MarkNotificationInboxRowsSeenDocument,
  type NotificationInboxPatchFieldsFragment,
  type NotificationInboxScopeInput,
  UndoNotificationInboxRowsDoneDocument,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';

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
 * Clear the inbox in one call; the server reads every batch. Resolves to how
 * many rows it took (so far, when it carries on in the background), the token
 * that reverses all of it, and whether it finished.
 */
export async function clearInbox(
  client: Client,
  input: ClearNotificationInboxInput
): Promise<{ rowCount: number; undoToken: string; complete: boolean }> {
  const result = await client
    .mutation(ClearNotificationInboxDocument, { input })
    .toPromise();
  const payload = result.data?.clearNotificationInbox;
  if (result.error || !payload) {
    throw result.error ?? new Error('Clearing the inbox failed');
  }
  return {
    rowCount: payload.rowCount,
    undoToken: payload.undoToken,
    complete: payload.complete,
  };
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
