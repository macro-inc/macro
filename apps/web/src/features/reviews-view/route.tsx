import { defineRoute } from '@app/lib/split-router';
import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { lazy } from 'solid-js';
import { z } from 'zod';
import { reviewsTabSearch } from './reviews-tab-search';

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

export const ReviewsRouteView = withAuth(TrackedReviewsView);

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
  search: [reviewsTabSearch.namespace],
  children: [reviewsPrRoute],
});
