import { throwOnErr } from '@core/util/maybeResult';
import {
  commsServiceClient,
  type ApiChannelMessage,
  type ChannelMessagesPage,
} from '@service-comms/client';
import { type InfiniteData, useInfiniteQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { queryClient } from '../client';
import { channelKeys } from './keys';

export type ChannelMessagesData = InfiniteData<
  ChannelMessagesPage,
  string | null
>;

export function channelMessagesQueryOptions(channelId: string) {
  return {
    queryKey: channelKeys.messages(channelId).queryKey,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.getChannelMessages({
            channel_id: channelId,
            limit: 100,
            cursor: pageParam,
          })
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ChannelMessagesPage) =>
      lastPage.next_cursor ?? null,
    staleTime: Infinity,
  };
}

export function useChannelMessagesQuery(channelId: Accessor<string>) {
  return useInfiniteQuery(() => channelMessagesQueryOptions(channelId()));
}
export function useChannelMessagesWithIndex(channelId: Accessor<string>) {
  const query = useChannelMessagesQuery(channelId);
  const byId = createMemo(() => {
    const flat = flattenMessages(query.data as ChannelMessagesData | undefined);
    return new Map(flat.map((m) => [m.id, m]));
  });
  return { query, byId };
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
