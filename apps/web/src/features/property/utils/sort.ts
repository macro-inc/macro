import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { parseISO } from 'date-fns';
import type { PropertyOption } from '../types';

/** Epoch microseconds, retaining RFC3339 precision beyond JavaScript's milliseconds. */
export function propertyDateSortKey(
  value: string | Date | null | undefined
): number | undefined {
  if (typeof value !== 'string') {
    const milliseconds = value?.getTime();
    return milliseconds !== undefined && Number.isFinite(milliseconds)
      ? milliseconds * 1000
      : undefined;
  }
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i.exec(value)?.[1] ?? '';
  // Truncate before constructing a Date: sub-millisecond negative instants otherwise round to zero.
  const milliseconds = parseISO(
    value.replace(/(\.\d{3})\d+(?=(?:Z|[+-]\d{2}:\d{2})$)/i, '$1')
  ).getTime();
  if (!Number.isFinite(milliseconds)) return;
  const microseconds = Math.round(
    Number(`0.${fraction.slice(3) || '0'}`) * 1000
  );
  return milliseconds * 1000 + microseconds;
}

/** The numeric property key used by Soup; mismatched value variants are missing. */
export function propertySortKey(
  property: SoupProperty | undefined,
  options: readonly PropertyOption[] = []
): number | undefined {
  const value = property?.value;
  if (!value || !property) return;
  switch (property.definition.data_type) {
    case 'DATE':
      return value.type === 'Date'
        ? propertyDateSortKey(value.value)
        : undefined;
    case 'NUMBER':
      return value.type === 'Number' && Number.isFinite(value.value)
        ? value.value
        : undefined;
    case 'BOOLEAN':
      return value.type === 'Boolean' ? Number(value.value) : undefined;
    case 'SELECT_STRING':
    case 'SELECT_NUMBER':
    case 'TAG': {
      if (value.type !== 'SelectOption') return;
      const orders = options
        .filter(
          (option) =>
            option.property_definition_id === property.definition.id &&
            value.value.includes(option.id)
        )
        .map((option) => option.display_order);
      return orders.length ? Math.min(...orders) : undefined;
    }
    default:
      return undefined;
  }
}
