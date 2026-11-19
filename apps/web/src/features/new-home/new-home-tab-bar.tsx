import { useViewTabHotkeys } from '@app/components/view-shell';
import type { InboxStatus } from '@app/features/notifications-inbox/core/inbox-filters';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useNavigationUnread } from '@components/app/use-navigation-unread';
import { useUserId } from '@core/context/user';
import { createEffect } from 'solid-js';
import { match } from 'ts-pattern';
import { NewHomeTabs } from './components/new-home-tabs';
import type { NewHomeTab } from './core/new-home-mode';
import { useNewHomeNavigation } from './new-home-navigation';
import { saveNewHomeTab } from './new-home-preferences';

/** The places the number keys pick, left to right: Recent, then All and Unread. */
type NewHomePlace = 'recent' | 'notifications-all' | 'notifications-unread';
const NEW_HOME_PLACES: readonly NewHomePlace[] = [
  'recent',
  'notifications-all',
  'notifications-unread',
];

/**
 * New Home's Recent and Notifications switch, under its header. `1` is
 * Recent, `2` and `3` are Notifications at All and Unread, and Tab and
 * Shift+Tab step through the three. The tab shown is the one New Home opens
 * on next.
 */
export function NewHomeTabBar(props: {
  tab: NewHomeTab;
  /** On the Notifications tab, its All and Unread. */
  status?: { value: InboxStatus; onChange: (status: InboxStatus) => void };
}) {
  const panel = useSplitPanelOrThrow();
  const userId = useUserId();
  const unread = useNavigationUnread();
  const goTo = useNewHomeNavigation();

  // The split in use decides the tab New Home opens on next.
  createEffect(() => {
    const id = userId();
    if (id && panel.isPanelActive()) saveNewHomeTab(id, props.tab);
  });

  const showStatus = (status: InboxStatus) => {
    if (props.status) props.status.onChange(status);
    else goTo('notifications', status);
  };
  const place = (): NewHomePlace => {
    if (props.tab === 'recent') return 'recent';
    return props.status?.value === 'unread'
      ? 'notifications-unread'
      : 'notifications-all';
  };

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => NEW_HOME_PLACES,
    activeId: place,
    setActiveId: (next) => {
      if (next === place()) return;
      match(next)
        .with('recent', () => goTo('recent'))
        .with('notifications-all', () => showStatus('all'))
        .with('notifications-unread', () => showStatus('unread'))
        .exhaustive();
    },
  });

  return (
    <NewHomeTabs
      value={props.tab}
      unread={unread.has('new-home')}
      onChange={(tab) => {
        if (tab !== props.tab) goTo(tab);
      }}
    />
  );
}
