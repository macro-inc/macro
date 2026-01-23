import type { ItemType } from '@service-storage/client';
import { type QueryClient, createQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { previewBatcher } from './batcher';
import { defaultNameTransform } from './fetchers';
import { previewKeys } from './keys';
import type { ItemEntity, PreviewItem } from './types';

const DEFAULT_CACHE_TIME_SECONDS = 60 * 10;

function previewQueryOptions(item: ItemEntity) {
  return {
    queryKey: previewKeys.item(item.id, item.type).queryKey,
    queryFn: () => previewBatcher.add(item),
    staleTime: DEFAULT_CACHE_TIME_SECONDS * 1000,
    gcTime: DEFAULT_CACHE_TIME_SECONDS * 1000 * 2,
  };
}

export type ItemPreviewFetcher = [
  Accessor<PreviewItem>,
  {
    refetch: () => void;
    mutate: (value: PreviewItem) => void;
  },
];

export function useItemPreview(
  item: Accessor<ItemEntity> | ItemEntity,
  queryClientOverride?: Accessor<QueryClient>
): ItemPreviewFetcher {
  const itemAccessor = typeof item === 'function' ? item : () => item;

  const query = createQuery(
    () => ({
      ...previewQueryOptions(itemAccessor()),
      initialData: () => {
        const cached = queryClient.getQueryData<PreviewItem>(
          previewKeys.item(itemAccessor().id, itemAccessor().type).queryKey
        );
        return cached;
      },
      placeholderData: (prev) => prev,
    }),
    queryClientOverride
  );

  const preview = () => {
    const data = query.data;
    if (!data) {
      return {
        loading: true,
        _createdAt: new Date(),
        id: itemAccessor().id,
        type: itemAccessor().type ?? ('document' as ItemType),
      } as PreviewItem;
    }
    return defaultNameTransform(data);
  };

  const refetch = () => {
    query.refetch();
  };

  const mutate = (value: PreviewItem) => {
    queryClient.setQueryData(
      previewKeys.item(itemAccessor().id, itemAccessor().type).queryKey,
      value
    );
  };

  return [preview, { refetch, mutate }];
}

export function invalidatePreview(itemId: string, itemType?: ItemType) {
  return queryClient.invalidateQueries({
    queryKey: previewKeys.item(itemId, itemType).queryKey,
  });
}

export function setPreviewData(
  itemId: string,
  itemType: ItemType | undefined,
  data: PreviewItem
) {
  queryClient.setQueryData(previewKeys.item(itemId, itemType).queryKey, data);
}

export async function fetchAndCachePreview(
  item: ItemEntity
): Promise<PreviewItem> {
  return queryClient.fetchQuery(previewQueryOptions(item));
}
