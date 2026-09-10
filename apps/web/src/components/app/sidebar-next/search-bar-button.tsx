import { requestSearchFocus } from '@app/features/next-soup/soup-view/search-controllers';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToSidebarView } from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { TOKENS } from '@core/hotkey/tokens';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { Button } from '@ui';

/**
 * The rail's search button: the magnifier alone, its label in the tooltip.
 *
 * An `@ui` Button on the same geometry as the create CTA beside it — same size,
 * rounding and lift — so the pair reads as one row of actions and either can be
 * restyled through `variant` and `class` alone.
 *
 * Takes the active split to the search view and focuses its input — the same
 * behaviour as the old sidebar's magnifier (`SidebarHeaderSearchButton`), not
 * the command menu. Already on search, it just refocuses the input rather than
 * pushing a second entry.
 */
export const SearchRailButton = () => {
  const analytics = useAnalytics();
  const layout = useSplitLayout();

  const openSearch = (event: MouseEvent) => {
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

  return (
    <Button
      size="icon-md"
      variant="ghost"
      // class="rounded-full shadow-md shadow-drop-shadow bg-surface-2"
      label="Search"
      tooltipPlacement="right"
      hotkey={TOKENS.sidebar.goTo.search}
      data-sidebar-next-search=""
      onClick={openSearch}
    >
      <MagnifyingGlassIcon class="size-5" />
    </Button>
  );
};
