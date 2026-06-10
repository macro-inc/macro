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
    .with(
      'email',
      'channel_message',
      'automation',
      'foreign',
      'crm_company',
      'crm_contact',
      () => false
    )
    .with('document', 'chat', 'project', 'channel', 'call', () => true)
    .exhaustive();
}

// Item types we want recorded in UserHistory on open. CRM types aren't
// CloudStorageItemType (they're not stored in document_storage), but the
// /history endpoint accepts any item_type as text and the soup's
// `viewed_updated` sort joins UserHistory generically — so writing
// these rows is what surfaces recently-opened companies/contacts in
// Quick Access and the @ mention menu.
function shouldTrackInUserHistory(itemType: ItemType): boolean {
  return (
    isCloudStorageItem(itemType) ||
    itemType === 'crm_company' ||
    itemType === 'crm_contact'
  );
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

  if (!shouldTrackInUserHistory(itemType)) return;

  const upsertToHistoryMutation = useUpsertToHistoryMutation(undefined, client);
  upsertToHistoryMutation.mutate({ itemId, itemType });
}
