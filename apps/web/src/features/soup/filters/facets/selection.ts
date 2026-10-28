import type { FacetSelection } from './types';

/** Sorts, deduplicates, and removes malformed or empty facet selections. */
export function normalizeFacetSelection(raw: unknown): FacetSelection {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const entries: Array<[string, string[]]> = [];
  for (const [facetId, optionIds] of Object.entries(raw).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)
  )) {
    if (!Array.isArray(optionIds)) continue;
    const valid = [
      ...new Set(
        optionIds.filter((id): id is string => typeof id === 'string')
      ),
    ].sort();
    if (valid.length > 0) entries.push([facetId, valid]);
  }
  return Object.fromEntries(entries);
}

/** Stable JSON serialization suitable for URL, entry-state, or preferences. */
export const serializeFacetSelection = (selection: FacetSelection): string =>
  JSON.stringify(normalizeFacetSelection(selection));

export function deserializeFacetSelection(raw: unknown): FacetSelection {
  if (typeof raw !== 'string') return normalizeFacetSelection(raw);
  try {
    return normalizeFacetSelection(JSON.parse(raw));
  } catch {
    return {};
  }
}
