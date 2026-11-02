import type { ApiMessage } from '@service-email/generated/schemas';
import { fetchAndCacheThread } from './thread';

/** A draft in a thread that can be discarded without opening its composer. */
export type ThreadDraftHandle = {
  draftId: string;
  draftGeneration: number;
  inboxId: string;
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
): Promise<ThreadDraftHandle[]> {
  const result = await fetchAndCacheThread(threadId);
  if (result.isErr()) {
    throw new Error(
      `Failed to read thread drafts: ${result.error.map((e) => e.code).join(', ')}`
    );
  }
  return result.value.thread.messages.filter(isDiscardableDraft).map(
    (message): ThreadDraftHandle => ({
      draftId: message.db_id,
      draftGeneration: message.draft_generation,
      inboxId: message.link_id,
    })
  );
}
