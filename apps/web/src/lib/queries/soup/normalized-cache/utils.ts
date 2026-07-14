import { GROUP_BY_TYPES, type GroupByField } from '../grouped/types';
import type { SoupApiItemFilter } from '../items';

export type SoupQueryMeta = {
  groupBy?: GroupByField;
  groupKey?: string;
  itemFilter?: SoupApiItemFilter;
};

export function getSoupQueryMeta(meta: unknown): SoupQueryMeta {
  if (!meta || typeof meta !== 'object') return {};

  const raw = meta as Record<string, unknown>;
  const soupMeta: SoupQueryMeta = {};

  if (isGroupByField(raw.groupBy)) soupMeta.groupBy = raw.groupBy;
  if (typeof raw.groupKey === 'string') soupMeta.groupKey = raw.groupKey;
  if (typeof raw.itemFilter === 'function') {
    soupMeta.itemFilter = raw.itemFilter as SoupApiItemFilter;
  }

  return soupMeta;
}

function isGroupByField(value: unknown): value is GroupByField {
  if (!value || typeof value !== 'object') return false;

  const groupBy = value as Record<string, unknown>;
  const type = groupBy.type;
  if (typeof type !== 'string') return false;

  if (!GROUP_BY_TYPES.some((groupByType) => groupByType === type)) return false;

  return (
    type !== 'property' || typeof groupBy.propertyDefinitionId === 'string'
  );
}
