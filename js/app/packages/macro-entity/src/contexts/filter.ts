import { createContext, type Signal, useContext } from 'solid-js';
import type { Filters } from '../types/filter';

export type FilterState = {
  [key in keyof Filters]?: Signal<Filters[key]>;
};

export interface FilterContext extends FilterState {
  defaultFilters: Filters;
}

export const DEFAULT_FILTERS = {
  unreadFilter: false,
  sortBy: 'updated',
  fileTypeFilter: [],
  ownerTypeFilter: 'all',
} as const satisfies Filters;

export const FilterContext = createContext<FilterContext>({
  defaultFilters: DEFAULT_FILTERS,
});

export function useFilterContext() {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error('cannot find filter context');
  }

  return context;
}
