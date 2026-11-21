import { usePosthog } from '@app/lib/analytics/posthog';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { Match, Show, Switch } from 'solid-js';
import { NewHomeNotificationsView } from '../new-home/new-home-notifications';
import { useNewHomeMode } from '../new-home/use-new-home-mode';
import { NotificationsInbox } from './notifications-inbox';
import { useUnifiedNotificationsFlag } from './use-unified-notifications-flag';
import { NotificationsCalendarPane } from './views/notifications-calendar-pane';

/** A calendar notification's event, in the view's content area. */
export function NotificationsCalendarRouteView() {
  return <NotificationsCalendarPane />;
}

function TrackedNotificationsInbox() {
  usePageViewTracking('notifications');
  return <NotificationsInbox />;
}

function TrackedNewHomeNotifications() {
  usePageViewTracking('new-home-notifications');
  return <NewHomeNotificationsView />;
}

/**
 * The unified Notifications view, or New Home's Notifications tab once New
 * Home is on. With both rollouts off, the route sends the split to Home once
 * flags have loaded; while they load it shows nothing rather than taking the
 * off path.
 */
export const NotificationsRouteView = withAuth(() => {
  const enabled = useUnifiedNotificationsFlag();
  const newHome = useNewHomeMode();
  const posthog = usePosthog();
  return (
    <Switch
      fallback={
        <Show when={posthog.flagsLoaded()}>
          <RedirectSplit to={{ type: 'component', id: 'home' }} />
        </Show>
      }
    >
      <Match when={newHome() === 'both' || newHome() === 'new-only'}>
        <TrackedNewHomeNotifications />
      </Match>
      <Match when={enabled() && newHome() === 'off'}>
        <TrackedNotificationsInbox />
      </Match>
      {/* Which view it is waits for New Home's flags. */}
      <Match when={enabled()}>{null}</Match>
    </Switch>
  );
});
