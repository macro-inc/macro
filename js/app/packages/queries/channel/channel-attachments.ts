import { throwOnErr } from '@core/util/maybeResult';
import {
  commsServiceClient,
  type ApiChannelAttachment,
  type ChannelAttachmentsPage,
} from '@service-comms/client';
import { type InfiniteData, useInfiniteQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { queryClient } from '../client';
import { channelKeys } from './keys';

export type ChannelAttachmentsData = InfiniteData<
  ChannelAttachmentsPage,
  string | null
>;

export function channelAttachmentsQueryOptions(channelId: string) {
  return {
    queryKey: channelKeys.attachments(channelId).queryKey,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.getChannelAttachments({
            channel_id: channelId,
            limit: 100,
            cursor: pageParam,
          })
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ChannelAttachmentsPage) =>
      lastPage.next_cursor ?? null,
    staleTime: Infinity,
  };
}

export function useChannelAttachmentsQuery(channelId: Accessor<string>) {
  return useInfiniteQuery(() => channelAttachmentsQueryOptions(channelId()));
}

export function useChannelAttachmentsWithIndex(channelId: Accessor<string>) {
  const query = useChannelAttachmentsQuery(channelId);
  const byId = createMemo(() => {
    const flat = flattenAttachments(
      query.data as ChannelAttachmentsData | undefined
    );
    return new Map(flat.map((a) => [a.id, a]));
  });
  return { query, byId };
}

/**
 * Flatten all pages into a single newest-first array.
 * Pages arrive newest-first, items within each page are newest-first.
 */
export function flattenAttachments(
  data: ChannelAttachmentsData | undefined
): ApiChannelAttachment[] {
  if (!data?.pages?.length) return [];
  return data.pages.flatMap((page) => page.items);
}

export function softInvalidateChannelAttachments(channelId: string) {
  queryClient.invalidateQueries({
    queryKey: channelKeys.attachments(channelId).queryKey,
    refetchType: 'inactive',
  });
}
