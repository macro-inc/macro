import { requestSearchFocus } from '@app/features/next-soup/soup-view/search-controllers';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToSidebarView } from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { TOKENS } from '@core/hotkey/tokens';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { Hotkey } from '@ui';
import { SidebarItemNext } from './sidebar-item-next';

/**
 * Takes the active split to the search view and focuses its input — the same
 * behaviour as the old sidebar's magnifier (`SidebarHeaderSearchButton`), not
 * the command menu. Already on search, it just refocuses the input rather than
 * pushing a second entry.
 */
function useOpenSearch() {
  const analytics = useAnalytics();
  const layout = useSplitLayout();

  return (event: MouseEvent) => {
    analytics.track('sidebar_click', { view: 'search' });

    let split = globalSplitManager()?.activeSplit();
    const content = split?.content();

    if (split && content?.type === 'component' && content.id === 'search') {
      requestSearchFocus(split.id);
      globalSplitManager()?.returnFocus();
      return;
    }

    split = navigateToSidebarView({
      viewId: 'search',
      shiftKey: event.shiftKey,
      activeSplit: split,
      openWithSplit: layout.openWithSplit,
      referredFrom: 'sidebar',
    });
    if (split) requestSearchFocus(split.id);
    globalSplitManager()?.returnFocus();
  };
}

/** The full-width bar under the header, styled as a search input. */
export const SearchBarButton = () => {
  const openSearch = useOpenSearch();

  return (
    <SidebarItemNext
      variant="search"
      label="Search"
      icon={MagnifyingGlassIcon}
      data-sidebar-next-search=""
      onClick={openSearch}
      trailing={
        <span class="rounded-sm text-xs border border-ink/5 px-1.5 py-0.5 font-normal text-ink-extra-muted">
          <Hotkey token={TOKENS.sidebar.goTo.search} />
        </span>
      }
    >
      <span class="truncate text-ink-extra-muted">Search</span>
    </SidebarItemNext>
  );
};

/** The rail's search button: the same action, reduced to the icon. */
export const SearchRailButton = () => {
  const openSearch = useOpenSearch();

  return (
    <SidebarItemNext
      variant="railBoxed"
      label="Search"
      icon={MagnifyingGlassIcon}
      tooltip="Search"
      tooltipPlacement="right"
      hotkey={TOKENS.sidebar.goTo.search}
      data-sidebar-next-search=""
      onClick={openSearch}
    />
  );
};
