import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useNavigate } from '@app/lib/split-router';
import { homeSplitRoute } from '@app/routes/routes';
import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableWhatsappLinked } from '@core/constant/featureFlags';
import { lazy, onMount, Show } from 'solid-js';
import { ExternalViewSkeleton } from './external-view-skeleton';

const ExternalView = lazy(async () => ({
  default: (await import('./external-view')).ExternalView,
}));

function DisabledExternalRoute() {
  const navigate = useNavigate();
  onMount(() =>
    navigate({ route: homeSplitRoute, params: {} }, { replace: true })
  );
  return null;
}

function TrackedExternalView() {
  usePageViewTracking('external');
  return <ExternalView />;
}

/** `/external`; a deep link with the flag off goes Home once the flag resolves. */
export const ExternalRouteView = withAuth(() => {
  const flag = useFeatureFlag(enableWhatsappLinked);
  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show when={!flag().loading} fallback={<ExternalViewSkeleton />}>
          <DisabledExternalRoute />
        </Show>
      }
    >
      <TrackedExternalView />
    </Show>
  );
}, ExternalViewSkeleton);
