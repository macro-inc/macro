import { DEFAULT_ITEM_TYPE } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { createMemo } from 'solid-js';
import { previewDataLoader } from './dataloader';
import { defaultNameTransform } from './fetchers';
import { previewKeys } from './keys';
import type { ItemEntity, PreviewItem } from './types';
import { queryReadyGate } from '@queries/gate';

const DEFAULT_CACHE_TIME_SECONDS = 60 * 10;

export function useItemPreview(item: Accessor<ItemEntity>) {
  const query = useQuery(() => ({
    queryKey: previewKeys.item(item().id).queryKey,
    queryFn: () => previewDataLoader.load(item()),
    staleTime: DEFAULT_CACHE_TIME_SECONDS * 1000,
    gcTime: DEFAULT_CACHE_TIME_SECONDS * 1000 * 2,
  }));

  const preview = createMemo(() => {
    const data = queryReadyGate(query) ? query.data : undefined;

    if (!data) {
      return {
        loading: true,
        id: item().id,
        type: item().type ?? DEFAULT_ITEM_TYPE,
      } as PreviewItem;
    }
    return defaultNameTransform(data);
  });

  return [preview] as const;
}
