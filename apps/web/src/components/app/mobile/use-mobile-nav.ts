import type { ListView } from '@app/constants/list-views';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import type { MobileSearchRouteState } from '@app/features/command/mobile/mobile-search-route-state';
import { useUnifiedNotificationsFlag } from '@app/features/notifications-inbox/use-unified-notifications-flag';
import {
  reviewsTabSearch,
  reviewsTabSearchCodec,
} from '@app/features/reviews-view/reviews-tab-search';
import { useOptionalSplitRouter } from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import { projectDetailRoute } from '@app/routes/routes';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSettingsState } from '@core/constant/SettingsState';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { type Accessor, createMemo, useContext } from 'solid-js';
import { SplitLayoutContext } from '../split-layout/context';
import { useSplitLayout } from '../split-layout/layout';
import { paneOf } from '../split-layout/layoutManager';
import { isMobileNavViewId, type MobileNavViewId } from './mobile-nav-views';

/**
 * Everything the dock can navigate to: the pill-row views plus the list views
 * only reachable through the Views menu or the dynamic nav button (folders,
 * companies, …).
 */
export type MobileDockNavId =
  | ListView
  | 'calendar'
  | 'reviews'
  | 'booking-links'
  | 'external'
  | 'passwords'
  | 'settings';

function mobileNavContent(id: Exclude<MobileDockNavId, 'settings'>) {
  if (id === 'documents') {
    return {
      type: 'component' as const,
      id,
      entryMetadata: {
        route: paneRoute(
          { id: 'drive', params: {} },
          { id: 'drive-tab', params: { tab: 'recent' } }
        ),
      },
    };
  }

  if (id === 'reviews') {
    return {
      type: 'component' as const,
      id,
      entryMetadata: {
        search: {
          [reviewsTabSearch.namespace]: reviewsTabSearchCodec.serialize({
            tab: 'all',
          }),
        },
      },
    };
  }
  return {
    type: 'component' as const,
    id: id === 'calendar' ? CALENDAR_VIEW_ID : id,
  };
}

/** The mobile navigation view represented by the foreground split content. */
export function useForegroundMobileView(): Accessor<
  MobileNavViewId | undefined
> {
  return createMemo(() => {
    const content = globalSplitManager()?.activeSplit()?.content();
    if (!content) return undefined;
    if (content.type !== 'component') return undefined;
    // The unified Notifications view is the dock's bell.
    if (content.id === 'notifications') return 'home';
    return isMobileNavViewId(content.id) ? content.id : undefined;
  });
}

/**
 * Whether the foreground split shows a project, whose tabs float their own
 * Task pill.
 */
export function useForegroundProject(): Accessor<boolean> {
  const router = useOptionalSplitRouter();
  return createMemo(() => {
    const split = globalSplitManager()?.activeSplit();
    if (!router || !split) return false;

    return router
      .matches(paneOf(split.id))
      .some((match) => match.id === projectDetailRoute.id);
  });
}

/**
 * Navigate to a nav view from the pill row. Native mobile stacks panes, and
 * the stack resets to just that view: nav views never show a back button,
 * so nothing may sit behind them.
 * Otherwise switching between nav views replaces in place (mergeHistory), and
 * from an entity it navigates forward. Settings toggles the settings split.
 */
export function useMobileNavNavigate(): (id: MobileDockNavId) => void {
  const { openWithSplit, replaceAllSplits } = useSplitLayout();
  const dockParking = useContext(SplitLayoutContext)?.dockParking;
  const { toggleSettings } = useSettingsState();
  const unifiedNotifications = useUnifiedNotificationsFlag();

  return (id) => {
    if (id === 'settings') {
      toggleSettings();
      return;
    }
    // The bell labelled Notifications opens the unified view when it's on.
    const content =
      id === 'home' && unifiedNotifications()
        ? { type: 'component' as const, id: 'notifications' }
        : mobileNavContent(id);
    if (isNativeMobilePlatform()) {
      const routeState: MobileSearchRouteState | undefined =
        id === 'search' ? { sessionId: crypto.randomUUID() } : undefined;
      // Search taps intentionally start a new search session.
      const replaceOptions = { routeState, resume: id !== 'search' };
      if (dockParking) dockParking.show(content, replaceOptions);
      else replaceAllSplits(content, replaceOptions);
      return;
    }
    const fgContent = globalSplitManager()?.activeSplit()?.content();
    const isOnNavView = fgContent?.type === 'component';
    openWithSplit(content, {
      resume: id !== 'search',
      mergeHistory: isOnNavView,
      // Route through the router so an existing pane receives the default tab.
      search: id === 'documents' || id === 'reviews' ? {} : undefined,
    });
  };
}
