import { requestSearchFocus } from '@app/features/next-soup/soup-view/search-controllers';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToSidebarView } from '@components/app/app-sidebar/sidebar';
import { TOKENS } from '@core/hotkey/tokens';
import { SidebarSearchMenu } from '../app-sidebar/sidebar-search-menu';
import { useSplitLayout } from '../split-layout/layout';

/** Search and command-menu discovery in the compact rail. */
export const SearchRailButton = () => {
  const analytics = useAnalytics();
  const { openWithSplit } = useSplitLayout();

  const openSearch = (newSplit: boolean) => {
    analytics.track('sidebar_click', { view: 'search' });

    let split = globalSplitManager()?.activeSplit();
    const content = split?.content();

    if (
      !newSplit &&
      split &&
      content?.type === 'component' &&
      content.id === 'search'
    ) {
      requestSearchFocus(split.id);
      globalSplitManager()?.returnFocus();
      return;
    }

    split = navigateToSidebarView({
      viewId: 'search',
      shiftKey: newSplit,
      openWithSplit,
      referredFrom: 'sidebar',
      onApplied: () => {
        const active = globalSplitManager()?.activeSplit();
        if (active?.content().id === 'search') requestSearchFocus(active.id);
      },
    });
    if (split) requestSearchFocus(split.id);
    globalSplitManager()?.returnFocus();
  };

  return (
    <SidebarSearchMenu
      onSearch={openSearch}
      triggerProps={{
        size: 'icon-md',
        variant: 'ghost',
        tooltipPlacement: 'right',
        hotkey: TOKENS.sidebar.goTo.search,
        'data-sidebar-next-search': '',
        class: 'size-10 rounded-xl [&_svg]:size-5',
      }}
    />
  );
};
