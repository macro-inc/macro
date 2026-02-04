import { DEFAULT_ITEM_TYPE } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor, Setter } from 'solid-js';
import { createMemo } from 'solid-js';
import { queryClient } from '../client';
import { previewDataLoader } from './dataloader';
import { defaultNameTransform, fetchMessageContext } from './fetchers';
import { previewKeys } from './keys';
import type { ItemEntity, PreviewItem } from './types';
import { queryReadyGate } from '@queries/gate';

export function useItemPreview(item: Accessor<ItemEntity>) {
  const previewQuery = useQuery(() => ({
    queryKey: previewKeys.item(item().id).queryKey,
    queryFn: () => previewDataLoader.load(item()),
    staleTime: 60 * 1000 * 60 * 24, // 24 hours
  }));

  const maybeChannelMessageQuery = useQuery(() => {
    const item_ = item();
    const messageId = item_.type === 'channel' ? item_.messageId : undefined;
    return {
      queryKey: previewKeys.item(item().id)._ctx.channelMessage(messageId!)
        .queryKey,
      queryFn: () => fetchMessageContext(messageId!),
      staleTime: 60 * 1000 * 60 * 24, // 24 hours
      enabled: !!messageId && previewQuery.isSuccess,
    };
  });

  const preview = createMemo(() => {
    const data = queryReadyGate(previewQuery) ? previewQuery.data : undefined;
    const channelMessageData = queryReadyGate(maybeChannelMessageQuery)
      ? maybeChannelMessageQuery.data
      : undefined;

    if (!data) {
      return {
        loading: true,
        id: item().id,
        type: item().type ?? DEFAULT_ITEM_TYPE,
      } as PreviewItem;
    }
    const dataWithName = defaultNameTransform(data);
    if (channelMessageData) {
      return {
        ...dataWithName,
        messageContext: channelMessageData,
      };
    }
    return dataWithName;
  });

  return [preview] as const;
}

/** Invalidate preview for the given item id. if no id is provided, invalidates all previews */
export function invalidatePreview(itemId?: string) {
  if (!itemId)
    return queryClient.invalidateQueries({
      queryKey: previewKeys._def,
    });
  return queryClient.invalidateQueries({
    queryKey: previewKeys.item(itemId).queryKey,
  });
}

/** Directly update preview data in the cache without refetching */
export function setPreviewData(itemId: string, updater: Setter<PreviewItem>) {
  return queryClient.setQueryData<PreviewItem>(
    previewKeys.item(itemId).queryKey,
    updater
  );
}
