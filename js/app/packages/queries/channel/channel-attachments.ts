import { throwOnErr } from '@core/util/result';
import {
  type ApiChannelAttachment,
  type ChannelAttachmentsPage,
  type ChannelAttachmentType,
  storageServiceClient,
} from '@service-storage/client';
import { type InfiniteData, useInfiniteQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { queryClient } from '../client';
import { channelKeys } from './keys';

export type ChannelAttachmentsData = InfiniteData<
  ChannelAttachmentsPage,
  string | null
>;

type ChannelAttachmentsQueryKey = ReturnType<
  typeof channelKeys.attachments
>['queryKey'];

/**
 * Page size for the media (static image/video) grid. Kept modest since the grid
 * is virtualized and pulls more pages on scroll, but large enough to comfortably
 * fill the viewport on the first load.
 */
const MEDIA_PAGE_SIZE = 50;

/** Page size for the documents list. */
const DOCUMENT_PAGE_SIZE = 50;

export function channelAttachmentsQueryOptions(
  channelId: string,
  attachmentType?: ChannelAttachmentType,
  limit = 100
) {
  return {
    queryKey: channelKeys.attachments(channelId, attachmentType).queryKey,
    queryFn: async ({
      pageParam,
      signal,
    }: {
      pageParam: string | null;
      signal?: AbortSignal;
    }) => {
      return await throwOnErr(
        async () =>
          await storageServiceClient.getChannelAttachments({
            channel_id: channelId,
            limit,
            cursor: pageParam,
            attachment_type: attachmentType,
            signal,
          })
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ChannelAttachmentsPage) =>
      lastPage.next_cursor ?? undefined,
    staleTime: Infinity,
  };
}

function useChannelAttachmentsQuery(
  channelId: Accessor<string>,
  attachmentType?: Accessor<ChannelAttachmentType | undefined>,
  limit?: number
) {
  return useInfiniteQuery(() =>
    channelAttachmentsQueryOptions(channelId(), attachmentType?.(), limit)
  );
}

export function useChannelMediaAttachmentsQuery(channelId: Accessor<string>) {
  return useChannelAttachmentsQuery(channelId, () => 'static', MEDIA_PAGE_SIZE);
}

export function useChannelDocumentAttachmentsQuery(
  channelId: Accessor<string>
) {
  return useChannelAttachmentsQuery(channelId, () => 'dss', DOCUMENT_PAGE_SIZE);
}

function _useChannelAttachmentsWithIndex(channelId: Accessor<string>) {
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

export function getChannelAttachmentsQueryKey(
  channelId: string,
  attachmentType?: ChannelAttachmentType
): ChannelAttachmentsQueryKey {
  return channelKeys.attachments(channelId, attachmentType).queryKey;
}

export function getChannelAttachmentsQueryKeyPrefix(channelId: string) {
  return [...channelKeys.attachments._def, channelId];
}

function _softInvalidateChannelAttachments(channelId: string) {
  queryClient.invalidateQueries({
    queryKey: getChannelAttachmentsQueryKeyPrefix(channelId),
    refetchType: 'inactive',
  });
}
