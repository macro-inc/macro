import { analytics } from '@app/lib/analytics';
import { compareTimelinePositions } from '@core/util/message-timeline';
import { ThrownResultError, thrownResultErrorHasCode } from '@core/util/result';
import type {
  Message as EntityMessage,
  MessageListItem,
  MessageParent,
  MessageTimelineEntry,
  MessageTimelinePage,
} from '@service-storage/messages';
import {
  entityMessagesClient,
  type MessageCursor,
} from '@service-storage/messages';
import { useInfiniteQuery, useQuery } from '@tanstack/solid-query';
import { type Accessor, createEffect, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
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
  replaceReplyIdInThreadPreview,
  restoreReplyToThreadPreview,
} from './thread-preview';
import {
  reconcileTimelineEntries,
  timelineEntryKey,
  timelineMessages,
} from './timeline-entries';

import {
  createChannelTimelineReader,
  distributeTimelineEntries,
  type MessageTimelineData,
  type MessageTimelinePageParam,
  pageIndexForEntry,
} from './timeline-refresh';

export type { MessageTimelineData } from './timeline-refresh';

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

type MessageTimelineLoadReason = 'activity_refresh' | 'load_around';

type DocumentTimelineWatermark =
  | { kind: 'no_cache' }
  | { kind: 'cache_not_at_latest' }
  | {
      kind: 'ready';
      after: MessageCursor;
      firstPage: MessageTimelinePage;
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
function readDocumentTimelineWatermark(
  parent: MessageParent
): DocumentTimelineWatermark {
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
  const newest = newestRoot(cached.pages.flatMap(timelineMessages));
  if (!newest) {
    return { kind: 'no_cache' };
  }
  return {
    kind: 'ready',
    after: { created_at: newest.created_at, id: newest.id },
    firstPage,
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
  reason: MessageTimelineLoadReason
) {
  if (parent.type !== 'channel') return;
  analytics.track('channel_messages_load', {
    channelId: parent.id,
    path: 'full',
    reason,
  });
}

async function fetchMessageTimelinePage(
  parent: MessageParent,
  pageParam: MessageTimelinePageParam | null,
  loadAroundMessageId: string | null
): Promise<MessageTimelinePage> {
  const page = await entityMessagesClient.list(parent, {
    limit: pageParam ? 100 : 50,
    cursor: pageParam?.next_cursor ?? pageParam?.previous_cursor,
    direction: pageParam?.previous_cursor ? 'newer' : 'older',
    around: !pageParam ? loadAroundMessageId : null,
    // Annotation layout recovers missed deletions from the same document
    // roots used by Discussion, whose projection hides deleted threads.
    include_deleted_threads: parent.type === 'document',
    include_activity: parent.type === 'channel',
  });
  return normalizeMessageTimelinePageSenders(page);
}

export function messageTimelineQueryOptions(
  parent: MessageParent,
  loadAroundMessageId: string | null
) {
  const channelReader = createChannelTimelineReader(
    parent,
    loadAroundMessageId,
    fetchMessageTimelinePage
  );
  return {
    queryKey: messageKeys.messages(parent, loadAroundMessageId).queryKey,
    persister: parent.type === 'channel' ? channelReader.persister : undefined,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: MessageTimelinePageParam | null;
    }) => {
      if (parent.type === 'channel') {
        const page = await channelReader.queryFn({ pageParam });
        trackMessageTimelineLoad(
          parent,
          loadAroundMessageId ? 'load_around' : 'activity_refresh'
        );
        return page;
      }
      if (pageParam || loadAroundMessageId)
        return fetchMessageTimelinePage(parent, pageParam, loadAroundMessageId);
      const watermark = readDocumentTimelineWatermark(parent);
      if (watermark.kind !== 'ready')
        return fetchMessageTimelinePage(parent, null, null);
      try {
        const delta = normalizeMessageTimelinePageSenders(
          await entityMessagesClient.list(parent, {
            cursor: watermark.after,
            direction: 'newer',
            limit: 50,
            include_deleted_threads: true,
          })
        );
        if (delta.previous_cursor)
          return fetchMessageTimelinePage(parent, null, null);
        const liveFirstPage = queryClient.getQueryData<MessageTimelineData>(
          getMessageTimelineQueryKey(parent, null)
        )?.pages[0];
        return mergeCatchUpPage(delta, liveFirstPage ?? watermark.firstPage);
      } catch (error) {
        if (
          thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
          thrownResultErrorHasCode(error, 'FORBIDDEN')
        )
          throw error;
        return fetchMessageTimelinePage(parent, null, null);
      }
    },
    initialPageParam: null as MessageTimelinePageParam | null,
    getNextPageParam: (lastPage: MessageTimelinePage) =>
      lastPage.next_cursor
        ? { next_cursor: lastPage.next_cursor, previous_cursor: null }
        : null,
    getPreviousPageParam: (firstPage: MessageTimelinePage) =>
      firstPage.previous_cursor
        ? { next_cursor: null, previous_cursor: firstPage.previous_cursor }
        : null,
    staleTime: Infinity,
    retry: (failureCount: number, error: Error) => {
      if (loadAroundMessageId && isMissingMessageError(error)) return false;
      if (
        thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
        thrownResultErrorHasCode(error, 'FORBIDDEN')
      )
        return false;
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

export function useMessageTimelineByIdsQuery(
  parent: Accessor<MessageParent>,
  messageIds: Accessor<string[]>
) {
  return useQuery(() => {
    const resolvedParent = parent();
    const resolvedMessageIds = messageIds();
    return {
      queryKey: messageKeys.messagesByIds(resolvedParent, resolvedMessageIds)
        .queryKey,
      queryFn: async (): Promise<MessageListItem[]> => {
        const page = await entityMessagesClient.list(resolvedParent, {
          ids: resolvedMessageIds,
          limit: 100,
        });
        return timelineMessages(page).map(normalizeChannelMessageSender);
      },
      enabled: resolvedMessageIds.length > 0,
      staleTime: Infinity,
    };
  });
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
  let positionChanged = false;

  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const entries = page.entries.map((entry) => {
      if (entry.type !== 'message') return entry;
      const message = entry.message;
      const nextMessage = updater(message);
      if (nextMessage !== message) {
        didChange = true;
        pageChanged = true;
        positionChanged ||=
          nextMessage.id !== message.id ||
          nextMessage.created_at !== message.created_at;
      }
      return nextMessage === message
        ? entry
        : { ...entry, message: nextMessage };
    });

    return pageChanged ? { ...page, entries } : page;
  });

  return didChange
    ? {
        ...data,
        pages: positionChanged
          ? distributeTimelineEntries(
              pages,
              reconcileTimelineEntries(
                [],
                pages.flatMap((page) => page.entries)
              )
            )
          : pages,
      }
    : data;
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
  if (data.pages[0].previous_cursor) return data;
  if (
    data.pages.some((page) =>
      timelineMessages(page).some((item) => item.id === message.id)
    )
  ) {
    return data;
  }

  const entry: MessageTimelineEntry = { type: 'message', message };
  const index = pageIndexForEntry(data.pages, entry);
  if (index === -1) return data;

  return {
    ...data,
    pages: data.pages.map((page, pageIndex) =>
      pageIndex === index
        ? {
            ...page,
            entries: reconcileTimelineEntries(page.entries, [entry]),
          }
        : page
    ),
  };
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

export function replaceTopLevelMessageIdInMessageTimeline(
  data: MessageTimelineData | undefined,
  optimisticId: string,
  realId: string
): MessageTimelineData | undefined {
  if (!data) return data;

  return mapMessageTimelineItems(data, (message) =>
    message.id === optimisticId
      ? { ...message, id: realId, state: { ...message.state, root_id: realId } }
      : message
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

  const pageIndex = pageIndexForEntry(data.pages, {
    type: 'message',
    message: snapshot.message,
  });
  const page = data.pages[pageIndex];
  if (!page) return data;

  const entries = reconcileTimelineEntries(page.entries, [
    {
      type: 'message',
      message: snapshot.message,
    },
  ]);

  const pages = [...data.pages];
  pages[pageIndex] = {
    ...page,
    entries,
  };

  return {
    ...data,
    pages,
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

export function replaceThreadReplyIdInMessageTimeline(
  data: MessageTimelineData | undefined,
  threadId: string,
  optimisticId: string,
  realId: string
): MessageTimelineData | undefined {
  if (!data) return data;

  return mapMessageTimelineItems(data, (message) => {
    if (message.id !== threadId) return message;
    const thread = replaceReplyIdInThreadPreview(
      message.thread,
      optimisticId,
      realId
    );
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
 * Build a single oldest-first message index for display and lookup.
 * Pages arrive newest-first, items within each page are newest-first,
 * so we reverse both layers in one pass.
 */
export function createMessageIndex(
  data: Accessor<MessageTimelineData | undefined>
) {
  const buildIndex = () => {
    const data_ = data();

    const pages = data_?.pages;

    const items: MessageListItem[] = [];
    const entries: MessageTimelineEntry[] = [];
    const keys: string[] = [];
    const byId = new Map<string, MessageListItem>();

    if (!pages?.length) return { items, entries, keys, byId };

    const seen = new Set<string>();
    for (let i = pages.length - 1; i >= 0; i--) {
      const pageItems = pages[i].entries;
      for (let j = pageItems.length - 1; j >= 0; j--) {
        const entry = pageItems[j];
        const key = timelineEntryKey(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
        if (entry.type !== 'message') continue;
        const message = entry.message;
        items.push(message);
        keys.push(message.id);
        byId.set(message.id, message);
      }
    }

    return { items, entries, keys, byId };
  };

  const [messageIndex, setMessageIndex] = createStore(buildIndex());

  createEffect(
    on(data, () => {
      const next = buildIndex();
      // The underlying query can briefly emit undefined data during a refetch
      if (!data()) {
        return;
      }
      setMessageIndex(reconcile(next));
    })
  );

  return messageIndex;
}

export function invalidateMessageTimeline(parent: MessageParent) {
  return queryClient.invalidateQueries({
    queryKey: getMessageTimelineQueryKeyPrefix(parent),
  });
}
