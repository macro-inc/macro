import type { ApiMessage } from '@service-email/generated/schemas';
import { err, ok, type Result } from 'neverthrow';
import { fetchAndCacheThread } from './thread';

/** A draft in a thread that can be discarded without opening its composer. */
export type ThreadDraftHandle = {
  draftId: string;
  draftGeneration: number;
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

/**
 * Reads a thread's discardable drafts. The fetch also warms the thread cache,
 * which the queued draft delete rebases its optimistic thread onto.
 */
export async function readThreadDrafts(
  threadId: string
): Promise<Result<ThreadDraftHandle[], ThreadDraftsError>> {
  const result = await fetchAndCacheThread(threadId);
  if (result.isErr())
    return err({
      kind: 'thread-unavailable',
      codes: result.error.map((error) => error.code),
    });
  return ok(
    result.value.thread.messages.filter(isDiscardableDraft).map(
      (message): ThreadDraftHandle => ({
        draftId: message.db_id,
        draftGeneration: message.draft_generation,
        inboxId: message.link_id,
      })
    )
  );
}
