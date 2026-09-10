import { ThrownResultError, thrownResultErrorHasCode } from '@core/util/result';
import type {
  Message as EntityMessage,
  MessageListItem,
  MessageParent,
  MessageTimelinePage,
} from '@service-storage/messages';
import {
  entityMessagesClient,
  type MessageCursor,
} from '@service-storage/messages';
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/solid-query';
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

export type MessageTimelineData = InfiniteData<
  MessageTimelinePage,
  MessageTimelinePageParam | null
>;

type MessageTimelineQueryKey = ReturnType<
  typeof messageKeys.messages
>['queryKey'];

export type TopLevelMessageSnapshot = {
  itemIndex: number;
  message: MessageListItem;
  pageIndex: number;
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
      const page = await entityMessagesClient.list(parent, {
        limit: pageParam ? 100 : 50,
        cursor: pageParam?.next_cursor ?? pageParam?.previous_cursor,
        direction: pageParam?.previous_cursor ? 'newer' : 'older',
        around: !pageParam ? loadAroundMessageId : null,
        // Annotation layout recovers missed deletions from the same document
        // roots used by Discussion, whose projection hides deleted threads.
        include_deleted_threads: parent.type === 'document',
      });
      return normalizeMessageTimelinePageSenders(page);
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
  loadAroundMessageId: Accessor<string | null | undefined>
) {
  useMessageSubscription(parent);
  return useInfiniteQuery(() =>
    messageTimelineQueryOptions(parent(), loadAroundMessageId() ?? null)
  );
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
        return page.items.map(normalizeChannelMessageSender);
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
    pages: [{ items, next_cursor: null, previous_cursor: null }],
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
          .flatMap((page) => page.items)
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

function mapMessageTimelineItems(
  data: MessageTimelineData,
  updater: (message: MessageListItem) => MessageListItem
): MessageTimelineData {
  let didChange = false;

  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const items = page.items.map((message) => {
      const nextMessage = updater(message);
      if (nextMessage !== message) {
        didChange = true;
        pageChanged = true;
      }
      return nextMessage;
    });

    return pageChanged ? { ...page, items } : page;
  });

  return didChange ? { ...data, pages } : data;
}

function filterMessageTimelineItems(
  data: MessageTimelineData,
  predicate: (message: MessageListItem) => boolean
): MessageTimelineData {
  let didChange = false;

  const pages = data.pages.map((page) => {
    const items = page.items.filter((message) => {
      const keep = predicate(message);
      if (!keep) didChange = true;
      return keep;
    });

    return items.length === page.items.length ? page : { ...page, items };
  });

  return didChange ? { ...data, pages } : data;
}

export function insertTopLevelMessageIntoMessageTimeline(
  data: MessageTimelineData | undefined,
  message: MessageListItem
): MessageTimelineData | undefined {
  if (!data?.pages.length) return data;
  if (
    data.pages.some((page) => page.items.some((item) => item.id === message.id))
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
        items: [message, ...newestPage.items],
      },
      ...olderPages,
    ],
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

  for (const [pageIndex, page] of data.pages.entries()) {
    const itemIndex = page.items.findIndex(
      (message) => message.id === messageId
    );
    if (itemIndex === -1) continue;
    return {
      pageIndex,
      itemIndex,
      message: page.items[itemIndex],
    };
  }
}

export function restoreTopLevelMessageInMessageTimeline(
  data: MessageTimelineData | undefined,
  snapshot: TopLevelMessageSnapshot
): MessageTimelineData | undefined {
  if (!data) return data;
  if (
    data.pages.some((page) =>
      page.items.some((message) => message.id === snapshot.message.id)
    )
  ) {
    return data;
  }

  const page = data.pages[snapshot.pageIndex];
  if (!page) return data;

  const items = [...page.items];
  items.splice(snapshot.itemIndex, 0, snapshot.message);

  const pages = [...data.pages];
  pages[snapshot.pageIndex] = {
    ...page,
    items,
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
    const thread = page.items.find(
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
      const message = page.items.find((item) => item.id === messageId);
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
      for (const message of page.items) {
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
    const keys: string[] = [];
    const byId = new Map<string, MessageListItem>();

    if (!pages?.length) return { items, keys, byId };

    const seen = new Set<string>();
    for (let i = pages.length - 1; i >= 0; i--) {
      const pageItems = pages[i].items;
      for (let j = pageItems.length - 1; j >= 0; j--) {
        const message = pageItems[j];
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        items.push(message);
        keys.push(message.id);
        byId.set(message.id, message);
      }
    }

    return { items, keys, byId };
  };

  const [messageIndex, setMessageIndex] = createStore(buildIndex());

  createEffect(
    on(data, () => {
      const next = buildIndex();
      // The underlying query can briefly emit undefined data during a refetch
      if (next.items.length === 0 && messageIndex.items.length > 0) {
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
