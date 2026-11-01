import {
  ListSortDropdown,
  useViewControlHotkeys,
  ViewSidebar,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { SoupViewContextGroup } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { NewCallButton } from '@app/features/next-soup/soup-view/NewCallButton';
import { DEFAULT_SORT_OPTIONS } from '@app/features/next-soup/soup-view/sort-options';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';

/** Title, list controls, and active filter chips above the Calls list. */
export function CallsHeader() {
  const view = useSoupView();
  const panel = useSplitPanelOrThrow();
  let focusSearch: (() => void) | undefined;
  const [sortOpen, setSortOpen] = createSignal(false);
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search calls',
      run: () => {
        focusSearch?.();
        return true;
      },
    },
    sort: { description: 'Sort calls', run: () => setSortOpen(true) },
  });
  const { consolidatedFiltersList, resetToTabDefaults } =
    useFilterRefinements();
  const title = () =>
    match(view.activeTab())
      .with('missed', () => t('viewMenus.missedCalls'))
      .with('unattended', () => t('viewMenus.unattendedCalls'))
      .otherwise(() => t('viewMenus.calls'));

  return (
    <>
      <ListHeader
        title={<ViewSidebar.Title caret={false}>{title()}</ViewSidebar.Title>}
      >
        <HeaderActionGroup label="Call filters">
          <UnifiedFilterDropdown grouped hideLabel variant="ghost" />
        </HeaderActionGroup>
        <HeaderActionGroup label="Call view options">
          <ListSortDropdown
            grouped
            label="Sort calls"
            value={
              DEFAULT_SORT_OPTIONS.find(
                (option) => option.value === view.soup.sort.active()[0]?.id
              )?.value ?? 'updated_at'
            }
            options={DEFAULT_SORT_OPTIONS.map((option) => ({
              id: option.value,
              label: option.label,
              icon: option.icon,
            }))}
            onChange={(id) => view.soup.sort.setAll([id])}
            open={sortOpen()}
            onOpenChange={setSortOpen}
          />
          <SoupViewContextGroup grouped hideLabel variant="ghost" />
        </HeaderActionGroup>
        <NewCallButton />
        <ListHeaderSearch
          label="Search calls"
          value={view.searchText()}
          onValueChange={view.setSearchText}
          onEscape={() => panel.panelRef()?.focus()}
          registerFocus={(focus) => (focusSearch = focus)}
        />
      </ListHeader>
      <SoupActiveFiltersBar
        filters={consolidatedFiltersList()}
        onClearAll={resetToTabDefaults}
      />
    </>
  );
}
