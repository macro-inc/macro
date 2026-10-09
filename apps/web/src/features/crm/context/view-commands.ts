import type { CrmViewConfig } from '../core/saved-view';
export type CrmViewCommands = {
  setActiveTab(value: string): void;
  replaceFilters(value: CrmViewConfig['filters']): void;
  replacePredicates(value: NonNullable<CrmViewConfig['clientFilters']>): void;
  setSearchText(value: string): void;
  setGroupBy(value: string | undefined): void;
  setSort(value: string[]): void;
  setStageFilter(value: string[]): void;
  setOwnerFilter(value: string[]): void;
};
