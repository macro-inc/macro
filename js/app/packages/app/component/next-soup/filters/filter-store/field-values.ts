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
    const updated = [...existing];

    for (const v of value) {
      if (!updated.some((e) => deepEqual(e, v))) updated.push(v);
    }

    result[key] = updated;
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

    const toRemove = value as unknown[];
    const filtered = existing.filter(
      (e) => !toRemove.some((v) => deepEqual(e, v))
    );

    if (filtered.length === 0) {
      delete result[key];
      continue;
    }

    result[key] = filtered;
  }

  return result as FieldFilters;
};
