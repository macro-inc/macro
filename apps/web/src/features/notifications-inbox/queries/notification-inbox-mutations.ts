import {
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
