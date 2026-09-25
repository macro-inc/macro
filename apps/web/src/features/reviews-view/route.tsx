import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { defineRoute, useParams } from '@app/lib/split-router';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableTasksReviews } from '@core/constant/featureFlags';
import { lazy, Show } from 'solid-js';
import { z } from 'zod';

const ReviewsView = lazy(async () => ({
  default: (await import('./reviews-view')).ReviewsView,
}));
const ReviewsPrDetailRouteView = lazy(async () => ({
  default: (await import('./components/ReviewsPrDetail'))
    .ReviewsPrDetailRouteView,
}));

function TrackedReviewsView() {
  usePageViewTracking('reviews');
  return <ReviewsView />;
}

export const ReviewsRouteView = withAuth(() => {
  const params = useParams<{ foreignEntityId?: string }>();
  const flag = useFeatureFlag(enableTasksReviews);
  const detailRequested = () => typeof params.foreignEntityId === 'string';
  const tasksFallback = (
    <RedirectSplit to={{ type: 'component', id: 'tasks' }} />
  );

  return (
    <Show
      when={!flag().loading || detailRequested()}
      fallback={<LoadingBlock />}
    >
      <Show when={flag().enabled || detailRequested()} fallback={tasksFallback}>
        <TrackedReviewsView />
      </Show>
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
});

export const reviewsSplitRoute = defineRoute({
  id: 'view-reviews',
  path: 'reviews',
  component: ReviewsRouteView,
  children: [reviewsPrRoute],
});
