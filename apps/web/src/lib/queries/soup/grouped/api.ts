import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { SoupProperty } from '@service-storage/generated/schemas';
import type { ApiGroupByField as ApiGroupedSoupField } from '@service-storage/generated/schemas/apiGroupByField';
import type { ApiGroupMeta } from '@service-storage/generated/schemas/apiGroupMeta';
import type { Params } from '@service-storage/generated/schemas/params';
import type { SoupApiItem } from '@service-storage/generated/schemas/soupApiItem';
import { match } from 'ts-pattern';
import { propertyDateGroupKey } from './date-ranges';
import { type GroupByField, type GroupMeta, NOT_SET_GROUP_KEY } from './types';

/** Sort methods the grouped soup endpoints accept. */
export type GroupedSortMethod = Exclude<
  NonNullable<Params['sort_method']>,
  'frecency' | 'touched_by_me' | 'notified_at'
>;

/**
 * Maps a flat-feed sort method onto what the grouped endpoints support.
 * Frecency, touched-by-me and notified-at pages are built from their own
 * data sources (relevance scores / the activity log / notifications) that
 * the grouped queries cannot reproduce, so grouping such a view falls back
 * to update recency within each group.
 */
export function groupedSortMethod(
  sort: Params['sort_method']
): GroupedSortMethod | undefined {
  if (sort == null) return undefined;
  if (sort === 'frecency' || sort === 'touched_by_me' || sort === 'notified_at')
    return 'updated_at';
  return sort;
}

function hasProperties<T extends SoupApiItem>(
  item: T
): item is T & {
  data: T['data'] & {
    properties?: SoupProperty[];
  };
} {
  if (
    item.tag === 'channel' ||
    item.tag === 'call' ||
    item.tag === 'crmCompany' ||
    item.tag === 'foreignEntity'
  )
    return false;

  return true;
}

export function serializeGroupByField(
  field: GroupByField
): ApiGroupedSoupField {
  switch (field.type) {
    case 'date':
      return 'date';
    case 'entity_type':
      return 'entity_type';
    case 'project':
      return 'project';
    case 'property':
      return {
        property: {
          property_definition_id: field.propertyDefinitionId,
          ...(field.entityType && { entity_type: field.entityType }),
          ...(field.bucketing && {
            bucketing: {
              type: field.bucketing.type,
              ranges: field.bucketing.ranges,
              missing_value_bucket_key: field.bucketing.missingValueBucketKey,
            },
          }),
        },
      };
  }
}

export function parseGroupMeta(raw: ApiGroupMeta): GroupMeta {
  return {
    key: raw.key,
    label: raw.label,
    displayOrder: raw.display_order ?? null,
    totalCount: raw.total_count,
    itemIds: raw.item_ids,
    nextCursor: raw.next_cursor ?? null,
  };
}

const ENTITY_TYPE_META: Record<
  string,
  { label: string; displayOrder: number }
> = {
  document: { label: 'Documents', displayOrder: 0 },
  email: { label: 'Emails', displayOrder: 1 },
  channel: { label: 'Messages', displayOrder: 2 },
  chat: { label: 'Chats', displayOrder: 3 },
  project: { label: 'Projects', displayOrder: 4 },
  call: { label: 'Calls', displayOrder: 5 },
};

export type ResolvedGroupMeta = Pick<
  GroupMeta,
  'key' | 'label' | 'displayOrder'
>;

export function resolveGroupMetaForKey(
  groupBy: GroupByField | undefined,
  key: string,
  item?: SoupApiItem
): ResolvedGroupMeta | undefined {
  if (!groupBy) return;

  return match(groupBy)
    .with({ type: 'entity_type' }, () => {
      const meta = ENTITY_TYPE_META[key] ?? { label: 'Other', displayOrder: 6 };

      return { key, label: meta.label, displayOrder: meta.displayOrder };
    })
    .with({ type: 'project' }, () => {
      if (key === NOT_SET_GROUP_KEY) {
        return {
          key,
          label: 'No Project',
          displayOrder: Number.MAX_SAFE_INTEGER,
        };
      }

      return;
    })
    .with({ type: 'property' }, (propertyGroupBy) => {
      if (propertyGroupBy.bucketing) {
        const { ranges, missingValueBucketKey } = propertyGroupBy.bucketing;
        const order = ranges.findIndex((range) => range.key === key);
        if (order === -1 && key !== missingValueBucketKey) return;
        return {
          key,
          label: key,
          displayOrder: order === -1 ? ranges.length : order,
        };
      }
      if (key === NOT_SET_GROUP_KEY) {
        return { key, label: 'Not Set', displayOrder: Number.MAX_SAFE_INTEGER };
      }

      const propertyValueType = getGroupedPropertyValueType(
        item,
        propertyGroupBy
      );

      if (propertyValueType === 'SelectOption') {
        return {
          key,
          label: key,
          displayOrder: null,
        };
      }

      return;
    })
    .with({ type: 'date' }, () => undefined)
    .exhaustive(() => undefined);
}

function getGroupedPropertyValueType(
  item: SoupApiItem | undefined,
  groupBy: GroupByField
): string | undefined {
  if (!item || groupBy.type !== 'property') return;

  if (!hasProperties(item)) return;

  const properties = item.data.properties;

  const prop = properties?.find(
    (p) => p.definition?.id === groupBy.propertyDefinitionId
  );

  const value = prop?.value;

  return value?.type;
}

function keyRank(order: readonly string[], key: string): number {
  const i = order.indexOf(key);
  return i === -1 ? order.length : i;
}

function defaultOrder(a: GroupMeta, b: GroupMeta): number {
  if (a.displayOrder === null && b.displayOrder === null) return 0;
  if (a.displayOrder === null) return 1;
  if (b.displayOrder === null) return -1;
  return a.displayOrder - b.displayOrder;
}

/** Returns the stable display ordering used by grouped Soup parent results. */
export function makeGroupComparator(
  groupBy: GroupByField | undefined
): (a: GroupMeta, b: GroupMeta) => number {
  if (groupBy?.type === 'property') {
    if (groupBy.bucketing) {
      const { ranges, missingValueBucketKey } = groupBy.bucketing;
      const order = [
        ...ranges.map((range) => range.key),
        missingValueBucketKey,
      ];
      return (a, b) => keyRank(order, a.key) - keyRank(order, b.key);
    }
    if (
      groupBy.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES ||
      groupBy.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT
    ) {
      return notSetLastByLabel;
    }
    return (a, b) => {
      const aNotSet = a.key === NOT_SET_GROUP_KEY;
      const bNotSet = b.key === NOT_SET_GROUP_KEY;
      if (aNotSet && bNotSet) return 0;
      if (aNotSet) return 1;
      if (bNotSet) return -1;
      // Server metadata uses the definition's option display_order, also used by item sorting.
      return defaultOrder(a, b);
    };
  }
  if (groupBy?.type === 'project') return notSetLastByLabel;
  return defaultOrder;
}

/** People and projects sort by name; the unassigned group closes the list. */
function notSetLastByLabel(a: GroupMeta, b: GroupMeta): number {
  const aNotSet = a.key === NOT_SET_GROUP_KEY;
  const bNotSet = b.key === NOT_SET_GROUP_KEY;
  if (aNotSet && bNotSet) return 0;
  if (aNotSet) return 1;
  if (bNotSet) return -1;
  return a.label.localeCompare(b.label);
}

/**
 * Compute the group keys an item belongs to under the given grouping.
 * Returns `undefined` when membership cannot be reproduced from loaded values.
 */
export function computeGroupKeysForItem(
  item: SoupApiItem,
  groupBy: GroupByField | undefined
): string[] | undefined {
  if (!groupBy) return;

  return match(groupBy)
    .with({ type: 'entity_type' }, () => [item.tag])
    .with({ type: 'project' }, () =>
      computeGroupKeysForItem(item, {
        type: 'property',
        propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
      })
    )
    .with({ type: 'property' }, (propertyGroupBy) => {
      if (!hasProperties(item)) return;

      const properties = item.data.properties;
      if (propertyGroupBy.bucketing) {
        if (!properties) return;
        const property = properties.find(
          (property) =>
            property.definition.id === propertyGroupBy.propertyDefinitionId
        );
        const value = property?.value;
        return [
          propertyDateGroupKey(
            value?.type === 'Date' ? value.value : undefined,
            propertyGroupBy.bucketing
          ),
        ];
      }

      if (!properties) return [NOT_SET_GROUP_KEY];

      const prop = properties.find(
        (p) => p.definition?.id === propertyGroupBy.propertyDefinitionId
      );

      if (!prop) return [NOT_SET_GROUP_KEY];

      const value = prop.value;

      if (value == null) return [NOT_SET_GROUP_KEY];

      if (value.type === 'SelectOption' && Array.isArray(value.value)) {
        return value.value.length > 0 ? value.value : [NOT_SET_GROUP_KEY];
      }

      if (value.type === 'EntityReference' && Array.isArray(value.value)) {
        return value.value.length > 0
          ? value.value.map((r) => r.entity_id)
          : [NOT_SET_GROUP_KEY];
      }

      return;
    })
    .with({ type: 'date' }, () => undefined)
    .exhaustive(() => undefined);
}
