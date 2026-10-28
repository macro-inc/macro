import type { Accessor } from 'solid-js';
import type { FilterValue } from './filters-bar/consolidated-filter-chip';
import type { SearchableOption } from './filters-bar/searchable-multi-select';
export type CollectionSelectFilter = {
  id: string;
  label: string;
  placeholder: string;
  values: Accessor<string[]>;
  effectiveValues: Accessor<string[]>;
  options: Accessor<SearchableOption[]>;
  chipOptions: Accessor<SearchableOption[]>;
  chipValues: Accessor<FilterValue[]>;
  change(ids: string[]): void;
  changeChip(ids: string[]): void;
  clear(): void;
  active?: Accessor<boolean>;
  preserveOrder?: boolean;
};
