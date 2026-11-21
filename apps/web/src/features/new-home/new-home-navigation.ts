import {
  homeTabSearch,
  homeTabSearchCodec,
} from '@app/features/home/home-tab-search';
import type { InboxStatus } from '@app/features/notifications-inbox/core/inbox-filters';
import { saveInboxStatus } from '@app/features/notifications-inbox/inbox-filter-storage';
import { t } from '@app/lib/i18n';
import { useNavigate } from '@app/lib/split-router';
import { homeSplitRoute, notificationsRoute } from '@app/routes/routes';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import type { Accessor } from 'solid-js';
import type { NewHomeTab } from './core/new-home-mode';
import { useNewHomeMode } from './use-new-home-mode';

/**
 * Recent is Home's route with the Recent tab, which every Home navigation
 * carries on, so Home's previews and deep links serve it unchanged.
 */
export const NEW_HOME_RECENT_SEARCH = {
  [homeTabSearch.namespace]: homeTabSearchCodec.serialize({ tab: 'recent' }),
};

/** What a split shows to open New Home on `tab`. */
export function newHomeContent(tab: NewHomeTab): SplitContent {
  return tab === 'recent'
    ? {
        type: 'component',
        id: 'home',
        entryMetadata: { search: NEW_HOME_RECENT_SEARCH },
      }
    : { type: 'component', id: 'notifications' };
}

/**
 * Switch the split to another New Home tab, as a new history entry so Back
 * returns. Notifications can open at All or Unread.
 */
export function useNewHomeNavigation(): (
  tab: NewHomeTab,
  status?: InboxStatus
) => void {
  const navigate = useNavigate();
  const userId = useUserId();
  return (tab, status) => {
    if (tab === 'recent') {
      fireAndForget(
        navigate(
          { route: homeSplitRoute, params: {} },
          { search: NEW_HOME_RECENT_SEARCH }
        ),
        'new-home'
      );
      return;
    }
    const id = userId();
    if (status && id) saveInboxStatus(id, status);
    fireAndForget(
      navigate({ route: notificationsRoute, params: {} }),
      'new-home'
    );
  };
}

/** "New Home" while old Home is still beside it, else "Home". */
export function useNewHomeTitle(): Accessor<string> {
  const mode = useNewHomeMode();
  return () => (mode() === 'both' ? t('home.newHome') : t('nav.home'));
}
