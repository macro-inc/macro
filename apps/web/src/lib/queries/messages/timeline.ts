import { analytics } from '@app/lib/analytics';
import { compareTimelinePositions } from '@core/util/message-timeline';
import { ThrownResultError, thrownResultErrorHasCode } from '@core/util/result';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import type {
  Message as EntityMessage,
  MessageListItem,
  MessageParent,
  MessageTimelineEntry,
  MessageTimelinePage,
  TimelineActivity,
} from '@service-storage/messages';
import {
  entityMessagesClient,
  type MessageCursor,
} from '@service-storage/messages';
import {
  type InfiniteData,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/solid-query';
import { type Accessor, createEffect, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { channelKeys } from '../channel/keys';
import { queryClient } from '../client';
import { messageKeys } from './keys';
import {
  normalizeChannelMessageSender,
  normalizeMessageTimelinePageSenders,
} from './message-sender';
import { useMessageSubscription } from './subscription';
import {
  captureThreadPreviewReplySnapshot,
  insertReplyIntoThreadPreview,
  removeReplyFromThreadPreview,
  restoreReplyToThreadPreview,
} from './thread-preview';
import {
  pageIndexForEntry,
  reconcileTimelineEntries,
  timelineEntryKey,
  timelineMessages,
} from './timeline-entries';

export type MessageTimelineData = InfiniteData<
  MessageTimelinePage,
  MessageTimelinePageParam | null
>;

type MessageTimelineQueryKey = ReturnType<
  typeof messageKeys.messages
>['queryKey'];

export type TopLevelMessageSnapshot = {
  message: MessageListItem;
};

export type ThreadPreviewReplySnapshot = {
  previewIndex: number;
  reply: EntityMessage;
};

type MessageTimelinePageParam = {
  next_cursor: MessageCursor | null;
  previous_cursor: MessageCursor | null;
};

export function isMissingMessageError(error: unknown): boolean {
  return (
    error instanceof ThrownResultError &&
    error.errors.some(({ code }) => code === 'NOT_FOUND' || code === 'GONE')
  );
}

/**
 * Resolve any channel message id to its position in the channel/thread model.
 * A bare message id is ambiguous — it may be a top-level message or a thread
 * reply — and the resolution (kind + parent thread id) never changes for a
 * given message, so cache it indefinitely.
 */
export function fetchResolvedChannelMessage(
  parent: MessageParent,
  messageId: string
): Promise<{
  id: string;
  parent: MessageParent;
  kind: 'thread_reply' | 'top_level';
  thread_id: string;
  created_at: string;
}> {
  return queryClient.fetchQuery({
    queryKey: messageKeys.resolveMessage(parent, messageId).queryKey,
    queryFn: async () => {
      const message = await entityMessagesClient.get(parent, messageId);
      return {
        id: message.id,
        parent: message.parent,
        kind: message.thread_id
          ? ('thread_reply' as const)
          : ('top_level' as const),
        thread_id: message.thread_id ?? message.id,
        created_at: message.created_at,
      };
    },
    staleTime: Infinity,
  });
}

export type MessageTimelineLoadReason =
  | 'watermark'
  | 'list_ahead'
  | 'no_cache'
  | 'cache_not_at_latest'
  | 'load_around'
  | 'delta_overflow'
  | 'catch_up_error';

export type MessageTimelineWatermark =
  | { kind: 'no_cache' }
  | { kind: 'cache_not_at_latest' }
  | {
      kind: 'ready';
      after: MessageCursor;
      firstPage: MessageTimelinePage;
      listAhead: boolean;
    };

function newestRoot(items: MessageListItem[]): MessageListItem | null {
  let newest: MessageListItem | null = null;
  for (const item of items) {
    if (
      newest === null ||
      compareTimelinePositions(
        { id: item.id, createdAt: item.created_at },
        { id: newest.id, createdAt: newest.created_at }
      ) > 0
    ) {
      newest = item;
    }
  }
  return newest;
}

/**
 * Describes what a reconnecting timeline can reuse. A cache sitting at the
 * bottom of the conversation only needs the roots newer than its newest one.
 */
export function readMessageTimelineWatermark(
  parent: MessageParent
): MessageTimelineWatermark {
  const cached = queryClient.getQueryData<MessageTimelineData>(
    getMessageTimelineQueryKey(parent, null)
  );
  const firstPage = cached?.pages[0];
  if (!cached || !firstPage || firstPage.entries.length === 0) {
    return { kind: 'no_cache' };
  }
  if (cached.pageParams[0] != null || firstPage.previous_cursor) {
    return { kind: 'cache_not_at_latest' };
  }
  const messages = cached.pages.flatMap(timelineMessages);
  const newest = newestRoot(messages);
  if (!newest) {
    return { kind: 'no_cache' };
  }
  const cachedIds = new Set(messages.map((item) => item.id));
  const list =
    parent.type === 'channel'
      ? queryClient.getQueryData<ApiChannelWithLatest[]>(
          channelKeys.listChannels.queryKey
        )
      : undefined;
  const latestId = list?.find((channel) => channel.id === parent.id)
    ?.latest_non_thread_message?.message_id;
  return {
    kind: 'ready',
    after: { created_at: newest.created_at, id: newest.id },
    firstPage,
    listAhead: latestId != null && !cachedIds.has(latestId),
  };
}

export function mergeCatchUpPage(
  delta: MessageTimelinePage,
  firstPage: MessageTimelinePage
): MessageTimelinePage {
  return {
    entries: reconcileTimelineEntries(firstPage.entries, delta.entries),
    next_cursor: firstPage.next_cursor,
    previous_cursor: null,
  };
}

function trackMessageTimelineLoad(
  parent: MessageParent,
  payload: {
    path: 'catch_up' | 'full';
    reason: MessageTimelineLoadReason;
    after?: string;
  }
) {
  if (parent.type !== 'channel') return;
  analytics.track('channel_messages_load', {
    channelId: parent.id,
    ...payload,
  });
}

async function fetchMessageTimelinePage(
  parent: MessageParent,
  pageParam: MessageTimelinePageParam | null,
  loadAroundMessageId: string | null
): Promise<MessageTimelinePage> {
  const page = await entityMessagesClient.timeline(parent, {
    limit: pageParam ? 100 : 50,
    cursor: pageParam?.next_cursor ?? pageParam?.previous_cursor,
    direction: pageParam?.previous_cursor ? 'newer' : 'older',
    around: !pageParam ? loadAroundMessageId : null,
    // Annotation layout recovers missed deletions from the same document
    // roots used by Discussion, whose projection hides deleted threads.
    include_deleted_threads: parent.type === 'document',
  });
  return normalizeMessageTimelinePageSenders(page);
}

export function messageTimelineQueryOptions(
  parent: MessageParent,
  loadAroundMessageId: string | null
) {
  return {
    queryKey: messageKeys.messages(parent, loadAroundMessageId).queryKey,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: MessageTimelinePageParam | null;
    }) => {
      if (pageParam) {
        return fetchMessageTimelinePage(parent, pageParam, null);
      }
      if (loadAroundMessageId) {
        const page = await fetchMessageTimelinePage(
          parent,
          null,
          loadAroundMessageId
        );
        trackMessageTimelineLoad(parent, {
          path: 'full',
          reason: 'load_around',
        });
        return page;
      }
      // Rejoining a project must recover missed edits, reactions and deletions
      // on existing discussions. A created-at delta only includes new roots.
      if (parent.type === 'initiative') {
        return fetchMessageTimelinePage(parent, null, null);
      }
      const watermark = readMessageTimelineWatermark(parent);
      if (watermark.kind !== 'ready') {
        const page = await fetchMessageTimelinePage(parent, null, null);
        trackMessageTimelineLoad(parent, {
          path: 'full',
          reason: watermark.kind,
        });
        return page;
      }
      try {
        const delta = normalizeMessageTimelinePageSenders(
          await entityMessagesClient.timeline(parent, {
            cursor: watermark.after,
            direction: 'newer',
            limit: 50,
            include_deleted_threads: parent.type === 'document',
          })
        );
        if (delta.previous_cursor) {
          const page = await fetchMessageTimelinePage(parent, null, null);
          trackMessageTimelineLoad(parent, {
            path: 'full',
            reason: 'delta_overflow',
            after: watermark.after.created_at,
          });
          return page;
        }
        const liveFirstPage = queryClient.getQueryData<MessageTimelineData>(
          getMessageTimelineQueryKey(parent, null)
        )?.pages[0];
        const merged = mergeCatchUpPage(
          delta,
          liveFirstPage ?? watermark.firstPage
        );
        trackMessageTimelineLoad(parent, {
          path: 'catch_up',
          reason: watermark.listAhead ? 'list_ahead' : 'watermark',
          after: watermark.after.created_at,
        });
        return merged;
      } catch (error) {
        if (
          thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
          thrownResultErrorHasCode(error, 'FORBIDDEN')
        ) {
          throw error;
        }
        const page = await fetchMessageTimelinePage(parent, null, null);
        trackMessageTimelineLoad(parent, {
          path: 'full',
          reason: 'catch_up_error',
          after: watermark.after.created_at,
        });
        return page;
      }
    },
    initialPageParam: null as MessageTimelinePageParam | null,
    getNextPageParam: (lastPage: MessageTimelinePage) =>
      lastPage.next_cursor
        ? {
            next_cursor: lastPage.next_cursor,
            previous_cursor: null,
          }
        : null,
    getPreviousPageParam: (firstPage: MessageTimelinePage) =>
      firstPage.previous_cursor
        ? {
            next_cursor: null,
            previous_cursor: firstPage.previous_cursor,
          }
        : null,
    staleTime: Infinity,
    retry: (failureCount: number, error: Error) => {
      if (loadAroundMessageId && isMissingMessageError(error)) {
        return false;
      }
      if (
        thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
        thrownResultErrorHasCode(error, 'FORBIDDEN')
      ) {
        return false;
      }
      return failureCount < 1;
    },
  };
}

export function useMessageTimelineQuery(
  parent: Accessor<MessageParent>,
  loadAroundMessageId: Accessor<string | null | undefined>,
  enabled: Accessor<boolean> = () => true
) {
  useMessageSubscription(parent);
  return useInfiniteQuery(() => ({
    ...messageTimelineQueryOptions(parent(), loadAroundMessageId() ?? null),
    enabled: enabled(),
  }));
}

// Cached callbacks outlive the hook; only plain request values enter here.
function messageTimelineByIdsQueryOptions(
  parent: MessageParent,
  messageIds: string[]
) {
  return queryOptions({
    queryKey: messageKeys.messagesByIds(parent, messageIds).queryKey,
    queryFn: async (): Promise<MessageListItem[]> => {
      const page = await entityMessagesClient.list(parent, {
        ids: messageIds,
        limit: 100,
      });
      return page.items.map(normalizeChannelMessageSender);
    },
    enabled: messageIds.length > 0,
    staleTime: Infinity,
  });
}

export function useMessageTimelineByIdsQuery(
  parent: Accessor<MessageParent>,
  messageIds: Accessor<string[]>
) {
  return useQuery(() =>
    messageTimelineByIdsQueryOptions(parent(), messageIds())
  );
}

/** Returns the cache key for one channel message query variant. */
export function getMessageTimelineQueryKey(
  parent: MessageParent,
  loadAroundMessageId: string | null = null
): MessageTimelineQueryKey {
  return messageKeys.messages(parent, loadAroundMessageId).queryKey;
}

/** Returns the shared prefix for all channel message query variants. */
export function getMessageTimelineQueryKeyPrefix(parent: MessageParent) {
  return [...messageKeys.messages._def, parent];
}

/** Treat a selected root view as one page while applying the same cache operation. */
function rootPage(items: MessageListItem[]): MessageTimelineData {
  return {
    pages: [
      {
        entries: items.map((message) => ({ type: 'message', message })),
        next_cursor: null,
        previous_cursor: null,
      },
    ],
    pageParams: [null],
  };
}

/** Apply every optimistic and realtime operation to timelines and selected source roots. */
export function setMessageTimelineData(
  parent: MessageParent,
  updater: (
    data: MessageTimelineData | undefined
  ) => MessageTimelineData | undefined
) {
  queryClient.setQueriesData<MessageTimelineData>(
    { queryKey: getMessageTimelineQueryKeyPrefix(parent) },
    updater
  );
  for (const [key, items] of queryClient.getQueriesData<MessageListItem[]>({
    queryKey: getMessageTimelineByIdsQueryKeyPrefix(parent),
  })) {
    if (!items) continue;
    const selection = key.at(-1) as { messageIds: string[] };
    const next = updater(rootPage(items));
    if (next)
      queryClient.setQueryData(
        key,
        next.pages
          .flatMap(timelineMessages)
          .filter((item) => selection.messageIds.includes(item.id))
      );
  }
}

/** All rendered root views participate in lookup and rollback. */
function getMessageTimelineEntries(parent: MessageParent) {
  return [
    ...queryClient.getQueriesData<MessageTimelineData>({
      queryKey: getMessageTimelineQueryKeyPrefix(parent),
    }),
    ...queryClient
      .getQueriesData<MessageListItem[]>({
        queryKey: getMessageTimelineByIdsQueryKeyPrefix(parent),
      })
      .map(([key, items]) => [key, items && rootPage(items)] as const),
  ];
}

export function mapMessageTimelineItems(
  data: MessageTimelineData,
  updater: (message: MessageListItem) => MessageListItem
): MessageTimelineData {
  let didChange = false;

  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const entries = page.entries.map((entry) => {
      if (entry.type !== 'message') return entry;
      const message = updater(entry.message);
      if (message === entry.message) return entry;
      didChange = true;
      pageChanged = true;
      return { ...entry, message };
    });

    return pageChanged ? { ...page, entries } : page;
  });

  return didChange ? { ...data, pages } : data;
}

function filterMessageTimelineItems(
  data: MessageTimelineData,
  predicate: (message: MessageListItem) => boolean
): MessageTimelineData {
  let didChange = false;

  const pages = data.pages.map((page) => {
    const entries = page.entries.filter((entry) => {
      if (entry.type !== 'message') return true;
      const message = entry.message;
      const keep = predicate(message);
      if (!keep) didChange = true;
      return keep;
    });

    return entries.length === page.entries.length ? page : { ...page, entries };
  });

  return didChange ? { ...data, pages } : data;
}

export function insertTopLevelMessageIntoMessageTimeline(
  data: MessageTimelineData | undefined,
  message: MessageListItem
): MessageTimelineData | undefined {
  if (!data?.pages.length) return data;
  if (
    data.pages.some((page) =>
      timelineMessages(page).some((item) => item.id === message.id)
    )
  ) {
    return data;
  }

  const [newestPage, ...olderPages] = data.pages;

  // Only insert into cache entries that represent the bottom of the
  // conversation. If the newest page has a previous_cursor, we're viewing
  // a mid-conversation slice (e.g. load-around) and prepending here would
  // place the message in the wrong position — and cause duplicates when
  // fetchPreviousPage later fetches the same message from the server.
  if (newestPage.previous_cursor) {
    return data;
  }

  return {
    ...data,
    pages: [
      {
        ...newestPage,
        entries: [{ type: 'message', message }, ...newestPage.entries],
      },
      ...olderPages,
    ],
  };
}

/** Place live activity within the loaded span; later pages bring the rest. */
export function insertActivitiesIntoMessageTimeline(
  data: MessageTimelineData | undefined,
  activities: TimelineActivity[]
): MessageTimelineData | undefined {
  if (!data?.pages.length) return data;
  let pages = data.pages;
  for (const activity of activities) {
    const entry: MessageTimelineEntry = { type: 'activity', activity };
    const index = pageIndexForEntry(pages, entry);
    if (index === -1) continue;
    pages = pages.map((page, pageIndex) =>
      pageIndex === index
        ? { ...page, entries: reconcileTimelineEntries(page.entries, [entry]) }
        : page
    );
  }
  return pages === data.pages ? data : { ...data, pages };
}

export function removeTopLevelMessageFromMessageTimeline(
  data: MessageTimelineData | undefined,
  messageId: string
): MessageTimelineData | undefined {
  if (!data) return data;

  return filterMessageTimelineItems(
    data,
    (message) => message.id !== messageId
  );
}

function getTopLevelMessageSnapshot(
  data: MessageTimelineData | undefined,
  messageId: string
): TopLevelMessageSnapshot | undefined {
  if (!data) return;

  for (const page of data.pages) {
    const entry = page.entries.find(
      (entry) => entry.type === 'message' && entry.message.id === messageId
    );
    if (entry?.type !== 'message') continue;
    return { message: entry.message };
  }
}

export function restoreTopLevelMessageInMessageTimeline(
  data: MessageTimelineData | undefined,
  snapshot: TopLevelMessageSnapshot
): MessageTimelineData | undefined {
  if (!data) return data;
  if (
    data.pages.some((page) =>
      timelineMessages(page).some(
        (message) => message.id === snapshot.message.id
      )
    )
  ) {
    return data;
  }

  const entry: MessageTimelineEntry = {
    type: 'message',
    message: snapshot.message,
  };
  const pageIndex = pageIndexForEntry(data.pages, entry);
  if (pageIndex === -1) return data;

  return {
    ...data,
    pages: data.pages.map((page, index) =>
      index === pageIndex
        ? { ...page, entries: reconcileTimelineEntries(page.entries, [entry]) }
        : page
    ),
  };
}

export function insertThreadReplyIntoMessageTimeline(
  data: MessageTimelineData | undefined,
  threadId: string,
  reply: EntityMessage
): MessageTimelineData | undefined {
  if (!data) return data;

  return mapMessageTimelineItems(data, (message) => {
    if (message.id !== threadId) return message;
    const thread = insertReplyIntoThreadPreview(message.thread, reply);
    return thread === message.thread ? message : { ...message, thread };
  });
}

export function removeThreadReplyFromMessageTimeline(
  data: MessageTimelineData | undefined,
  threadId: string,
  replyId: string
): MessageTimelineData | undefined {
  if (!data) return data;

  return mapMessageTimelineItems(data, (message) => {
    if (message.id !== threadId) return message;
    const thread = removeReplyFromThreadPreview(message.thread, replyId);
    return thread === message.thread ? message : { ...message, thread };
  });
}

function getThreadPreviewReplySnapshot(
  data: MessageTimelineData | undefined,
  threadId: string,
  replyId: string
): ThreadPreviewReplySnapshot | undefined {
  if (!data) return;

  for (const page of data.pages) {
    const thread = timelineMessages(page).find(
      (message) => message.id === threadId
    )?.thread;
    if (!thread) continue;
    const snapshot = captureThreadPreviewReplySnapshot(thread, replyId);
    if (snapshot) return snapshot;
  }
}

export function restoreThreadPreviewReplyInMessageTimeline(
  data: MessageTimelineData | undefined,
  threadId: string,
  snapshot?: ThreadPreviewReplySnapshot,
  replyCreatedAt?: string
): MessageTimelineData | undefined {
  if (!data) return data;

  return mapMessageTimelineItems(data, (message) => {
    if (message.id !== threadId) return message;
    const thread = restoreReplyToThreadPreview(
      message.thread,
      snapshot,
      replyCreatedAt
    );
    return thread === message.thread ? message : { ...message, thread };
  });
}

/** Finds a top-level message across all cached variants for a channel. */
export function findTopLevelMessageInMessageTimeline(
  parent: MessageParent,
  messageId: string
): MessageListItem | undefined {
  for (const [, data] of getMessageTimelineEntries(parent)) {
    if (!data) continue;
    for (const page of data.pages) {
      const message = timelineMessages(page).find(
        (item) => item.id === messageId
      );
      if (message) return message;
    }
  }
}

/** Finds a reply's parent thread id from cached channel messages. */
export function findThreadIdInMessageTimeline(
  parent: MessageParent,
  replyId: string
): string | undefined {
  for (const [, data] of getMessageTimelineEntries(parent)) {
    if (!data) continue;
    for (const page of data.pages) {
      for (const message of timelineMessages(page)) {
        if (message.thread.preview.some((reply) => reply.id === replyId)) {
          return message.id;
        }
      }
    }
  }
}

/** Finds a top-level rollback snapshot across cached message variants. */
export function findTopLevelMessageSnapshotInMessageTimeline(
  parent: MessageParent,
  messageId: string
): TopLevelMessageSnapshot | undefined {
  for (const [, data] of getMessageTimelineEntries(parent)) {
    const snapshot = getTopLevelMessageSnapshot(data, messageId);
    if (snapshot) return snapshot;
  }
}

/** Finds a thread preview rollback snapshot across cached message variants. */
export function findThreadPreviewReplySnapshotInMessageTimeline(
  parent: MessageParent,
  threadId: string,
  replyId: string
): ThreadPreviewReplySnapshot | undefined {
  for (const [, data] of getMessageTimelineEntries(parent)) {
    const snapshot = getThreadPreviewReplySnapshot(data, threadId, replyId);
    if (snapshot) return snapshot;
  }
}

/**
 * Marks the channel messages query as stale without triggering an immediate refetch.
 */
export function softInvalidateMessageTimeline(parent: MessageParent) {
  queryClient.invalidateQueries({
    queryKey: getMessageTimelineQueryKeyPrefix(parent),
    refetchType: 'inactive',
  });
}

/** Returns the shared prefix for all by-ids message queries in a channel. */
function getMessageTimelineByIdsQueryKeyPrefix(parent: MessageParent) {
  return [...messageKeys.messagesByIds._def, parent];
}

export function softInvalidateMessageTimelineByIds(parent: MessageParent) {
  queryClient.invalidateQueries({
    queryKey: getMessageTimelineByIdsQueryKeyPrefix(parent),
    refetchType: 'inactive',
  });
}

/**
 * Build a single oldest-first timeline index for display and lookup.
 * Pages arrive newest-first, entries within each page are newest-first,
 * so we reverse both layers in one pass.
 */
/** The rows a timeline renders, oldest first, from its cached pages. */
export function buildMessageIndex(pages: MessageTimelinePage[] | undefined) {
  /**
   * New objects carrying their row key as `id`, so `reconcile` pairs each
   * entry with its own previous copy. Without an `id` it pairs by position
   * and writes one entry's fields into another, which are the query cache's
   * own objects.
   */
  const entries: (MessageTimelineEntry & { id: string })[] = [];
  /** Every rendered row, messages and activity. */
  const entryKeys: string[] = [];
  /** Message ids only: selection and navigation skip activity. */
  const keys: string[] = [];
  const byId = new Map<string, MessageListItem>();
  const activityByKey = new Map<string, TimelineActivity>();

  if (!pages?.length) return { entries, entryKeys, keys, byId, activityByKey };

  const seen = new Set<string>();
  for (let i = pages.length - 1; i >= 0; i--) {
    const pageEntries = pages[i].entries;
    for (let j = pageEntries.length - 1; j >= 0; j--) {
      const entry = pageEntries[j];
      const key = timelineEntryKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ ...entry, id: key });
      entryKeys.push(key);
      if (entry.type === 'activity') {
        activityByKey.set(key, entry.activity);
        continue;
      }
      keys.push(key);
      byId.set(key, entry.message);
    }
  }

  return { entries, entryKeys, keys, byId, activityByKey };
}

/** A reactive index over a timeline query's cached pages. */
export function createMessageIndex(
  data: Accessor<MessageTimelineData | undefined>
) {
  const [messageIndex, setMessageIndex] = createStore(
    buildMessageIndex(data()?.pages)
  );

  createEffect(
    on(data, () => {
      // The underlying query can briefly emit undefined data during a refetch
      if (!data()) {
        return;
      }
      setMessageIndex(reconcile(buildMessageIndex(data()?.pages)));
    })
  );

  return messageIndex;
}

export function invalidateMessageTimeline(parent: MessageParent) {
  return queryClient.invalidateQueries({
    queryKey: getMessageTimelineQueryKeyPrefix(parent),
  });
}
