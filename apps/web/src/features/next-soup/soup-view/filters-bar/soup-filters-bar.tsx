import { SearchFiltersRow } from '@app/features/next-soup/soup-view/filters-bar/search/search-filters-row';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { SplitToolbarLeft } from '@components/app/split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMemo, Show } from 'solid-js';

/**
 * The row below a desktop soup header: Search's facet row, or the active
 * filter chips. Filter, sort, and group live in the header's islands.
 */
export function SoupFiltersBar(props: { variant?: 'default' | 'tag' }) {
  const { resetToTabDefaults, consolidatedFiltersList } =
    useFilterRefinements();

  const panel = useSplitPanelOrThrow();

  const isSearchView = createMemo(() => {
    const content = panel.handle.content();
    return content.type === 'component' && content.id === 'search';
  });

  return (
    <Show when={!isTouchDevice()}>
      <Show
        when={isSearchView()}
        fallback={
          <Show when={props.variant !== 'tag'}>
            <SoupActiveFiltersBar
              filters={consolidatedFiltersList()}
              onClearAll={resetToTabDefaults}
            />
          </Show>
        }
      >
        <SplitToolbarLeft>
          <SearchFiltersRow />
        </SplitToolbarLeft>
      </Show>
    </Show>
  );
}
