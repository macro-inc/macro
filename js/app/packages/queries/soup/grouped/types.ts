import type { SoupApiItem } from '@service-storage/generated/schemas';

/**
 * Empty group key emitted by the backend
 * (rust/cloud-storage/soup/src/domain/models/grouping.rs)
 * for items missing a value for the grouped property.
 */
export const NOT_SET_GROUP_KEY = '';

export type GroupByField =
  | { type: 'date' }
  | { type: 'entity_type' }
  | { type: 'project' }
  | {
      type: 'property';
      propertyDefinitionId: string;
      entityType?: PropertyEntityType;
    };

export const GROUP_BY_TYPES: readonly GroupByField['type'][] = [
  'date',
  'entity_type',
  'project',
  'property',
];

export type PropertyEntityType =
  | 'CHANNEL'
  | 'CHAT'
  | 'COMPANY'
  | 'DOCUMENT'
  | 'PROJECT'
  | 'TASK'
  | 'THREAD'
  | 'USER';

export interface GroupMeta {
  key: string;
  label: string;
  displayOrder: number | null;
  totalCount: number;
  /** Ordered ids of items in this group for the current page. */
  itemIds: string[];
  nextCursor: string | null;
}

export interface GroupedSoupPage {
  /** Items pool keyed by id. Per-group ordering lives in `groups[].itemIds`. */
  items: Record<string, SoupApiItem>;
  nextCursor: string | null;
  groups: GroupMeta[];
}
