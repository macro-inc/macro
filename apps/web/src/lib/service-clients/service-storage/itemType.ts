import type { CloudStorageItemType } from './generated/schemas/cloudStorageItemType';

/** Item type accepted by user history endpoints. */
export type ItemType =
  | CloudStorageItemType
  | 'channel'
  | 'email'
  | 'channel_message'
  | 'channel_thread'
  | 'call'
  | 'automation'
  | 'calendar_event'
  | 'foreign'
  | 'crm_company'
  | 'crm_contact';

/**
 * Entity type stored on channel attachments, mentions, and referencium.
 *
 * Email threads are `thread` in that system (`ReferencedShareItemType::EmailThread`).
 * Mentions already map `email` → `thread`; share-menu attachments must do the same
 * or they will not appear in the references side panel.
 */
export function itemTypeToReferenceEntityType(itemType: ItemType): string {
  return itemType === 'email' ? 'thread' : itemType;
}

/** Item types accepted by user history endpoints. */
export const ITEM_TYPES = [
  'document',
  'chat',
  'project',
  'channel',
  'email',
  'channel_message',
  'channel_thread',
  'call',
  'automation',
  'calendar_event',
  'foreign',
  'crm_company',
  'crm_contact',
] as const satisfies readonly ItemType[];
