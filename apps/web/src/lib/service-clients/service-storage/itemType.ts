import type { BlockAlias, BlockName } from '@core/block';
import { match } from 'ts-pattern';
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

/** Item type assumed when a surface has no better information. */
export const DEFAULT_ITEM_TYPE: ItemType = 'document';

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

/**
 * Parse a stored or transported entity-type string into an [`ItemType`].
 *
 * Referencium, mentions, and older rows spell email threads three ways
 * (`email`, `thread`, `email_thread`); all of them parse to `email`.
 * Never cast these strings to `ItemType` directly.
 */
export function stringToItemType(str: string): ItemType | undefined {
  return match<string, ItemType | undefined>(str)
    .with('email', 'thread', 'email_thread', () => 'email')
    .with(
      'call',
      'calendar_event',
      'chat',
      'document',
      'project',
      'channel',
      'crm_company',
      (itemType) => itemType
    )
    .otherwise(() => undefined);
}

export function blockNameToItemType(
  blockName: BlockName | BlockAlias
): ItemType {
  return match<BlockName | BlockAlias, ItemType>(blockName)
    .with('chat', 'call', 'channel', 'project', 'email', 'automation', (b) => b)
    .with('calendar', () => 'calendar_event')
    .with('company', () => 'crm_company')
    .with('contact', () => 'crm_contact')
    .otherwise(() => DEFAULT_ITEM_TYPE);
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
