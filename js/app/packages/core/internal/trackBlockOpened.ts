import type { BlockName } from '../block';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import {
  optimisticUpdateDssItemViewedAt,
  hasSoupItem,
  invalidateSoup,
} from '@macro-entity';
import {
  blockNameToItemType,
  isCloudStorageItem,
} from '@service-storage/client';
import type { QueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

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

  const inSoup = hasSoupItem(itemId);
  if (inSoup) {
    optimisticUpdateDssItemViewedAt(itemId);
  } else {
    invalidateSoup();
  }

  if (!isCloudStorageItem(itemType)) return;

  const upsertToHistoryMutation = useUpsertToHistoryMutation(undefined, client);
  upsertToHistoryMutation.mutate({ itemId, itemType });
}
