import type {
  Message,
  MessageCursor,
  MessageParent,
  MessageThread,
  MessageTimelineEntry,
  MessageTimelinePage,
  TimelineActivity,
} from '@service-storage/messages';
import { queryClient } from '../../client';
import { getThreadRepliesQueryKeyPrefix } from '../thread-replies';
import type { MessageTimelineData } from '../timeline';
import {
  pageIndexForEntry,
  reconcileTimelineEntries,
  timelineEntryKey,
} from '../timeline-entries';

/**
 * Put the current state of changed rows into the loaded pages. A row already
 * loaded is replaced where it is; a new one goes into the page whose bounds
 * contain it, and one outside the loaded span is left for the page that will
 * bring it.
 */
export function upsertTimelineEntries(
  data: MessageTimelineData | undefined,
  entries: MessageTimelineEntry[]
): MessageTimelineData | undefined {
  if (!data?.pages.length || entries.length === 0) return data;
  let pages = data.pages;
  for (const entry of entries) {
    const key = timelineEntryKey(entry);
    const loaded = pages.findIndex((page) =>
      page.entries.some((existing) => timelineEntryKey(existing) === key)
    );
    const index = loaded === -1 ? pageIndexForEntry(pages, entry) : loaded;
    if (index === -1) continue;
    pages = pages.map((page, pageIndex) =>
      pageIndex === index
        ? { ...page, entries: reconcileTimelineEntries(page.entries, [entry]) }
        : page
    );
  }
  return pages === data.pages ? data : { ...data, pages };
}

/** Drop rows the server no longer shows a reader, roots and preview replies alike. */
export function removeTimelineMessages(
  data: MessageTimelineData | undefined,
  removed: ReadonlySet<string>
): MessageTimelineData | undefined {
  if (!data || removed.size === 0) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const entries = page.entries.flatMap((entry): MessageTimelineEntry[] => {
      if (entry.type === 'activity') return [entry];
      if (removed.has(entry.message.id)) {
        pageChanged = true;
        return [];
      }
      const preview = entry.message.thread.preview.filter(
        (reply) => !removed.has(reply.id)
      );
      if (preview.length === entry.message.thread.preview.length) {
        return [entry];
      }
      pageChanged = true;
      return [
        {
          ...entry,
          message: {
            ...entry.message,
            thread: { ...entry.message.thread, preview },
          },
        },
      ];
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, entries };
  });
  return changed ? { ...data, pages } : data;
}

/** A changed reply in its current state: replaced in place, or added at the end. */
export function upsertThreadReply(
  replies: Message[] | undefined,
  reply: Message
): Message[] {
  if (!replies) return [reply];
  const index = replies.findIndex((existing) => existing.id === reply.id);
  if (index === -1) return [...replies, reply];
  return replies.map((existing, at) => (at === index ? reply : existing));
}

/** Drop removed replies from every loaded thread of the channel. */
export function removeThreadReplies(
  parent: MessageParent,
  removed: ReadonlySet<string>
) {
  queryClient.setQueriesData<MessageThread>(
    { queryKey: getThreadRepliesQueryKeyPrefix(parent) },
    (thread) => {
      if (!thread) return thread;
      const replies = thread.replies.filter((reply) => !removed.has(reply.id));
      return replies.length === thread.replies.length
        ? thread
        : { ...thread, replies };
    }
  );
}

function entryCursor(entry: MessageTimelineEntry): MessageCursor {
  if (entry.type === 'activity') {
    return { created_at: entry.activity.occurred_at, id: entry.activity.id };
  }
  return { created_at: entry.message.created_at, id: entry.message.id };
}

/**
 * The newest `limit` rows of a latest page. A cut page continues from its
 * last kept row, which is what a cursor is: the row a page ends at.
 */
export function trimLatestPage(
  page: MessageTimelinePage,
  limit: number
): MessageTimelinePage {
  if (page.entries.length <= limit) return page;
  const entries = page.entries.slice(0, limit);
  const last = entries.at(-1);
  return {
    ...page,
    entries,
    next_cursor: last ? entryCursor(last) : page.next_cursor,
  };
}

/** One page of a channel's changes, in timeline shapes. */
export type TimelineChanges = {
  entries: MessageTimelineEntry[];
  activities: TimelineActivity[];
  removed: ReadonlySet<string>;
};

/**
 * A cached latest page brought forward by one page of changes, the way a
 * loaded timeline takes them, then cut back to its newest `limit` rows. A
 * changed row older than the page's last row stays out, as it would from a
 * loaded timeline whose older pages are not loaded.
 */
export function applyChangesToLatestPage(
  page: MessageTimelinePage,
  changes: TimelineChanges,
  limit: number
): MessageTimelinePage {
  const activities = changes.activities.map(
    (activity): MessageTimelineEntry => ({ type: 'activity', activity })
  );
  const applied = removeTimelineMessages(
    upsertTimelineEntries({ pages: [page], pageParams: [null] }, [
      ...changes.entries,
      ...activities,
    ]),
    changes.removed
  );
  return trimLatestPage(applied?.pages[0] ?? page, limit);
}
