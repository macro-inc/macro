import { createBlockSignal } from '@core/block';
import type {
  ItemFilter,
  OwnershipFilter,
} from '@core/component/FileList/Filter';
import { defaultFileSortPair, type SortPair } from '@core/util/sort';

export const blockActiveFilters = createBlockSignal<ItemFilter[]>([]);

export const blockOwnershipFilters = createBlockSignal<OwnershipFilter[]>([]);

export const blockFileSearchQuery = createBlockSignal('');

export const blockFileSort = createBlockSignal<SortPair>(defaultFileSortPair);

export const blockShowProjectsFirst = createBlockSignal(false);

export const blockShowTrash = createBlockSignal(false);
