import type { ApiGroupMeta } from '@service-storage/generated/schemas/apiGroupMeta';
import type { GroupedSoupPage as WireGroupedSoupPage } from '@service-storage/generated/schemas/groupedSoupPage';
import type { SoupApiItem } from '@service-storage/generated/schemas/soupApiItem';
import { GROUPED_SUBQUERY_MARKER } from '../keys';
import {
  type GroupByField,
  type GroupedSoupPage,
  type GroupMeta,
  NOT_SET_GROUP_KEY,
} from './types';

export function serializeGroupByField(field: GroupByField): unknown {
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

export function parseGroupedSoupPage(
  response: WireGroupedSoupPage,
): GroupedSoupPage {
  return {
    items: response.items,
    nextCursor: response.next_cursor ?? null,
    groups: (response.groups ?? []).map(parseGroupMeta),
  };
}

/**
 * Read the `GroupByField` slot from a soup astItems-prefixed queryKey.
 * Returns undefined when the slot isn't present or isn't a GroupByField.
 */
export function extractGroupByFromKey(
  queryKey: readonly unknown[],
): GroupByField | undefined {
  // soupKeys.astItems builds: ['soup', 'astItems', params, body, groupBy]
  const candidate = queryKey[4];
  if (!candidate || typeof candidate !== 'object') return;
  const obj = candidate as { type?: unknown };
  if (typeof obj.type !== 'string') return;
  return candidate as GroupByField;
}

/**
 * Read the per-group key from a queryKey marked as a per-group subquery
 * (last element follows GROUPED_SUBQUERY_MARKER).
 */
export function extractPerGroupKeyFromQueryKey(
  queryKey: readonly unknown[],
): string | undefined {
  const len = queryKey.length;
  if (len < 2) return;
  if (queryKey[len - 2] !== GROUPED_SUBQUERY_MARKER) return;
  const key = queryKey[len - 1];
  return typeof key === 'string' ? key : undefined;
}

/**
 * Compute the group keys an item belongs to under the given grouping.
 * Returns `undefined` when the grouping can't be reproduced client-side
 * (date buckets, non-categorical properties) — caller should invalidate.
 */
export function computeGroupKeysForItem(
  item: SoupApiItem,
  groupBy: GroupByField | undefined,
): string[] | undefined {
  if (!groupBy) return;

  switch (groupBy.type) {
    case 'entity_type':
      return [item.tag];

    case 'project': {
      if (item.tag === 'channel' || item.tag === 'call') return;

      const projectId = (item.data as { projectId?: string | null }).projectId;
      return [projectId ?? NOT_SET_GROUP_KEY];
    }

    case 'property': {
      if (item.tag === 'channel' || item.tag === 'call') return;

      const properties = (
        item.data as unknown as {
          properties?: Array<Record<string, unknown>>;
        }
      ).properties;
      if (!properties) return [NOT_SET_GROUP_KEY];

      const prop = properties.find(
        (p) =>
          (p.definition as Record<string, unknown> | undefined)?.id ===
          groupBy.propertyDefinitionId,
      );
      if (!prop) return [NOT_SET_GROUP_KEY];

      const value = prop.value as
        | { type: string; value: unknown }
        | null
        | undefined;
      if (value == null) return [NOT_SET_GROUP_KEY];

      if (value.type === 'SelectOption' && Array.isArray(value.value)) {
        return value.value as string[];
      }
      if (value.type === 'EntityReference' && Array.isArray(value.value)) {
        return (value.value as Array<{ id: string }>).map((r) => r.id);
      }

      return; // Non-categorical: backend bucketing is opaque.
    }

    case 'date':
      return; // Server-side date bucketing is opaque.
  }
}
