import type { MessageTimelineEntry } from '@service-storage/messages';

/**
 * Top-level channel messages from others since the given time. Thread replies
 * and the call's own thread never count: they don't appear after the call.
 */
export function outsideMessages(
  entries: readonly MessageTimelineEntry[],
  options: { since: string; currentUserId: string | undefined }
) {
  const since = new Date(options.since).getTime();
  return entries.flatMap((entry) => {
    if (entry.type !== 'message') return [];

    const { message } = entry;
    const counts =
      !message.deleted_at &&
      message.sender_id !== options.currentUserId &&
      new Date(message.created_at).getTime() > since;
    return counts ? [message] : [];
  });
}
