import type { ApiMessage } from '@service-email/generated/schemas';
import { err, ok, type Result, ResultAsync } from 'neverthrow';
import { draftQueueActive } from './draft-queue';
import { isListedLocalDraft, localDraftRowId } from './local-draft-entities';
import { listLocalDrafts } from './local-drafts';
import { fetchAndCacheThread } from './thread';

/** A draft in a thread that can be discarded without opening its composer. */
export type ThreadDraftHandle = {
  draftId: string;
  draftGeneration: number;
  /** Thread the delete targets; a local-only draft may use a local handle. */
  threadId: string;
  inboxId: string;
};

export type ThreadDraftsError = {
  kind: 'thread-unavailable';
  codes: string[];
};

/** Scheduled drafts are pending sends; cancel the schedule before discarding. */
function isDiscardableDraft(message: ApiMessage): boolean {
  return message.is_draft && !message.scheduled_send_time;
}

/** Working copies on this device that show under the row; queue only. */
async function readLocalThreadDrafts(rowId: string) {
  const none = { handles: [] as ThreadDraftHandle[], ids: new Set<string>() };
  if (!draftQueueActive()) return none;
  // Storage can be unavailable (signed out, private mode); then there are none.
  const drafts = await ResultAsync.fromPromise(listLocalDrafts(), () => null);
  if (drafts.isErr()) return none;
  const listed = drafts.value.filter(
    (draft) => isListedLocalDraft(draft) && localDraftRowId(draft) === rowId
  );
  return {
    handles: listed.map(
      (draft): ThreadDraftHandle => ({
        draftId: draft.draftId,
        draftGeneration: draft.content.draft_generation ?? 0,
        threadId: draft.serverThreadId ?? draft.threadId ?? rowId,
        inboxId: draft.inboxId ?? '',
      })
    ),
    // The server knows a synced working copy by its server ID.
    ids: new Set(
      listed.flatMap((draft) =>
        draft.serverDraftId
          ? [draft.draftId, draft.serverDraftId]
          : [draft.draftId]
      )
    ),
  };
}

/**
 * Reads a row's discardable drafts: unsynced working copies on this device
 * and the thread's server drafts. The fetch also warms the thread cache,
 * which the queued draft delete rebases its optimistic thread onto. A row
 * that exists only on this device has no server thread to read.
 */
export async function readThreadDrafts(
  threadId: string
): Promise<Result<ThreadDraftHandle[], ThreadDraftsError>> {
  const [local, result] = await Promise.all([
    readLocalThreadDrafts(threadId),
    fetchAndCacheThread(threadId),
  ]);
  if (result.isErr()) {
    if (local.handles.length > 0) return ok(local.handles);
    return err({
      kind: 'thread-unavailable',
      codes: result.error.map((error) => error.code),
    });
  }
  const server = result.value.thread.messages
    .filter(
      (message) => isDiscardableDraft(message) && !local.ids.has(message.db_id)
    )
    .map(
      (message): ThreadDraftHandle => ({
        draftId: message.db_id,
        draftGeneration: message.draft_generation,
        threadId,
        inboxId: message.link_id,
      })
    );
  return ok([...local.handles, ...server]);
}
