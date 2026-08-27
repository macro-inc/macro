import { createSignal } from 'solid-js';
import type { FacetSelection, FacetSelectionState } from './types';

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

export type CreateFacetSelectionStateOptions = {
  initial?: FacetSelection;
  onChange?: (selection: FacetSelection) => void;
};

export function createFacetSelectionState(
  options: CreateFacetSelectionStateOptions = {}
): FacetSelectionState {
  const [selection, setSelection] = createSignal<FacetSelection>(
    normalizeFacetSelection(options.initial)
  );

  const commit = (next: FacetSelection) => {
    const normalized = normalizeFacetSelection(next);
    if (JSON.stringify(normalized) === JSON.stringify(selection())) return;
    setSelection(normalized);
    options.onChange?.(normalized);
  };

  const set = (facetId: string, optionIds: Iterable<string>) => {
    commit({ ...selection(), [facetId]: [...optionIds] });
  };

  const deselect = (facetId: string, optionId: string) =>
    set(
      facetId,
      (selection()[facetId] ?? []).filter((id) => id !== optionId)
    );

  const select = (facetId: string, optionId: string) => {
    const active = selection()[facetId] ?? [];
    if (active.includes(optionId)) return;
    set(facetId, [...active, optionId]);
  };

  return {
    selection,
    has: (facetId, optionId) => (selection()[facetId] ?? []).includes(optionId),
    get: (facetId) => selection()[facetId] ?? [],
    select,
    deselect,
    toggle: (facetId, optionId) =>
      (selection()[facetId] ?? []).includes(optionId)
        ? deselect(facetId, optionId)
        : select(facetId, optionId),
    set,
    replace: commit,
    clear: (facetId) => {
      if (facetId === undefined) {
        commit({});
        return;
      }
      const next = { ...selection() };
      delete next[facetId];
      commit(next);
    },
  };
}
