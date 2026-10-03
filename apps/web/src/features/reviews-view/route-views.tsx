import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { tasksSplitRoute } from '@app/routes/routes';
import { useNavigate, useParams } from '@app/split-router';
import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableTasksReviews } from '@core/constant/featureFlags';
import { lazy, onMount, Show } from 'solid-js';

const ReviewsView = lazy(async () => ({
  default: (await import('./reviews-view')).ReviewsView,
}));

export const ReviewsPrDetailRouteView = lazy(async () => ({
  default: (await import('./components/ReviewsPrDetail'))
    .ReviewsPrDetailRouteView,
}));

function DisabledReviewsRoute() {
  const navigate = useNavigate();
  onMount(() =>
    navigate({ route: tasksSplitRoute, params: {} }, { replace: true })
  );
  return null;
}

function TrackedReviewsView() {
  usePageViewTracking('reviews');
  return <ReviewsView />;
}

export const ReviewsRouteView = withAuth(() => {
  const params = useParams<{ foreignEntityId?: string }>();
  const flag = useFeatureFlag(enableTasksReviews);
  return (
    <Show
      when={params.foreignEntityId || flag().enabled}
      fallback={
        <Show when={!flag().loading} fallback={<LoadingBlock />}>
          <DisabledReviewsRoute />
        </Show>
      }
    >
      <TrackedReviewsView />
    </Show>
  );
});
