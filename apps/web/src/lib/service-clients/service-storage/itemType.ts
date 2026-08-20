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
