import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';

const EMPTY_OPTIONS: PropertyOption[] = [];

/**
 * Keeps the last successful option catalog usable when a background refresh
 * fails offline. Query errors describe freshness, not invalid cached data.
 */
export function usablePropertyOptions(
  query: {
    data: PropertyOption[] | undefined;
    isError: boolean;
    isPlaceholderData?: boolean;
  },
  fallback: PropertyOption[] = EMPTY_OPTIONS
): PropertyOption[] {
  return query.isPlaceholderData && !query.isError
    ? fallback
    : (query.data ?? EMPTY_OPTIONS);
}
