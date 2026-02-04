import type { BlockName } from '../block';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import { optimisticUpdateDssItemViewedAt } from '@macro-entity';
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
export function track(
  itemId: string,
  blockName: BlockName,
  client: Accessor<QueryClient>
) {
  const itemType = blockNameToItemType(blockName);

  optimisticUpdateDssItemViewedAt(itemId);

  if (!isCloudStorageItem(itemType)) return;

  const upsertToHistoryMutation = useUpsertToHistoryMutation(undefined, client);
  upsertToHistoryMutation.mutate({ itemId, itemType });
}
