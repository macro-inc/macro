import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useNavigate, useParams } from '@app/lib/split-router';
import { tasksSplitRoute } from '@app/routes/routes';
import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { enableTasksReviews } from '@core/constant/featureFlags';
import { onMount, Show } from 'solid-js';
import { ReviewsView } from './reviews-view';
import { ReviewsViewSkeleton } from './reviews-view-skeleton';

function DisabledReviewsRoute() {
  const navigate = useNavigate();
  onMount(() =>
    navigate({ route: tasksSplitRoute, params: {} }, { replace: true })
  );
  return null;
}

function TrackedReviewsView() {
  useViewRestoration();
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
        <Show when={!flag().loading} fallback={<ReviewsViewSkeleton />}>
          <DisabledReviewsRoute />
        </Show>
      }
    >
      <TrackedReviewsView />
    </Show>
  );
}, ReviewsViewSkeleton);
