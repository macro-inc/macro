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

export type ChannelMessagesData = InfiniteData<
  ChannelMessagesPage,
  ChannelMessagesPageParam | null
>;

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
  const byId = createMemo(() => {
    const flat = flattenMessages(query.data as ChannelMessagesData | undefined);
    return new Map(flat.map((m) => [m.id, m]));
  });
  return { query, byId };
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

export function insertThreadReplyIntoChannelMessages(
  data: ChannelMessagesData | undefined,
  threadId: string,
  reply: ApiThreadReply
): ChannelMessagesData | undefined {
  if (!data) return data;

  return mapChannelMessagesItems(data, (message) => {
    if (message.id !== threadId) return message;
    if (message.thread.preview.some((preview) => preview.id === reply.id)) {
      return message;
    }

    return {
      ...message,
      thread: {
        ...message.thread,
        latest_reply_at: reply.created_at,
        reply_count: message.thread.reply_count + 1,
        preview: [...message.thread.preview, reply],
      },
    };
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
    const nextPreview = message.thread.preview.filter(
      (reply) => reply.id !== replyId
    );
    if (nextPreview.length === message.thread.preview.length) {
      return message;
    }

    return {
      ...message,
      thread: {
        ...message.thread,
        latest_reply_at: nextPreview.at(-1)?.created_at ?? null,
        reply_count: Math.max(message.thread.reply_count - 1, 0),
        preview: nextPreview,
      },
    };
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

    let didChange = false;
    const preview = message.thread.preview.map((reply) => {
      if (reply.id !== optimisticId) return reply;
      didChange = true;
      return { ...reply, id: realId };
    });

    if (!didChange) return message;

    return {
      ...message,
      thread: {
        ...message.thread,
        preview,
      },
    };
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

    let didChange = false;
    const preview = message.thread.preview.map((reply) => {
      if (reply.id !== replyId) return reply;
      didChange = true;
      return { ...reply, reactions };
    });

    if (!didChange) return message;

    return {
      ...message,
      thread: {
        ...message.thread,
        preview,
      },
    };
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
 * Flatten all pages into a single oldest-first array for display.
 * Pages arrive newest-first, items within each page are newest-first,
 * so we reverse both layers.
 */
export function flattenMessages(
  data: ChannelMessagesData | undefined
): ApiChannelMessage[] {
  if (!data?.pages?.length) return [];
  const all: ApiChannelMessage[] = [];
  for (let i = data.pages.length - 1; i >= 0; i--) {
    const items = data.pages[i].items;
    for (let j = items.length - 1; j >= 0; j--) {
      all.push(items[j]);
    }
  }
  return all;
}
