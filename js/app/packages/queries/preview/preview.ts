import { DEFAULT_ITEM_TYPE } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { createMemo } from 'solid-js';
import { previewDataLoader } from './dataloader';
import { defaultNameTransform } from './fetchers';
import { previewKeys } from './keys';
import type { ItemEntity, PreviewItem } from './types';
import { queryReadyGate } from '@queries/gate';

export function useItemPreview(item: Accessor<ItemEntity>) {
  const query = useQuery(() => ({
    queryKey: previewKeys.item(item().id).queryKey,
    queryFn: () => previewDataLoader.load(item()),
    // TODO: we need to invalidate the cache when the item changes
    // for now let's lower the stale time
    staleTime: 60 * 1000 * 10, // 10 minutes
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
