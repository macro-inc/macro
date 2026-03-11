import { throwOnErr } from '@core/util/maybeResult';
import {
  commsServiceClient,
  type ApiChannelMessage,
  type ApiThreadReply,
  type ChannelMessagesPage,
} from '@service-comms/client';
import { type InfiniteData, useInfiniteQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import type { ApiCountedReaction } from '@service-storage/generated/schemas';
import { queryClient } from '../client';
import { channelKeys } from './keys';
import {
  captureThreadPreviewReplySnapshot,
  insertReplyIntoThreadPreview,
  removeReplyFromThreadPreview,
  replaceReplyIdInThreadPreview,
  replaceReplyReactionsInThreadPreview,
  restoreReplyToThreadPreview,
} from './thread-preview';

export type ChannelMessagesData = InfiniteData<
  ChannelMessagesPage,
  ChannelMessagesPageParam | null
>;

export type IndexedChannelMessages = {
  items: ApiChannelMessage[];
  keys: string[];
  byId: Map<string, ApiChannelMessage>;
};

export type TopLevelMessageSnapshot = {
  itemIndex: number;
  message: ApiChannelMessage;
  pageIndex: number;
};

export type ThreadPreviewReplySnapshot = {
  previewIndex: number;
  reply: ApiThreadReply;
};

type ChannelMessagesPageParam = {
  next_cursor: string | null;
  previous_cursor: string | null;
};

export function channelMessagesQueryOptions(
  channelId: string,
  loadAroundMessageId: string | null
) {
  return {
    queryKey: channelKeys.messages(channelId).queryKey,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: ChannelMessagesPageParam | null;
    }) => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.getChannelMessages({
            channel_id: channelId,
            limit: 100,
            next_cursor: pageParam?.next_cursor ?? null,
            previous_cursor: pageParam?.previous_cursor ?? null,
            load_around_message_id: !pageParam ? loadAroundMessageId : null,
          })
      );
    },
    initialPageParam: null as ChannelMessagesPageParam | null,
    getNextPageParam: (lastPage: ChannelMessagesPage) =>
      lastPage.next_cursor
        ? {
            next_cursor: lastPage.next_cursor,
            previous_cursor: null,
          }
        : null,
    getPreviousPageParam: (firstPage: ChannelMessagesPage) =>
      firstPage.previous_cursor
        ? {
            next_cursor: null,
            previous_cursor: firstPage.previous_cursor,
          }
        : null,
    staleTime: Infinity,
  };
}

export function useChannelMessagesQuery(
  channelId: Accessor<string>,
  loadAroundMessageId: Accessor<string | null | undefined>
) {
  return useInfiniteQuery(() =>
    channelMessagesQueryOptions(channelId(), loadAroundMessageId() ?? null)
  );
}

export function useChannelMessagesWithIndex(channelId: Accessor<string>) {
  const query = useChannelMessagesQuery(channelId, () => undefined);
  const index = createMemo(() =>
    makeMessageIndex(query.data as ChannelMessagesData | undefined)
  );
  return {
    query,
    index,
    byId: createMemo(() => index().byId),
  };
}

function mapChannelMessagesItems(
  data: ChannelMessagesData,
  updater: (message: ApiChannelMessage) => ApiChannelMessage
): ChannelMessagesData {
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

function filterChannelMessagesItems(
  data: ChannelMessagesData,
  predicate: (message: ApiChannelMessage) => boolean
): ChannelMessagesData {
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

export function insertTopLevelMessageIntoChannelMessages(
  data: ChannelMessagesData | undefined,
  message: ApiChannelMessage
): ChannelMessagesData | undefined {
  if (!data?.pages.length) return data;
  if (
    data.pages.some((page) => page.items.some((item) => item.id === message.id))
  ) {
    return data;
  }

  const [newestPage, ...olderPages] = data.pages;

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

export function removeTopLevelMessageFromChannelMessages(
  data: ChannelMessagesData | undefined,
  messageId: string
): ChannelMessagesData | undefined {
  if (!data) return data;

  return filterChannelMessagesItems(
    data,
    (message) => message.id !== messageId
  );
}

export function replaceTopLevelMessageIdInChannelMessages(
  data: ChannelMessagesData | undefined,
  optimisticId: string,
  realId: string
): ChannelMessagesData | undefined {
  if (!data) return data;

  return mapChannelMessagesItems(data, (message) =>
    message.id === optimisticId ? { ...message, id: realId } : message
  );
}

export function replaceTopLevelMessageReactionsInChannelMessages(
  data: ChannelMessagesData | undefined,
  messageId: string,
  reactions: ApiCountedReaction[]
): ChannelMessagesData | undefined {
  if (!data) return data;

  return mapChannelMessagesItems(data, (message) =>
    message.id === messageId ? { ...message, reactions } : message
  );
}

export function getTopLevelMessageSnapshot(
  data: ChannelMessagesData | undefined,
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

export function restoreTopLevelMessageInChannelMessages(
  data: ChannelMessagesData | undefined,
  snapshot: TopLevelMessageSnapshot
): ChannelMessagesData | undefined {
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

export function insertThreadReplyIntoChannelMessages(
  data: ChannelMessagesData | undefined,
  threadId: string,
  reply: ApiThreadReply
): ChannelMessagesData | undefined {
  if (!data) return data;

  return mapChannelMessagesItems(data, (message) => {
    if (message.id !== threadId) return message;
    const thread = insertReplyIntoThreadPreview(message.thread, reply);
    return thread === message.thread ? message : { ...message, thread };
  });
}

export function removeThreadReplyFromChannelMessages(
  data: ChannelMessagesData | undefined,
  threadId: string,
  replyId: string
): ChannelMessagesData | undefined {
  if (!data) return data;

  return mapChannelMessagesItems(data, (message) => {
    if (message.id !== threadId) return message;
    const thread = removeReplyFromThreadPreview(message.thread, replyId);
    return thread === message.thread ? message : { ...message, thread };
  });
}

export function replaceThreadReplyIdInChannelMessages(
  data: ChannelMessagesData | undefined,
  threadId: string,
  optimisticId: string,
  realId: string
): ChannelMessagesData | undefined {
  if (!data) return data;

  return mapChannelMessagesItems(data, (message) => {
    if (message.id !== threadId) return message;
    const thread = replaceReplyIdInThreadPreview(
      message.thread,
      optimisticId,
      realId
    );
    return thread === message.thread ? message : { ...message, thread };
  });
}

export function replaceThreadReplyReactionsInChannelMessages(
  data: ChannelMessagesData | undefined,
  threadId: string,
  replyId: string,
  reactions: ApiCountedReaction[]
): ChannelMessagesData | undefined {
  if (!data) return data;

  return mapChannelMessagesItems(data, (message) => {
    if (message.id !== threadId) return message;
    const thread = replaceReplyReactionsInThreadPreview(
      message.thread,
      replyId,
      reactions
    );
    return thread === message.thread ? message : { ...message, thread };
  });
}

export function getThreadPreviewReplySnapshot(
  data: ChannelMessagesData | undefined,
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

export function restoreThreadPreviewReplyInChannelMessages(
  data: ChannelMessagesData | undefined,
  threadId: string,
  snapshot?: ThreadPreviewReplySnapshot,
  replyCreatedAt?: string
): ChannelMessagesData | undefined {
  if (!data) return data;

  return mapChannelMessagesItems(data, (message) => {
    if (message.id !== threadId) return message;
    const thread = restoreReplyToThreadPreview(
      message.thread,
      snapshot,
      replyCreatedAt
    );
    return thread === message.thread ? message : { ...message, thread };
  });
}

/**
 * Marks the channel messages query as stale without triggering an immediate refetch.
 */
export function softInvalidateChannelMessages(channelId: string) {
  queryClient.invalidateQueries({
    queryKey: channelKeys.messages(channelId).queryKey,
    refetchType: 'inactive',
  });
}

/**
 * Build a single oldest-first message index for display and lookup.
 * Pages arrive newest-first, items within each page are newest-first,
 * so we reverse both layers in one pass.
 */
export function makeMessageIndex(
  data: ChannelMessagesData | undefined
): IndexedChannelMessages {
  const items: ApiChannelMessage[] = [];
  const keys: string[] = [];
  const byId = new Map<string, ApiChannelMessage>();

  if (!data?.pages?.length) return { items, keys, byId };

  for (let i = data.pages.length - 1; i >= 0; i--) {
    const pageItems = data.pages[i].items;
    for (let j = pageItems.length - 1; j >= 0; j--) {
      const message = pageItems[j];
      items.push(message);
      keys.push(message.id);
      byId.set(message.id, message);
    }
  }

  return { items, keys, byId };
}
