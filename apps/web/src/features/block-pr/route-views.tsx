import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useParams } from '@app/lib/split-router';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { lazy, onMount } from 'solid-js';

const StandalonePrDetail = lazy(async () => ({
  default: (await import('./views/PrDetail')).StandalonePrDetail,
}));

export const PrDetailRouteView = withAuth(() => {
  const params = useParams<{ foreignEntityId: string }>();
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView('pr');
    analytics.track('open_entity', {
      entityType: 'pr',
      entityId: params.foreignEntityId,
    });
  });
  return <StandalonePrDetail foreignEntityId={params.foreignEntityId} />;
});
