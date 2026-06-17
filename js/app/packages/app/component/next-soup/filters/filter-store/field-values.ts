import { deepEqual } from '@core/util/compareUtils';
import type { FieldFilters, FieldName } from './types';

export const addFieldValues = (
  target: FieldFilters,
  source: FieldFilters | undefined
): FieldFilters => {
  if (!source) return target;

  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source) as FieldName[]) {
    const value = source[key];
    if (value === undefined) continue;

    if (!Array.isArray(value)) {
      result[key] = value;
      continue;
    }

    if (!value.length) continue;

    const existing = (target[key] ?? []) as unknown[];
    // Keep duplicates as lightweight reference counts. Markdown and Snippets
    // both contribute assoc:md; removing one filter must leave the other's
    // backend query value in place.
    result[key] = [...existing, ...value];
  }

  return result as FieldFilters;
};

export const removeFieldValues = (
  target: FieldFilters,
  source: FieldFilters | undefined
): FieldFilters => {
  if (!source) return target;

  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source) as FieldName[]) {
    const value = source[key];
    if (value === undefined) continue;

    if (!Array.isArray(value)) {
      if (target[key] === value) delete result[key];
      continue;
    }

    const existing = target[key] as unknown[];
    if (!value.length || !Array.isArray(existing)) continue;

    const filtered = [...existing];
    // Remove one occurrence per contributed value rather than every equal value.
    for (const v of value as unknown[]) {
      const index = filtered.findIndex((e) => deepEqual(e, v));
      if (index !== -1) filtered.splice(index, 1);
    }

    if (filtered.length === 0) {
      delete result[key];
      continue;
    }

    result[key] = filtered;
  }

  return result as FieldFilters;
};
