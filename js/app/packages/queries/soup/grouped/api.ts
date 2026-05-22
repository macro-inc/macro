import type { ApiGroupMeta } from '@service-storage/generated/schemas/apiGroupMeta';
import type { GroupedSoupPage as WireGroupedSoupPage } from '@service-storage/generated/schemas/groupedSoupPage';
import type { SoupApiItem } from '@service-storage/generated/schemas/soupApiItem';
import { GROUPED_SUBQUERY_MARKER } from '../keys';
import {
  GROUP_BY_TYPES,
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
  response: WireGroupedSoupPage
): GroupedSoupPage {
  return {
    items: response.items,
    nextCursor: response.next_cursor ?? null,
    groups: (response.groups ?? []).map(parseGroupMeta),
  };
}

export function extractGroupByFromKey(
  queryKey: readonly unknown[]
): GroupByField | undefined {
  for (const v of queryKey) {
    if (!v || typeof v !== 'object') continue;
    const t = (v as { type?: unknown }).type;
    if (
      typeof t === 'string' &&
      GROUP_BY_TYPES.includes(t as GroupByField['type'])
    ) {
      return v as GroupByField;
    }
  }
  return;
}

export function extractPerGroupKeyFromQueryKey(
  queryKey: readonly unknown[]
): string | undefined {
  const markerIdx = queryKey.indexOf(GROUPED_SUBQUERY_MARKER);
  if (markerIdx === -1) return;
  const key = queryKey[markerIdx + 1];
  return typeof key === 'string' ? key : undefined;
}

/**
 * Compute the group keys an item belongs to under the given grouping.
 * Returns `undefined` when bucketing can't be reproduced client-side
 * (date, non-categorical property) — caller should invalidate.
 */
export function computeGroupKeysForItem(
  item: SoupApiItem,
  groupBy: GroupByField | undefined
) {
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
          groupBy.propertyDefinitionId
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
      return;
    }

    case 'date':
      return;
  }
}
