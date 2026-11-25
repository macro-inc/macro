import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMemo, Show } from 'solid-js';

/**
 * The row below a desktop soup header: the active filter chips, except in
 * Search, whose field holds its filters as typed operators. Filter, sort,
 * and group live in the header's islands.
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
    <Show when={!isTouchDevice() && !isSearchView() && props.variant !== 'tag'}>
      <SoupActiveFiltersBar
        filters={consolidatedFiltersList()}
        onClearAll={resetToTabDefaults}
      />
    </Show>
  );
}
