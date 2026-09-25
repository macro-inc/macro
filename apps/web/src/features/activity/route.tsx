import { usePosthog } from '@app/lib/analytics/posthog';
import { defineRoute } from '@app/lib/split-router';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { lazy, Show } from 'solid-js';
import { openEntityInSplit } from './open-entity-in-split';
import { useActivityFeedFlag } from './use-activity-feed-flag';

const MyActivityView = lazy(async () => ({
  default: (await import('./views/my-activity-view')).MyActivityView,
}));

function TrackedActivityView() {
  usePageViewTracking('activity');
  return <MyActivityView onOpen={openEntityInSplit} />;
}

export const ActivityRouteView = withAuth(() => {
  const enabled = useActivityFeedFlag();
  const posthog = usePosthog();
  return (
    <Show
      when={enabled()}
      fallback={
        <Show when={posthog.flagsLoaded()}>
          <RedirectSplit to={{ type: 'component', id: 'inbox' }} />
        </Show>
      }
    >
      <TrackedActivityView />
    </Show>
  );
});

export const activityRoute = defineRoute({
  id: 'view-activity',
  path: 'activity',
  component: ActivityRouteView,
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'activity' }),
});
