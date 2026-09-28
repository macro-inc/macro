import { tasksSplitRoute } from '@app/features/tasks-view/route';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { defineRoute, useNavigate, useParams } from '@app/lib/split-router';
import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableTasksReviews } from '@core/constant/featureFlags';
import { lazy, onMount, Show } from 'solid-js';
import { z } from 'zod';
import { reviewsTabSearch } from './reviews-tab-search';

const ReviewsView = lazy(async () => ({
  default: (await import('./reviews-view')).ReviewsView,
}));
const ReviewsPrDetailRouteView = lazy(async () => ({
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

export const reviewsPrRoute = defineRoute({
  id: 'reviews-pr',
  path: 'pr/:foreignEntityId',
  params: z.object({ foreignEntityId: z.string().min(1) }),
  component: ReviewsPrDetailRouteView,
  remountKey: ({ foreignEntityId }) => foreignEntityId,
  claim: ({ foreignEntityId }) => ({
    namespace: 'block',
    id: `pr:${foreignEntityId}`,
  }),
  toReference: ({ foreignEntityId }) => ({ type: 'pr', id: foreignEntityId }),
});

export const reviewsSplitRoute = defineRoute({
  id: 'view-reviews',
  path: 'reviews',
  component: ReviewsRouteView,
  search: [reviewsTabSearch.namespace],
  children: [reviewsPrRoute],
});
