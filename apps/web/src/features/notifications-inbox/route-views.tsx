import { usePosthog } from '@app/lib/analytics/posthog';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { lazy, Show } from 'solid-js';
import { useUnifiedNotificationsFlag } from './use-unified-notifications-flag';

const NotificationsInbox = lazy(async () => ({
  default: (await import('./notifications-inbox')).NotificationsInbox,
}));

function TrackedNotificationsInbox() {
  usePageViewTracking('notifications');
  return <NotificationsInbox />;
}

/**
 * The unified Notifications view. With the rollout off, the route sends the
 * split to Home once flags have loaded; while they load it shows nothing
 * rather than taking the off path.
 */
export const NotificationsRouteView = withAuth(() => {
  const enabled = useUnifiedNotificationsFlag();
  const posthog = usePosthog();
  return (
    <Show
      when={enabled()}
      fallback={
        <Show when={posthog.flagsLoaded()}>
          <RedirectSplit to={{ type: 'component', id: 'home' }} />
        </Show>
      }
    >
      <TrackedNotificationsInbox />
    </Show>
  );
});
