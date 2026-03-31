import type { BlockName } from '../block';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import {
  hasSoupEntity,
  optimisticUpdateSoupItemViewedAt,
  refetchSoupEntity,
  type SoupEntityTag,
} from '@queries/soup/cache';
import {
  blockNameToItemType,
  isCloudStorageItem,
} from '@service-storage/client';
import type { QueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { ensureItemInRecentlyViewed } from '@queries/soup/recently-viewed';

/**
 * Tracks opening of a block and updates history accordingly.
 * We have this in a separate file to prevent cyclic dependencies.
 */
export function track({
  itemId,
  blockName,
  client,
}: {
  itemId: string;
  blockName: BlockName;
  client: Accessor<QueryClient>;
}) {
  const itemType = blockNameToItemType(blockName);

  const inSoup = hasSoupEntity(itemId);
  if (inSoup) {
    optimisticUpdateSoupItemViewedAt(itemId);
    ensureItemInRecentlyViewed(itemId);
  } else if (itemType) {
    refetchSoupEntity(itemId, itemType as SoupEntityTag).then(() => {
      ensureItemInRecentlyViewed(itemId);
    });
  }

  if (!isCloudStorageItem(itemType)) return;

  const upsertToHistoryMutation = useUpsertToHistoryMutation(undefined, client);
  upsertToHistoryMutation.mutate({ itemId, itemType });
}
