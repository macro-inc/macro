import { requestSearchFocus } from '@app/features/next-soup/soup-view/search-controllers';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToSidebarView } from '@components/app/app-sidebar/sidebar';
import { TOKENS } from '@core/hotkey/tokens';
import MagnifyingGlassIcon from '@icon/system/regular/magnifying-glass.svg';
import { Button, Hotkey } from '@ui';
import { useSplitLayout } from '../split-layout/layout';

/** Opens Search in the active split, or a new one; refocuses an open Search. */
function useOpenSearch() {
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

  return openSearch;
}

/** Opens Search from the compact rail; Shift+click opens it in a new split. */
export const SearchRailButton = () => {
  const openSearch = useOpenSearch();

  return (
    <Button
      aria-label={t('nav.search')}
      size="icon-md"
      variant="ghost"
      tooltip={{
        content: t('nav.search'),
        placement: 'right',
        hotkey: TOKENS.sidebar.goTo.search,
      }}
      data-sidebar-next-search=""
      class="size-10 rounded-xl"
      onClick={(event: MouseEvent) => openSearch(event.shiftKey)}
    >
      <MagnifyingGlassIcon class="size-5" />
    </Button>
  );
};

/**
 * The single sidebar's search: a field-shaped button that opens Search, with
 * its shortcut. Shift+click opens it in a new split.
 */
export const SearchFieldButton = () => {
  const openSearch = useOpenSearch();
  return (
    <Button
      variant="secondary"
      size="md"
      class="min-w-0 flex-1 justify-start text-ink-muted"
      data-sidebar-next-search=""
      onClick={(event: MouseEvent) => openSearch(event.shiftKey)}
    >
      <MagnifyingGlassIcon class="size-4 shrink-0" />
      <span class="min-w-0 flex-1 truncate text-left">{t('nav.search')}</span>
      <Hotkey token={TOKENS.sidebar.goTo.search} />
    </Button>
  );
};
