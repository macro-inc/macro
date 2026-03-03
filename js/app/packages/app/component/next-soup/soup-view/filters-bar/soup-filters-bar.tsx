import { SoupViewContextFilters } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-filters';
import { SoupViewContextSort } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { SoupSearchbar } from '@app/component/next-soup/soup-view/filters-bar/soup-view-search-bar';

export const SoupFiltersBar = () => {
  return (
    <div class="@container w-full overflow-hidden flex gap-2 @min-small/split:items-center flex-wrap @min-small/split:flex-nowrap py-2">
      <div class="flex gap-2 items-center @min-small/split:size-full">
        <SoupViewContextFilters />
      </div>

      <div class="@min-small/split:ml-auto max-w-60 w-full">
        <SoupSearchbar />
      </div>

      <SoupViewContextSort />
    </div>
  );
};
