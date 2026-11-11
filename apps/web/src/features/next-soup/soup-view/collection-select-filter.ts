import type { Accessor } from 'solid-js';
import type { FilterValue } from './filters-bar/consolidated-filter-chip';
import type { SearchableOptionSourceFactory } from './filters-bar/option-source';
import type { SearchableOption } from './filters-bar/searchable-multi-select';
export type CollectionSelectFilter = {
  id: string;
  label: string;
  placeholder: string;
  values: Accessor<string[]>;
  effectiveValues: Accessor<string[]>;
  options: Accessor<SearchableOption[]>;
  chipValues: Accessor<FilterValue[]>;
  change(ids: string[]): void;
  changeChip(ids: string[]): void;
  clear(): void;
  active?: Accessor<boolean>;
  preserveOrder?: boolean;
} & (
  | { chipOptions: Accessor<SearchableOption[]>; createChipSource?: never }
  | { chipOptions?: never; createChipSource: SearchableOptionSourceFactory }
);
