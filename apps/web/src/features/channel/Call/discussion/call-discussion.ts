import type { useLiveCallRecordQuery } from '@queries/call/call';
import type { CallRecord } from '@service-call/client';

export type CallDiscussion = CallRecord['discussion'];

/**
 * The active call's discussion, once its record says. A record the viewer can't
 * read belongs to a call with its own chat: channel threads are for members.
 */
export function callDiscussionOf(
  record: ReturnType<typeof useLiveCallRecordQuery>,
  callId: string | null | undefined
): CallDiscussion | undefined {
  if (!callId) return undefined;
  if (record.isPending) return undefined;
  // A failed poll keeps the data it had; only a first read that failed has none.
  if (record.isLoadingError) return { kind: 'call_chat', call_id: callId };
  if (record.data?.callId !== callId) return undefined;
  return record.data.discussion;
}
