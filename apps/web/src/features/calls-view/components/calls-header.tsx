import { ViewShell } from '@app/components/view-shell';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { SoupViewContextGroup } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { NewCallButton } from '@app/features/next-soup/soup-view/NewCallButton';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { t } from '@app/lib/i18n';
import { match } from 'ts-pattern';

/** Title, list controls, and active filter chips above the Calls list. */
export function CallsHeader() {
  const view = useSoupView();
  const { consolidatedFiltersList, resetToTabDefaults } =
    useFilterRefinements();
  const title = () =>
    match(view.activeTab())
      .with('missed', () => t('viewMenus.missedCalls'))
      .with('unattended', () => t('viewMenus.unattendedCalls'))
      .otherwise(() => t('viewMenus.calls'));

  return (
    <>
      <ViewShell.TopBar>
        <h1 class="min-w-0 flex-1 truncate px-1 text-sm font-semibold tracking-[-0.03em] text-ink">
          {title()}
        </h1>
        <div class="flex shrink-0 items-center gap-2 [&_button]:h-8 [&_button]:min-w-8 [&_button>svg]:size-4!">
          <SoupViewContextSort />
          <SoupViewContextGroup hideLabel variant="ghost" />
          <UnifiedFilterDropdown hideLabel variant="ghost" />
          <NewCallButton />
        </div>
      </ViewShell.TopBar>
      <SoupActiveFiltersBar
        filters={consolidatedFiltersList()}
        onClearAll={resetToTabDefaults}
      />
    </>
  );
}
