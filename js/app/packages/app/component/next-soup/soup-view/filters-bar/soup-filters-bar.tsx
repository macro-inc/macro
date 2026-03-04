import { Button } from '@app/component/next-soup/soup-view/filters-bar/button';
import { SoupViewContextFilters } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-filters';
import { SoupViewContextSort } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { SoupSearchbar } from '@app/component/next-soup/soup-view/filters-bar/soup-view-search-bar';
import { useFilterRefinements } from '@app/component/next-soup/soup-view/filters-bar/use-filter-refinements';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import XIcon from '@icon/regular/x.svg';
import { createMemo, Show } from 'solid-js';

export const SoupFiltersBar = () => {
  const { hasActiveRefinements, resetToTabDefaults } = useFilterRefinements();

  const panel = useSplitPanelOrThrow();

  const component = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return content.id;
  });

  const isComponentListView = (listView: ListView) => {
    return component() === listView;
  };

  return (
    <div class="@container w-full overflow-hidden flex gap-2 flex-wrap py-2">
      <Show when={!isComponentListView('search')}>
        <SoupViewContextFilters />
      </Show>
      <Show when={hasActiveRefinements()}>
        <Button variant="ghost" size="sm" onClick={resetToTabDefaults}>
          <XIcon class="size-3" />
          <span>Clear all</span>
        </Button>
      </Show>

      <div class="flex-1" />

      <Show
        when={isComponentListView('search')}
        fallback={
          <div class="max-w-60 w-full">
            <SoupSearchbar />
          </div>
        }
      >
        <div class="w-full">
          <SoupSearchbar />
        </div>
      </Show>

      <SoupViewContextSort />
    </div>
  );
};
