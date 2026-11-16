/**
 * The search each split's list header (or list sidebar) has on screen, keyed
 * by the split's hotkey scope. A split can have more than one Escape owner: the header's
 * search field registers one, and a list that takes over the split's Escape
 * (the unified list view) reads the search from here to clear it too.
 */
type ListSearch = {
  isActive: () => boolean;
  clear: () => void;
};

const SEARCHES = new Map<string, ListSearch>();

/** Returns the function that withdraws the search when its field unmounts. */
export function registerListSearch(scopeId: string, search: ListSearch) {
  SEARCHES.set(scopeId, search);

  return () => {
    if (SEARCHES.get(scopeId) === search) SEARCHES.delete(scopeId);
  };
}

export function hasListSearch(scopeId: string) {
  return SEARCHES.get(scopeId)?.isActive() ?? false;
}

/** Clears the split's search; false when there was none to clear. */
export function clearListSearch(scopeId: string) {
  const search = SEARCHES.get(scopeId);
  if (!search?.isActive()) return false;

  search.clear();
  return true;
}
