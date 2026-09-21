import { compareTimelinePositions } from '@core/util/message-timeline';
import type {
  MessageCursor,
  MessageParent,
  MessageTimelineEntry,
  MessageTimelinePage,
} from '@service-storage/messages';
import type { InfiniteData } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { messageKeys, messageMutationKey } from './keys';
import {
  reconcileTimelineEntries,
  reconcileTimelineRefresh,
  timelineEntryPosition,
  timelineMessages,
} from './timeline-entries';

export type MessageTimelinePageParam = {
  next_cursor: MessageCursor | null;
  previous_cursor: MessageCursor | null;
};
export type MessageTimelineData = InfiniteData<
  MessageTimelinePage,
  MessageTimelinePageParam | null
>;
type FetchTimelinePage = (
  parent: MessageParent,
  param: MessageTimelinePageParam | null,
  around: string | null
) => Promise<MessageTimelinePage>;

/** Channel activity may be materialized anywhere in the loaded chronological span. */
export function createChannelTimelineReader(
  parent: MessageParent,
  around: string | null,
  fetchPage: FetchTimelinePage
) {
  const key = messageKeys.messages(parent, around).queryKey;
  return {
    queryFn: async ({
      pageParam,
    }: {
      pageParam: MessageTimelinePageParam | null;
    }) => {
      const before = queryClient.getQueryData<MessageTimelineData>(key);
      return refreshChannelTimelinePage(
        parent,
        pageParam,
        around,
        cachedTimelinePage(before, pageParam),
        fetchPage
      );
    },
    // TanStack invokes this wrapper once for the whole infinite fetch. Reconcile
    // here so updates arriving during later pages survive the final commit too.
    persister: async <T>(
      read: (...args: never[]) => T | Promise<T>,
      context: { signal: AbortSignal }
    ): Promise<T> => {
      const signal = context.signal;
      const before = queryClient.getQueryData<MessageTimelineData>(key);
      const snapshot = {
        before,
        pending: pendingTimelineRoots(parent, before),
      };
      const result = await read();
      if (!isTimelineData(result)) return result;
      // Until POST acknowledges its real ID, the fetched server row cannot be
      // correlated with its optimistic row. Keep the current view until then.
      if (!result.pages[0]?.previous_cursor)
        await waitForPendingRootPosts(parent, signal);
      return {
        ...result,
        ...reconcileTimelineRead(
          queryClient.getQueryData<MessageTimelineData>(key),
          result,
          snapshot
        ),
      };
    },
  };
}

async function waitForPendingRootPosts(
  parent: MessageParent,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const mutations = queryClient.getMutationCache();
  const hasPending = () =>
    mutations
      .findAll({ mutationKey: messageMutationKey, status: 'pending' })
      .some((mutation) => {
        const variables = mutation.state.variables;
        return (
          isRecord(variables) &&
          isRecord(variables.parent) &&
          variables.parent.type === parent.type &&
          variables.parent.id === parent.id &&
          typeof variables.optimisticId === 'string' &&
          isRecord(variables.message) &&
          !variables.message.thread_id
        );
      });
  if (!hasPending()) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      unsubscribe();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const check = () => {
      if (!hasPending()) {
        cleanup();
        resolve();
      }
    };
    const unsubscribe = mutations.subscribe(check);
    signal.addEventListener('abort', abort, { once: true });
    check();
  });
}

function cursorPosition(cursor: MessageCursor) {
  return { id: cursor.id, createdAt: cursor.created_at };
}

function sameCursor(
  a: MessageCursor | null | undefined,
  b: MessageCursor | null | undefined
) {
  return (
    !!a &&
    !!b &&
    compareTimelinePositions(cursorPosition(a), cursorPosition(b)) === 0
  );
}

function cachedTimelinePage(
  data: MessageTimelineData | undefined,
  param: MessageTimelinePageParam | null
) {
  if (!data) return;
  if (!param)
    return data.pageParams[0] == null
      ? { page: data.pages[0], upperExclusive: false }
      : undefined;
  // Refetching an infinite query derives each following cursor from the new
  // preceding page; centered pages therefore need their adjacent bound too.
  const index = data.pages.findIndex((_, index) =>
    param.next_cursor
      ? sameCursor(data.pageParams[index]?.next_cursor, param.next_cursor) ||
        (index > 0 &&
          sameCursor(data.pages[index - 1].next_cursor, param.next_cursor))
      : sameCursor(
          data.pageParams[index]?.previous_cursor,
          param.previous_cursor
        ) ||
        sameCursor(
          data.pages[index + 1]?.previous_cursor,
          param.previous_cursor
        )
  );
  if (index < 0) return;
  return {
    page:
      index === 0
        ? data.pages[index]
        : {
            ...data.pages[index],
            previous_cursor: data.pages[index - 1].next_cursor,
          },
    upperExclusive: index > 0,
  };
}

function entryWithinPage(
  entry: MessageTimelineEntry,
  page: MessageTimelinePage,
  upperExclusive = false
) {
  const position = timelineEntryPosition(entry);
  return (
    (!page.next_cursor ||
      compareTimelinePositions(position, cursorPosition(page.next_cursor)) >=
        0) &&
    (!page.previous_cursor ||
      compareTimelinePositions(position, cursorPosition(page.previous_cursor)) <
        (upperExclusive ? 0 : 1))
  );
}

/** Re-read exactly the loaded window, including activity materialized behind messages. */
async function refreshChannelTimelinePage(
  parent: MessageParent,
  pageParam: MessageTimelinePageParam | null,
  around: string | null,
  window: ReturnType<typeof cachedTimelinePage>,
  fetchMessageTimelinePage: FetchTimelinePage
): Promise<MessageTimelinePage> {
  const first = await fetchMessageTimelinePage(parent, pageParam, around);
  const cached = window?.page;
  if (!cached?.entries.length) return first;
  const pages = [first];
  let next = first.next_cursor;
  let previous = first.previous_cursor;
  // Every cached page retains its chronological bounds, including historical
  // and centered pages. New facts cannot evict the reader's oldest loaded row.
  while (
    next &&
    (!cached.next_cursor ||
      compareTimelinePositions(
        cursorPosition(next),
        cursorPosition(cached.next_cursor)
      ) > 0)
  ) {
    const page = await fetchMessageTimelinePage(
      parent,
      { next_cursor: next, previous_cursor: null },
      null
    );
    if (sameCursor(page.next_cursor, next))
      throw new Error('Timeline cursor did not advance');
    pages.push(page);
    next = page.next_cursor;
  }
  while (
    previous &&
    !(window?.upperExclusive && pageParam?.next_cursor) &&
    (!cached.previous_cursor ||
      compareTimelinePositions(
        cursorPosition(previous),
        cursorPosition(cached.previous_cursor)
      ) < 0)
  ) {
    const page = await fetchMessageTimelinePage(
      parent,
      { next_cursor: null, previous_cursor: previous },
      null
    );
    if (sameCursor(page.previous_cursor, previous))
      throw new Error('Timeline cursor did not advance');
    pages.push(page);
    previous = page.previous_cursor;
  }
  return {
    entries: reconcileTimelineEntries(
      [],
      pages
        .flatMap((page) => page.entries)
        .filter((entry) =>
          entryWithinPage(entry, cached, window?.upperExclusive)
        )
    ),
    next_cursor: cached.next_cursor,
    previous_cursor: cached.previous_cursor,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTimelineData(value: unknown): value is MessageTimelineData {
  return (
    isRecord(value) &&
    Array.isArray(value.pages) &&
    Array.isArray(value.pageParams) &&
    value.pages.every((page) => isRecord(page) && Array.isArray(page.entries))
  );
}

/** Keep writes already in flight before a read, including removals absent from cache. */
function pendingTimelineRoots(
  parent: MessageParent,
  before: MessageTimelineData | undefined
) {
  const roots = new Set<string>();
  for (const mutation of queryClient
    .getMutationCache()
    .findAll({ mutationKey: messageMutationKey, status: 'pending' })) {
    const variables = mutation.state.variables;
    if (
      !isRecord(variables) ||
      !isRecord(variables.parent) ||
      variables.parent.type !== parent.type ||
      variables.parent.id !== parent.id
    )
      continue;
    const context = mutation.state.context;
    const target =
      isRecord(context) &&
      (isRecord(context.target)
        ? context.target
        : isRecord(context.insert) && isRecord(context.insert.target)
          ? context.insert.target
          : undefined);
    if (!target || typeof target.messageId !== 'string') continue;
    if (target.kind === 'thread_reply' && typeof target.threadId === 'string')
      roots.add(target.threadId);
    else {
      const root = before?.pages
        .flatMap(timelineMessages)
        .find((message) =>
          message.thread.preview.some((reply) => reply.id === target.messageId)
        );
      roots.add(root?.id ?? target.messageId);
    }
  }
  return roots;
}

type TimelineReadSnapshot = {
  before: MessageTimelineData | undefined;
  pending: Set<string>;
};

/** Reconcile at query commit, after every page has finished reading. */
function reconcileTimelineRead(
  previous: MessageTimelineData | undefined,
  result: MessageTimelineData,
  snapshot: TimelineReadSnapshot
): MessageTimelineData {
  const entries = reconcileTimelineRefresh(
    snapshot.before?.pages.flatMap((page) => page.entries) ?? [],
    result.pages.flatMap((page) => page.entries),
    previous?.pages.flatMap((page) => page.entries) ?? [],
    snapshot.pending
  );
  return { ...result, pages: distributeTimelineEntries(result.pages, entries) };
}

/** Reuse page bounds when optimistic acknowledgement changes an entry's position. */
export function distributeTimelineEntries(
  source: MessageTimelinePage[],
  entries: MessageTimelineEntry[]
) {
  const pages: MessageTimelinePage[] = source.map((page) => ({
    ...page,
    entries: [],
  }));
  for (const entry of entries) {
    const index = pageIndexForEntry(pages, entry);
    if (index !== -1) pages[index].entries.push(entry);
  }
  return pages;
}

/** Place live facts within the already loaded chronological span. */
export function pageIndexForEntry(
  pages: MessageTimelinePage[],
  entry: MessageTimelineEntry
) {
  const position = timelineEntryPosition(entry);
  if (
    !pages.length ||
    (pages[0].previous_cursor &&
      compareTimelinePositions(
        position,
        cursorPosition(pages[0].previous_cursor)
      ) > 0)
  )
    return -1;
  return pages.findIndex(
    (page) =>
      !page.next_cursor ||
      compareTimelinePositions(position, cursorPosition(page.next_cursor)) >= 0
  );
}
