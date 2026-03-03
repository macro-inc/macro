import { SoupViewContextFilters } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-filters';
import { SoupViewContextSort } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { SoupSearchbar } from '@app/component/next-soup/soup-view/filters-bar/soup-view-search-bar';

export const SoupFiltersBar = () => {
  return (
    <div class="flex gap-2 items-center h-12">
      <div class="flex gap-2 items-center size-full">
        <SoupViewContextFilters />
      </div>
      <div class="ml-auto w-full flex items-center justify-end gap-2">
        <div class="max-w-56 w-full">
          <SoupSearchbar />
        </div>
        <SoupViewContextSort />
      </div>
    </div>
  );
};
