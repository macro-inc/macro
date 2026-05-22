import type { ApiGroupMeta } from '@service-storage/generated/schemas/apiGroupMeta';
import type { GroupedSoupPage as WireGroupedSoupPage } from '@service-storage/generated/schemas/groupedSoupPage';
import { GROUPED_SUBQUERY_MARKER } from '../keys';
import type { GroupByField, GroupedSoupPage, GroupMeta } from './types';

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
