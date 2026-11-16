import type { MessageData } from '@core/messages/types';
import type { MessageListItem } from '@service-storage/messages';

/** Summarize loaded unanchored threads without fetching every reply. */
export function discussionPreview(messages: readonly MessageListItem[]) {
  const roots = messages.filter(
    (message) => !message.state.deleted_at && message.state.anchor === null
  );
  const newest = roots
    .filter((message) => !message.deleted_at)
    .toSorted(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
    )[0];
  const commenters = new Map<string, MessageData>();
  let count = 0;
  for (const root of roots.toReversed()) {
    count += (root.deleted_at ? 0 : 1) + root.thread.reply_count;
    if (!root.deleted_at) commenters.set(root.sender_id, root);
    for (const reply of root.thread.preview) {
      if (reply.deleted_at) continue;
      commenters.set(reply.sender_id, reply);
    }
  }
  return { newest, count, commenters: [...commenters.values()] };
}
