import { useSoup } from '@app/component/next-soup/soup-context';
import { SortDropdown } from '@app/component/next-soup/soup-view/filters-bar/sort-dropdown';
import { SoupViewContextFilters } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-filters';
import { SoupSearchbar } from '@app/component/next-soup/soup-view/filters-bar/soup-view-search-bar';
import type { SystemSortOption } from '@app/component/next-soup/soup-view/sort-options';

export const SoupFiltersBar = () => {
  const soup = useSoup();

  return (
    <div class="flex gap-2 items-center">
      <div class="flex gap-2 items-center w-full h-12">
        <SoupViewContextFilters />
      </div>
      <div class="ml-auto w-full flex items-center justify-end gap-2">
        <div class="max-w-56 w-full">
          <SoupSearchbar />
        </div>
        <SortDropdown
          value={() => soup.sort.active()[0].id as SystemSortOption}
          onChange={(value) => soup.sort.setAll([value])}
        />
      </div>
    </div>
  );
};
