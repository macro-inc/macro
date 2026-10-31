import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { ContentLoading } from '@components/app/ContentLoading';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableEmailMarketing } from '@core/constant/featureFlags';
import { lazyNamed } from '@core/util/lazyNamed';
import { Show } from 'solid-js';

const EmailMarketing = lazyNamed(
  () => import('./email-marketing'),
  'EmailMarketing'
);

function TrackedEmailMarketing() {
  usePageViewTracking('email-marketing');
  return <EmailMarketing />;
}

export const EmailMarketingRouteView = withAuth(() => {
  // A flag still loading is not off: wait before redirecting.
  const flag = useFeatureFlag(enableEmailMarketing);
  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show when={!flag().loading} fallback={<ContentLoading />}>
          <RedirectSplit to={{ type: 'component', id: 'home' }} />
        </Show>
      }
    >
      <TrackedEmailMarketing />
    </Show>
  );
});
