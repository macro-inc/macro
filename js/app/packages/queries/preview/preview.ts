import { DEFAULT_ITEM_TYPE, type ItemType } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor, Setter } from 'solid-js';
import { createMemo } from 'solid-js';
import { queryClient } from '../client';
import { previewDataLoader } from './dataloader';
import { defaultNameTransform, fetchMessageContext } from './fetchers';
import { previewKeys } from './keys';
import type { ItemEntity, PreviewItem, AccessiblePreviewItem } from './types';
import { queryReadyGate } from '@queries/gate';

const PREVIEW_STALE_TIME = 60 * 1000 * 60 * 24; // 24 hours

function itemPreviewQueryOptions(item: ItemEntity) {
  return {
    queryKey: previewKeys.item(item.id).queryKey,
    queryFn: () => previewDataLoader.load(item),
    staleTime: PREVIEW_STALE_TIME,
  };
}

export async function getItemPreview(item: ItemEntity): Promise<PreviewItem> {
  const preview = await queryClient.fetchQuery(itemPreviewQueryOptions(item));
  return defaultNameTransform(preview);
}

export function useItemPreview(item: Accessor<ItemEntity>) {
  const previewQuery = useQuery(() => itemPreviewQueryOptions(item()));

  const maybeChannelMessageQuery = useQuery(() => {
    const item_ = item();
    const messageId = item_.type === 'channel' ? item_.messageId : undefined;
    return {
      queryKey: previewKeys.item(item().id)._ctx.channelMessage(messageId!)
        .queryKey,
      queryFn: () => fetchMessageContext(messageId!),
      staleTime: PREVIEW_STALE_TIME,
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

function getPreviewData(itemId: string): PreviewItem | undefined {
  return queryClient.getQueryData<PreviewItem>(
    previewKeys.item(itemId).queryKey
  );
}

/** Directly update preview data in the cache without refetching */
function setPreviewData(itemId: string, updater: Setter<PreviewItem>) {
  return queryClient.setQueryData<PreviewItem>(
    previewKeys.item(itemId).queryKey,
    updater
  );
}

export function setPreviewFileType(itemId: string, fileType: string) {
  const prev = getPreviewData(itemId);
  if (prev) return setPreviewData(itemId, (prev) => ({ ...prev, fileType }));
}

/** Sets the preview name in the cache. If the item is not in the cache,
 * we will optimistically update the name and prefetch the item. */
export function setPreviewName({
  itemId,
  name,
  itemType,
}: {
  itemId: string;
  name: string;
  itemType?: ItemType;
}) {
  const prev = getPreviewData(itemId);
  if (prev)
    return setPreviewData(itemId, (prev) => ({
      ...prev,
      rawName: name,
      name,
    }));

  if (!itemType) {
    console.warn('no preview item type provided for cache miss, using default');
  }

  let defaultPreviewItem: AccessiblePreviewItem = {
    id: itemId,
    rawName: name,
    name,
    loading: false,
    access: 'access',
    type: itemType ?? DEFAULT_ITEM_TYPE,
  };

  // if the item isn't in the cache, we can optimistically create a new item
  const res = setPreviewData(itemId, (_prev) => defaultPreviewItem);

  // invalidate the item so that we can refetch on next render
  // note that we cannot directly call the fetch here because the item name is not necessarily updated on the backend
  queryClient.invalidateQueries({
    queryKey: previewKeys.item(itemId).queryKey,
  });

  return res;
}
