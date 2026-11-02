import type { SoupApiItem } from '@service-storage/generated/schemas';
import type { ApiGroupByField } from '@service-storage/generated/schemas/apiGroupByField';

/**
 * Empty group key emitted by the backend
 * (crates/soup/src/domain/models/grouping.rs)
 * for items missing a value for the grouped property.
 */
export const NOT_SET_GROUP_KEY = '';

type ApiDatePropertyBucketing = NonNullable<
  Extract<ApiGroupByField, { property: unknown }>['property']['bucketing']
>;

/** Date ranges belong to a view, not to a property definition. */
export type DatePropertyBucketing = Omit<
  ApiDatePropertyBucketing,
  'missing_value_bucket_key'
> & {
  missingValueBucketKey: ApiDatePropertyBucketing['missing_value_bucket_key'];
};

export type GroupByField =
  | { type: 'date' }
  | { type: 'entity_type' }
  | { type: 'project' }
  | {
      type: 'property';
      propertyDefinitionId: string;
      entityType?: PropertyEntityType;
      bucketing?: DatePropertyBucketing;
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
