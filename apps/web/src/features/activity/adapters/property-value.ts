import type { PropertyDefinitionDomain } from '@property/types';
import {
  formatBoolean,
  formatDate,
  formatNumber,
  formatOptionValue,
} from '@property/utils/formatting';

/** One resolved select option of a stored property value. */
export type SelectOptionEntry = {
  id: string;
  label: string;
  color: string | null;
};

/**
 * Resolves a stored SelectOption value into its options (label + tag color),
 * for rendering with the property system's option pills. Returns undefined
 * for non-select values or when no option resolves, so callers fall back to
 * the plain text label path.
 */
export function selectOptionEntries(
  raw: unknown,
  definition: PropertyDefinitionDomain | undefined
): SelectOptionEntry[] | undefined {
  const tagged = asTaggedValue(raw);
  if (
    !tagged ||
    tagged.type !== 'SelectOption' ||
    !Array.isArray(tagged.value)
  ) {
    return undefined;
  }
  const entries = tagged.value
    .filter((id): id is string => typeof id === 'string')
    .flatMap((id) => {
      const option = definition?.options?.find((o) => o.id === id);
      if (!option) return [];
      return [
        { id, label: formatOptionValue(option), color: option.color ?? null },
      ];
    });
  return entries.length > 0 ? entries : undefined;
}

/**
 * The stored property payload: models_properties' tagged PropertyValue
 * (`{"type": "SelectOption", "value": ["uuid"]}` …). Arrives as untyped
 * JSON, so parse defensively — an unrecognized shape renders no label
 * rather than garbage.
 */
function asTaggedValue(
  raw: unknown
): { type: string; value: unknown } | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.type !== 'string' || !('value' in record)) return undefined;
  return { type: record.type, value: record.value };
}

/**
 * Human label for one stored property value, resolved against the
 * property's definition (select-option ids → option names). Returns
 * undefined when the value can't be labeled, so callers can fall back to
 * generic wording instead of showing raw ids.
 */
export function propertyValueLabel(
  raw: unknown,
  definition: PropertyDefinitionDomain | undefined
): string | undefined {
  const tagged = asTaggedValue(raw);
  if (!tagged) return undefined;

  switch (tagged.type) {
    case 'String':
      return typeof tagged.value === 'string' ? tagged.value : undefined;
    case 'Number':
      return typeof tagged.value === 'number'
        ? formatNumber(tagged.value)
        : undefined;
    case 'Boolean':
      return typeof tagged.value === 'boolean'
        ? formatBoolean(tagged.value)
        : undefined;
    case 'Date':
      return typeof tagged.value === 'string'
        ? formatDate(tagged.value)
        : undefined;
    case 'SelectOption': {
      if (!Array.isArray(tagged.value)) return undefined;
      const labels = tagged.value
        .filter((id): id is string => typeof id === 'string')
        .map((id) => {
          const option = definition?.options?.find((o) => o.id === id);
          return option ? formatOptionValue(option) : undefined;
        })
        .filter((label): label is string => label !== undefined);
      return labels.length > 0 ? labels.join(', ') : undefined;
    }
    case 'Link':
      return Array.isArray(tagged.value)
        ? tagged.value.filter((v) => typeof v === 'string').join(', ') ||
            undefined
        : undefined;
    case 'EntityReference':
      return Array.isArray(tagged.value) && tagged.value.length > 0
        ? tagged.value.length === 1
          ? 'an item'
          : `${tagged.value.length} items`
        : undefined;
    default:
      return undefined;
  }
}
