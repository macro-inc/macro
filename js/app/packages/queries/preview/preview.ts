import { DEFAULT_ITEM_TYPE } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { createMemo } from 'solid-js';
import { queryClient } from '../client';
import { previewDataLoader } from './dataloader';
import { defaultNameTransform } from './fetchers';
import { previewKeys } from './keys';
import type { ItemEntity, PreviewItem } from './types';

const DEFAULT_CACHE_TIME_SECONDS = 60 * 10;

function previewQueryOptions(item: ItemEntity) {
  return {
    queryKey: previewKeys.item(item.id).queryKey,
    queryFn: () => previewDataLoader.load(item),
    staleTime: DEFAULT_CACHE_TIME_SECONDS * 1000,
    gcTime: DEFAULT_CACHE_TIME_SECONDS * 1000 * 2,
  };
}

export function useItemPreview(item: Accessor<ItemEntity> | ItemEntity) {
  const itemAccessor = typeof item === 'function' ? item : () => item;

  const query = useQuery(() => previewQueryOptions(itemAccessor()));

  const preview = createMemo(() => {
    const data = query.data;

    if (!data) {
      return {
        loading: true,
        id: itemAccessor().id,
        type: itemAccessor().type ?? DEFAULT_ITEM_TYPE,
      } as PreviewItem;
    }
    return defaultNameTransform(data);
  });

  const refetch = () => {
    query.refetch();
  };

  const mutate = (value: PreviewItem) => {
    queryClient.setQueryData(
      previewKeys.item(itemAccessor().id).queryKey,
      value
    );
  };

  return [preview, { refetch, mutate }] as const;
}

export function invalidatePreview(itemId: string) {
  return queryClient.invalidateQueries({
    queryKey: previewKeys.item(itemId).queryKey,
  });
}

export function setPreviewData(itemId: string, data: PreviewItem) {
  queryClient.setQueryData(previewKeys.item(itemId).queryKey, data);
}

export async function fetchAndCachePreview(
  item: ItemEntity
): Promise<PreviewItem> {
  return queryClient.fetchQuery(previewQueryOptions(item));
}
