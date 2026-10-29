import { usePosthog } from '@app/lib/analytics/posthog';
import { createSearchParams } from '@app/lib/split-router';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { lazy, Show } from 'solid-js';
import { activitySearch } from './activity-search';
import { openEntityInSplit } from './open-entity-in-split';
import { useActivityFeedFlag } from './use-activity-feed-flag';

const MyActivityView = lazy(async () => ({
  default: (await import('./views/my-activity-view')).MyActivityView,
}));

function TrackedActivityView() {
  usePageViewTracking('activity');
  const [search, setSearch] = createSearchParams(activitySearch);
  return (
    <MyActivityView
      scope={search.scope}
      onScopeChange={(scope) => setSearch({ scope }, { history: 'replace' })}
      onOpen={openEntityInSplit}
    />
  );
}

export const ActivityRouteView = withAuth(() => {
  const enabled = useActivityFeedFlag();
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
      <TrackedActivityView />
    </Show>
  );
});
