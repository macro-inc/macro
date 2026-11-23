import { ConsolidatedFilterChip } from '@app/features/next-soup/soup-view/filters-bar/consolidated-filter-chip';
import { MobileFilterDrawer } from '@app/features/next-soup/soup-view/filters-bar/mobile-filter-drawer';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { attachGlobalDOMScope, useHotKeyRoot } from '@core/hotkey/hotkeys';
import { For, Show } from 'solid-js';
import { requests, VIEWER } from './list-filter-adapters';
import { changeViewer, lookupIds } from './network';
import { SoupFilterFixtureProvider, useSoupView } from './soup-filter-adapters';

function Filters() {
  const state = useSoupView();
  const refinements = useFilterRefinements();
  useHotKeyRoot();
  attachGlobalDOMScope(document.body);
  return (
    <main class="bg-page text-ink p-6 min-h-screen" tabIndex={-1}>
      <button onClick={state.seedSelections}>Seed saved filters</button>
      <button onClick={state.showOwned}>Show owned files</button>
      <button onClick={state.refineOwned}>Refine owned creator</button>
      <Show
        when={
          matchMedia('(pointer: coarse)').matches &&
          state.view() !== 'companies'
        }
        fallback={
          <>
            <UnifiedFilterDropdown />
            <div data-testid="chips" class="flex gap-2 flex-wrap mt-4">
              <For each={refinements.consolidatedFiltersList()}>
                {(filter) => <ConsolidatedFilterChip filter={filter} />}
              </For>
            </div>
          </>
        }
      >
        <MobileFilterDrawer />
      </Show>
      <pre data-testid="owners">{JSON.stringify(state.owners())}</pre>
      <pre data-testid="stages">{JSON.stringify(state.stages())}</pre>
      <pre data-testid="assignees">
        {JSON.stringify(state.assigneeFilter())}
      </pre>
      <pre data-testid="query-filters">
        {JSON.stringify(state.queryFilters.state)}
      </pre>
      <output data-testid="requests">{requests()}</output>
      <output data-testid="lookup-ids">{JSON.stringify(lookupIds())}</output>
    </main>
  );
}
export function SoupFilterFixture() {
  changeViewer(VIEWER);
  return (
    <SoupFilterFixtureProvider>
      <Filters />
    </SoupFilterFixtureProvider>
  );
}
