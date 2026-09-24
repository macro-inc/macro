import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { defineRoute, useParams } from '@app/lib/split-router';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { lazy, onMount } from 'solid-js';
import { z } from 'zod';

const PrDetail = lazy(async () => ({
  default: (await import('./views/PrDetail')).PrDetail,
}));

const PrDetailRouteView = withAuth(() => {
  const params = useParams<{ foreignEntityId: string }>();
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView('pr');
    analytics.track('open_entity', {
      entityType: 'pr',
      entityId: params.foreignEntityId,
    });
  });
  return <PrDetail foreignEntityId={params.foreignEntityId} />;
});

export const prDetailRoute = defineRoute({
  id: 'pr-detail',
  path: 'pr/:foreignEntityId',
  params: z.object({ foreignEntityId: z.string().min(1) }),
  component: PrDetailRouteView,
  remountKey: ({ foreignEntityId }) => foreignEntityId,
  claim: ({ foreignEntityId }) => ({
    namespace: 'block',
    id: `pr:${foreignEntityId}`,
  }),
});
