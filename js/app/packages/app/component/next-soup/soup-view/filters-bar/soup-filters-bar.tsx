import { SoupViewContextSort } from '@app/component/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { SoupSearchbar } from '@app/component/next-soup/soup-view/filters-bar/soup-view-search-bar';
import { useFilterRefinements } from '@app/component/next-soup/soup-view/filters-bar/use-filter-refinements';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { createMemo, Match, Switch } from 'solid-js';
import { UnifiedFilterDropdown } from '@app/component/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { ActiveFilterChips } from '@app/component/next-soup/soup-view/filters-bar/active-filter-chips';

export const SoupFiltersBar = () => {
  const {
    resetToTabDefaults,
    activeFiltersList,
    removeFilter,
    replaceFilter,
    isOptionActive,
  } = useFilterRefinements();

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
    <Switch>
      <Match when={isComponentListView('search')}>
        <div class="w-full flex flex-col gap-2 p-2 border-b border-edge-muted/50">
          <SoupSearchbar autoFocus />
        </div>
      </Match>
      <Match when={true}>
        <div class="flex items-start gap-2 px-2 py-1.5 border-b border-edge-muted w-full">
          <UnifiedFilterDropdown />
          <ActiveFilterChips
            filters={activeFiltersList()}
            onRemove={removeFilter}
            onReplace={replaceFilter}
            onClearAll={resetToTabDefaults}
            isOptionActive={isOptionActive}
          />
          <div class="flex-1" />
          <SoupViewContextSort />
        </div>
      </Match>
    </Switch>
  );
};
