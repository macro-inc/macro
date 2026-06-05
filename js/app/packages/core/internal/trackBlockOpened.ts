import { useUpsertToHistoryMutation } from '@queries/history/history';
import {
  hasSoupEntity,
  optimisticUpdateSoupItemViewedAt,
  refetchSoupEntity,
  type SoupEntityTag,
} from '@queries/soup/cache';
import {
  blockNameToItemType,
  type ItemType,
  isCloudStorageItem,
} from '@service-storage/client';
import type { QueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type { BlockName } from '../block';

function isSoupEntityTag(
  itemType: ItemType
): itemType is ItemType & SoupEntityTag {
  return match(itemType)
    .with('email', 'channel_message', 'automation', 'foreign', () => false)
    .with('document', 'chat', 'project', 'channel', 'call', () => true)
    .exhaustive();
}

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

  optimisticUpdateSoupItemViewedAt(itemId);
  const inSoup = hasSoupEntity(itemId);
  if (!inSoup && isSoupEntityTag(itemType)) {
    refetchSoupEntity(itemId, itemType);
  }

  if (!isCloudStorageItem(itemType)) return;

  const upsertToHistoryMutation = useUpsertToHistoryMutation(undefined, client);
  upsertToHistoryMutation.mutate({ itemId, itemType });
}
