import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useParams } from '@app/lib/split-router';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { onMount } from 'solid-js';
import { PrPage } from './pr-page';

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
  return <PrPage foreignEntityId={params.foreignEntityId} />;
});
